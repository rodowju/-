import {
  ASSIST_CAP,
  PLAYER_ID,
  canonicalSeed,
  makeReplay,
  makeStageSpec,
  runReplay,
  type InputEvent,
} from '@freeze/sim';

/** 고스트(비동기 대전) 제출 데이터 */
export interface GhostSubmission {
  readonly stage: number;
  readonly assist: number;
  readonly inputs: readonly InputEvent[];
}

export interface GhostRecord extends GhostSubmission {
  readonly id: string;
  readonly finishTick: number;
  readonly score: number;
  readonly createdAt: number;
}

export const MAX_GHOST_INPUTS = 4000;
export const MAX_GHOST_TICKS = 60 * 600;

export type GhostCheck =
  | { readonly ok: true; readonly sub: GhostSubmission; readonly finishTick: number; readonly score: number }
  | { readonly ok: false; readonly reason: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * 고스트 검증: 형식 검사 후 서버가 기준 시드로 직접 재시뮬레이션해 완주를 확인한다.
 * 클라이언트가 보낸 결과(시간·점수)는 받지 않는다 — 입력만 신뢰 대상이고 결과는 서버가 계산한다.
 */
export function checkGhost(body: unknown): GhostCheck {
  if (!isObj(body)) return { ok: false, reason: 'body' };
  const { stage, assist, inputs } = body;
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1 || stage > 999) return { ok: false, reason: 'stage' };
  if (typeof assist !== 'number' || !Number.isInteger(assist) || assist < 0 || assist > ASSIST_CAP) return { ok: false, reason: 'assist' };
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > MAX_GHOST_INPUTS) return { ok: false, reason: 'inputs' };
  const clean: InputEvent[] = [];
  let lastTick = -1;
  let expect: 'down' | 'up' = 'down';
  for (const e of inputs as unknown[]) {
    if (!isObj(e)) return { ok: false, reason: 'input' };
    const { tick, type } = e;
    if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0 || tick > MAX_GHOST_TICKS) return { ok: false, reason: 'tick' };
    if (tick <= lastTick) return { ok: false, reason: 'order' };
    if (type !== expect) return { ok: false, reason: 'alternation' };
    clean.push({ tick, type: expect });
    lastTick = tick;
    expect = expect === 'down' ? 'up' : 'down';
  }
  const spec = makeStageSpec(stage, canonicalSeed(stage), assist);
  const { final } = runReplay(makeReplay(spec, clean), { maxTicks: MAX_GHOST_TICKS });
  const p = final.runners[PLAYER_ID];
  if (!p || p.status !== 'finished') return { ok: false, reason: 'not-finished' };
  return { ok: true, sub: { stage, assist, inputs: clean }, finishTick: p.endTick, score: p.score };
}

/**
 * 고스트 선택: 목표 시간(target) 이하 중 가장 느린 기록 = "조금만 더 하면 이길 수 있는" 상대.
 * 없으면 전체 중 가장 느린 기록 (처음 하는 유저에게 너무 강한 고스트를 주지 않음).
 */
export function pickGhost<T extends { finishTick: number }>(records: readonly T[], target: number): T | undefined {
  let best: T | undefined;
  for (const r of records) {
    if (r.finishTick <= target && (!best || r.finishTick > best.finishTick)) best = r;
  }
  if (best) return best;
  let slowest: T | undefined;
  for (const r of records) if (!slowest || r.finishTick > slowest.finishTick) slowest = r;
  return slowest;
}
