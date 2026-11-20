import { SAFE_RELEASE_TICKS } from './config';
import type { InputEvent, StageSpec } from './types';

export type CatchKind =
  /** Watch 이전에 풀지 않고 계속 홀드 */
  | 'no-release'
  /** 마감(D) 이후에 풀었음 */
  | 'late-release'
  /** 이미 Watch 중인데 다시 눌러 움직임 */
  | 'pressed-in-watch';

export interface CatchAnalysis {
  readonly kind: CatchKind;
  readonly watchStart: number;
  /** 마지막으로 안전했던 릴리즈 tick (Assist 포함) */
  readonly deadline: number;
  /** 마지막 릴리즈 tick (late-release 일 때) */
  readonly releaseTick?: number;
  /** 마감 초과 tick 수 (late-release 일 때, 최소 0) */
  readonly lateTicks?: number;
}

/**
 * 탈락 원인을 입력 로그에서 분석한다 (탈락 리플레이의 "왜"에 해당).
 * @param catchTick 탈락이 발생한 tick
 * @param watchStart 탈락한 Watch 구간의 시작 tick
 */
export function analyzeCatch(
  spec: StageSpec,
  inputs: readonly InputEvent[],
  catchTick: number,
  watchStart: number,
  runner = 0,
): CatchAnalysis {
  const deadline = watchStart + SAFE_RELEASE_TICKS + spec.assistGraceTicks;
  let last: InputEvent | undefined;
  for (const ev of inputs) {
    if ((ev.runner ?? 0) !== runner) continue;
    if (ev.tick <= catchTick && (!last || ev.tick >= last.tick)) last = ev;
  }
  if (!last || (last.type === 'down' && last.tick < watchStart)) {
    return { kind: 'no-release', watchStart, deadline };
  }
  if (last.type === 'down') {
    return { kind: 'pressed-in-watch', watchStart, deadline };
  }
  return {
    kind: 'late-release',
    watchStart,
    deadline,
    releaseTick: last.tick,
    lateTicks: Math.max(0, last.tick - deadline),
  };
}

/**
 * ★3 에 필요한 콤보 배율. 사이클 수가 적은 초반은 낮게, 후반은 높게 (가설값).
 */
export function comboTargetFor(stage: number): number {
  if (stage <= 3) return 2;
  if (stage <= 10) return 3;
  if (stage <= 20) return 4;
  return 5;
}

/** 별 개수 (GDD §4.5): 1 클리어, 2 시간(par 이내), 3 par 이내 + 목표 콤보 배율 달성 */
export function starsFor(spec: StageSpec, finishTick: number, maxMultiplier: number): 1 | 2 | 3 {
  if (finishTick > spec.parTicks) return 1;
  return maxMultiplier >= comboTargetFor(spec.stage) ? 3 : 2;
}
