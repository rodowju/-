import { getBotInputs } from './bots';
import {
  ACCEL,
  CC_GOOD_TICKS,
  CC_GREAT_TICKS,
  CC_PERFECT_TICKS,
  CLEAR_SCORE,
  CLOSE_CALL_BASE_SCORE,
  COMBO_MAX_MULT,
  COMBO_PER_LEVEL,
  COMBO_POINTS,
  DECEL,
  GRACE_TICKS,
  MAX_SPEED,
  SAFE_RELEASE_TICKS,
  TIME_BONUS_PER_6_TICKS,
  TURN_TICKS,
  V_TOL,
} from './config';
import { advanceGuardian, initialGuardian } from './guardian';
import type {
  CloseCallGrade,
  GuardianState,
  InputEvent,
  RunnerState,
  SimEvent,
  StageSpec,
  WorldState,
} from './types';

export const PLAYER_ID = 0;

export function createWorld(spec: StageSpec): WorldState {
  const runners: RunnerState[] = [];
  const total = spec.humans + spec.botCount;
  for (let i = 0; i < total; i++) {
    runners.push({ id: i, pos: 0, vel: 0, holding: false, status: 'running', endTick: -1, place: 0, nextInput: 0, combo: 0, score: 0 });
  }
  return {
    tick: 0,
    guardian: initialGuardian(),
    runners,
    finishedCount: 0,
    events: [],
  };
}

export function comboMultiplier(points: number): number {
  return Math.min(COMBO_MAX_MULT, 1 + Math.floor(points / COMBO_PER_LEVEL));
}

/** Watch 시작 tick (현재 phase가 turn 또는 watch일 때만 의미 있음) */
function watchStartOf(g: GuardianState, turnTicks: number): number | undefined {
  if (g.phase === 'turn') return g.phaseStart + turnTicks;
  if (g.phase === 'watch') return g.phaseStart;
  return undefined;
}

/** 릴리즈 시점의 Close Call 등급. 해당 없으면 undefined. (GDD §4.4) */
export function gradeRelease(
  g: GuardianState,
  tick: number,
  assist: number,
  turnTicks: number = TURN_TICKS,
): CloseCallGrade | undefined {
  const ws = watchStartOf(g, turnTicks);
  if (ws === undefined) return undefined;
  const d = ws + SAFE_RELEASE_TICKS;
  const delta = d - tick; // 양수: D보다 얼마나 이른가
  if (delta < -assist) return undefined; // 너무 늦음 → 탈락 판정으로 처리
  if (delta <= CC_PERFECT_TICKS) return 'perfect';
  if (delta <= CC_GREAT_TICKS) return 'great';
  if (delta <= CC_GOOD_TICKS) return 'good';
  return undefined;
}

/** 사람 러너인가 (외부 입력·Assist·점수 대상) */
export function isHuman(spec: StageSpec, id: number): boolean {
  return id < spec.humans;
}

/**
 * 한 tick 전진. 순수 함수: 입력 state는 변경하지 않는다.
 * @param humanInputs 이 tick(state.tick)에 발생한 사람 플레이어 입력 (runner 생략 시 0번)
 */
export function step(state: WorldState, spec: StageSpec, humanInputs: readonly InputEvent[]): WorldState {
  const tick = state.tick;
  const events: SimEvent[] = [];

  // 1. 술래 phase 전이
  const adv = advanceGuardian(spec, state.guardian, tick);
  const guardian = adv.guardian;
  for (const tr of adv.transitions) {
    events.push({ type: 'phase', tick, phase: tr.phase, cycleIdx: tr.cycleIdx });
  }

  let finishedCount = state.finishedCount;
  const botInputs = getBotInputs(spec);

  const runners: RunnerState[] = state.runners.map((r) => {
    let holding = r.holding;
    let nextInput = r.nextInput;
    let vel = r.vel;
    let status = r.status;
    let endTick = r.endTick;
    let place = r.place;
    let pos = r.pos;
    let combo = r.combo;
    let score = r.score;
    const human = isHuman(spec, r.id);

    // 2. 입력 적용
    const pending: InputEvent[] = [];
    if (human) {
      for (const ev of humanInputs) if (ev.tick === tick && (ev.runner ?? PLAYER_ID) === r.id) pending.push(ev);
    } else {
      const list = botInputs[r.id - spec.humans] ?? [];
      while (nextInput < list.length && (list[nextInput]?.tick ?? Infinity) <= tick) {
        const ev = list[nextInput];
        if (ev && ev.tick === tick) pending.push(ev);
        nextInput++;
      }
    }

    for (const ev of pending) {
      if (status !== 'running') break;
      if (ev.type === 'down') {
        holding = true;
      } else {
        // 'up'
        const wasMoving = holding && vel > 0;
        holding = false;
        if (human && wasMoving) {
          const grade = gradeRelease(guardian, tick, spec.assistGraceTicks, spec.turnTicks);
          if (grade) {
            const mult = comboMultiplier(combo);
            combo += COMBO_POINTS[grade];
            const pts = CLOSE_CALL_BASE_SCORE[grade] * mult;
            score += pts;
            events.push({ type: 'closeCall', tick, runner: r.id, grade, points: pts, multiplier: mult });
          }
        }
      }
    }

    // 3. 이동
    if (status === 'running') {
      vel = holding ? Math.min(MAX_SPEED, vel + ACCEL) : Math.max(0, vel - DECEL);
      pos += vel;

      // 4. 판정
      const grace = GRACE_TICKS + (human ? spec.assistGraceTicks : 0);
      if (guardian.phase === 'watch' && tick >= guardian.phaseStart + grace && vel > V_TOL) {
        status = 'caught';
        endTick = tick;
        events.push({ type: 'caught', tick, runner: r.id, speed: vel });
        vel = 0;
        holding = false;
        if (human) combo = 0;
      } else if (pos >= spec.trackLength) {
        // 5. 도착
        status = 'finished';
        endTick = tick;
        pos = spec.trackLength;
        vel = 0;
        holding = false;
        finishedCount += 1;
        place = finishedCount;
        events.push({ type: 'finished', tick, runner: r.id, place });
        if (human) {
          const bonus = Math.floor(Math.max(0, spec.parTicks - tick) / 6) * TIME_BONUS_PER_6_TICKS;
          score += CLEAR_SCORE + bonus;
        }
      }
    }

    return { id: r.id, pos, vel, holding, status, endTick, place, nextInput, combo, score };
  });

  return { tick: tick + 1, guardian, runners, finishedCount, events };
}

/** 러너의 런이 끝났는가 (탈락 또는 도착). 기본은 플레이어(0). */
export function isPlayerDone(state: WorldState, id: number = PLAYER_ID): boolean {
  const p = state.runners[id];
  return !p || p.status !== 'running';
}
