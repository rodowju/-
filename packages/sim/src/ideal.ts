import { CYCLE_COUNT, SAFE_RELEASE_TICKS } from './config';
import { guardianSchedule } from './guardian';
import type { InputEvent, StageSpec } from './types';
import { createWorld, isPlayerDone, step } from './world';

export interface ReferenceStyle {
  /** 매 사이클 D 보다 몇 tick 일찍 릴리즈하는가 */
  readonly lead: number;
  /** Turnback 이후 다시 누르기까지 반응 지연(tick) */
  readonly reaction: number;
}

/** 완벽한 플레이어: 지연 0, 매 사이클 D 에 정확히 릴리즈 */
export const IDEAL: ReferenceStyle = { lead: 0, reaction: 0 };
/** par 기준 플레이어: 반응 8 tick(≈133 ms), D 보다 8 tick(≈133 ms) 일찍 릴리즈 — Great 구간의 침착한 플레이 */
export const PAR_REFERENCE: ReferenceStyle = { lead: 8, reaction: 8 };

/**
 * 고정 스타일(노이즈 없음) 플레이어의 완주 tick. par(★2 기준) 산출에 사용한다.
 * 완주하지 못하면 Infinity.
 */
export function referenceFinishTicks(spec: StageSpec, style: ReferenceStyle): number {
  const solo: StageSpec = { ...spec, botCount: 0, parTicks: 0 };
  const sch = guardianSchedule(solo, CYCLE_COUNT);
  const inputs: InputEvent[] = [];
  sch.forEach((c, i) => {
    const prev = i === 0 ? undefined : sch[i - 1];
    inputs.push({ tick: (prev ? prev.turnbackStart : 0) + style.reaction, type: 'down' });
    inputs.push({ tick: c.watchStart + SAFE_RELEASE_TICKS - style.lead, type: 'up' });
  });
  let s = createWorld(solo);
  let ptr = 0;
  while (!isPlayerDone(s) && s.tick < 60 * 600) {
    const now: InputEvent[] = [];
    while (ptr < inputs.length && (inputs[ptr]?.tick ?? Infinity) <= s.tick) {
      const ev = inputs[ptr];
      if (ev && ev.tick === s.tick) now.push(ev);
      ptr++;
    }
    s = step(s, solo, now);
  }
  const p = s.runners[0];
  return p?.status === 'finished' ? p.endTick : Infinity;
}

/** 이상적 플레이어의 완주 tick */
export function idealFinishTicks(spec: StageSpec): number {
  return referenceFinishTicks(spec, IDEAL);
}
