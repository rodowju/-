import type { GuardianPhase, GuardianState, StageSpec } from './types';

const NEXT: Record<GuardianPhase, GuardianPhase> = {
  chant: 'turn',
  turn: 'watch',
  watch: 'turnback',
  turnback: 'chant',
};

function at(arr: readonly number[], idx: number): number {
  const v = arr[idx % arr.length];
  if (v === undefined) throw new Error('empty cycle array');
  return v;
}

export function phaseDuration(spec: StageSpec, phase: GuardianPhase, cycleIdx: number): number {
  switch (phase) {
    case 'chant':
      return at(spec.chantTicks, cycleIdx);
    case 'watch':
      return at(spec.watchTicks, cycleIdx);
    case 'turn':
    case 'turnback':
      return spec.turnTicks;
  }
}

export function initialGuardian(): GuardianState {
  return { phase: 'chant', phaseStart: 0, cycleIdx: 0 };
}

/** 현재 phase의 끝(exclusive) tick */
export function phaseEnd(spec: StageSpec, g: GuardianState): number {
  return g.phaseStart + phaseDuration(spec, g.phase, g.cycleIdx);
}

/** tick에 맞춰 phase를 전진시킨다. 전이가 있었다면 거친 상태 목록을 함께 반환. */
export function advanceGuardian(
  spec: StageSpec,
  g: GuardianState,
  tick: number,
): { guardian: GuardianState; transitions: GuardianState[] } {
  let cur = g;
  const transitions: GuardianState[] = [];
  while (tick >= phaseEnd(spec, cur)) {
    const start = phaseEnd(spec, cur);
    const phase = NEXT[cur.phase];
    const cycleIdx = cur.phase === 'turnback' ? cur.cycleIdx + 1 : cur.cycleIdx;
    cur = { phase, phaseStart: start, cycleIdx };
    transitions.push(cur);
  }
  return { guardian: cur, transitions };
}

export interface CycleSchedule {
  readonly chantStart: number;
  readonly turnStart: number;
  readonly watchStart: number;
  readonly turnbackStart: number;
  readonly end: number;
}

/** 앞쪽 n개 사이클의 절대 tick 일정 (봇 입력 생성용) */
export function guardianSchedule(spec: StageSpec, cycles: number): CycleSchedule[] {
  const out: CycleSchedule[] = [];
  let t = 0;
  for (let i = 0; i < cycles; i++) {
    const chantStart = t;
    const turnStart = chantStart + phaseDuration(spec, 'chant', i);
    const watchStart = turnStart + spec.turnTicks;
    const turnbackStart = watchStart + phaseDuration(spec, 'watch', i);
    const end = turnbackStart + spec.turnTicks;
    out.push({ chantStart, turnStart, watchStart, turnbackStart, end });
    t = end;
  }
  return out;
}
