import {
  PLAYER_ID,
  canonicalSeed,
  createWorld,
  makeStageSpec,
  step,
  type InputEvent,
} from '@freeze/sim';

/**
 * 게임 서버 연결 설정. VITE_SERVER_URL 이 없으면 온라인 기능(고스트·대전)은 숨긴다.
 */
const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '');

export function onlineAvailable(): boolean {
  return !!SERVER;
}

export function wsUrl(): string {
  return `${(SERVER ?? '').replace(/^http/, 'ws')}/ws`;
}

export interface GhostData {
  readonly stage: number;
  readonly assist: number;
  readonly finishTick: number;
  readonly inputs: readonly InputEvent[];
}

async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T | null> {
  if (!SERVER) return null;
  // 오프라인이면 요청하지 않는다 (PWA 오프라인 실행 시 콘솔 오류·지연 방지)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SERVER}${path}`, { ...init, signal: ctl.signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 목표 시간에 가까운(조금 더 빠른) 고스트를 받아온다 */
export function fetchGhost(stage: number, target: number): Promise<GhostData | null> {
  return fetchJson<GhostData>(`/api/ghosts?stage=${stage}&target=${Math.round(target)}`);
}

export function submitGhost(
  stage: number,
  assist: number,
  inputs: readonly InputEvent[],
): Promise<{ stored: boolean; rank: number; finishTick: number } | null> {
  return fetchJson(`/api/ghosts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage, assist, inputs: inputs.map((e) => ({ tick: e.tick, type: e.type })) }),
  });
}

/** 고스트의 tick 별 위치(m). 고스트 자신의 Assist 로 재현해야 기록과 같은 경로가 된다. */
export function ghostTrack(g: GhostData): Float64Array {
  const spec = { ...makeStageSpec(g.stage, canonicalSeed(g.stage), g.assist), botCount: 0 };
  const out: number[] = [];
  let s = createWorld(spec);
  let i = 0;
  const inputs = [...g.inputs].sort((a, b) => a.tick - b.tick);
  while (s.tick <= g.finishTick + 1 && s.tick < 60 * 600) {
    const now: InputEvent[] = [];
    while (i < inputs.length && (inputs[i]?.tick ?? Infinity) <= s.tick) {
      const e = inputs[i++];
      if (e && e.tick === s.tick) now.push(e);
    }
    s = step(s, spec, now);
    out.push((s.runners[PLAYER_ID]?.pos ?? 0) / 1_000_000);
  }
  return Float64Array.from(out);
}
