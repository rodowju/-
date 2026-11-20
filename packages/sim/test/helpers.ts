import { SAFE_RELEASE_TICKS, guardianSchedule, type InputEvent, type StageSpec } from '../src';

/** 스크립트 플레이어: 매 사이클 D - lead 에 릴리즈, 직전 turnback 시작에 다시 홀드. */
export function scriptedInputs(spec: StageSpec, lead: number, cycles = 40): InputEvent[] {
  const sch = guardianSchedule(spec, cycles);
  const out: InputEvent[] = [];
  sch.forEach((c, i) => {
    const prev = i === 0 ? undefined : sch[i - 1];
    out.push({ tick: prev ? prev.turnbackStart : 0, type: 'down' });
    out.push({ tick: c.watchStart + SAFE_RELEASE_TICKS - lead, type: 'up' });
  });
  return out;
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
