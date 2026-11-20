import { CYCLE_COUNT, MAX_SPEED, meters, msToTicks } from './config';
import { Rng } from './rng';
import type { StageSpec } from './types';

interface Tier {
  readonly trackM: number;
  readonly chantMs: readonly [number, number];
  readonly watchMs: readonly [number, number];
  readonly bots: number;
  readonly mistakePermille: number;
}

/** GDD §6 난이도 곡선 */
function tierFor(stage: number): Tier {
  if (stage <= 3) return { trackM: 40, chantMs: [3000, 3000], watchMs: [1500, 1500], bots: 0, mistakePermille: 0 };
  if (stage <= 10) return { trackM: 60, chantMs: [2500, 3500], watchMs: [1200, 1800], bots: 4, mistakePermille: 200 };
  if (stage <= 20) return { trackM: 80, chantMs: [1800, 3500], watchMs: [900, 1800], bots: 8, mistakePermille: 120 };
  return { trackM: 100, chantMs: [1200, 3500], watchMs: [600, 1500], bots: 12, mistakePermille: 60 };
}

/** Assist: 초반 스테이지에서 유예 +60ms, 점진 해제 (GDD §6). */
function assistFor(stage: number): number {
  if (stage <= 3) return msToTicks(60);
  if (stage <= 6) return msToTicks(30);
  return 0;
}

export function makeStageSpec(stage: number, seed: number, assistGraceTicks?: number): StageSpec {
  if (!Number.isInteger(stage) || stage < 1) throw new RangeError('stage must be an integer >= 1');
  const tier = tierFor(stage);
  const rng = new Rng(seed);
  const chantTicks: number[] = [];
  const watchTicks: number[] = [];
  for (let i = 0; i < CYCLE_COUNT; i++) {
    chantTicks.push(msToTicks(rng.range(tier.chantMs[0], tier.chantMs[1])));
    watchTicks.push(msToTicks(rng.range(tier.watchMs[0], tier.watchMs[1])));
  }
  const trackLength = meters(tier.trackM);
  return {
    stage,
    seed: seed >>> 0,
    trackLength,
    chantTicks,
    watchTicks,
    botCount: tier.bots,
    botMistakePermille: tier.mistakePermille,
    assistGraceTicks: assistGraceTicks ?? assistFor(stage),
    // 최대 속도로 달리는 시간의 1.6배 (정지 손실 감안한 가설값)
    parTicks: Math.ceil(((trackLength / MAX_SPEED) * 16) / 10),
  };
}
