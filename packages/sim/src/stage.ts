import { CYCLE_COUNT, meters, msToTicks } from './config';
import { Rng } from './rng';
import { PAR_REFERENCE, referenceFinishTicks } from './ideal';
import type { StageSpec } from './types';

interface Tier {
  readonly trackM: number;
  readonly bots: number;
}

/** 트랙 길이와 봇 수는 구간 단위 (GDD §6) */
function tierFor(stage: number): Tier {
  if (stage <= 3) return { trackM: 40, bots: 0 };
  if (stage <= 10) return { trackM: 60, bots: 4 };
  if (stage <= 20) return { trackM: 80, bots: 8 };
  return { trackM: 100, bots: 12 };
}

interface Anchor {
  readonly stage: number;
  readonly chantLo: number;
  readonly chantHi: number;
  readonly watchLo: number;
  readonly watchHi: number;
  /** 봇 실수 확률(‰) */
  readonly mistake: number;
  /** 술래 회전 경고(ms) */
  readonly turnMs: number;
}

/**
 * 난이도 앵커(ms). 구간 끝점은 GDD §6 범위와 일치하고, 앵커 사이는 선형 보간한다.
 * 같은 구간 안에서도 스테이지마다 점진적으로 어려워진다.
 */
const ANCHORS: readonly Anchor[] = [
  { stage: 1, chantLo: 3000, chantHi: 3000, watchLo: 1500, watchHi: 1500, mistake: 0, turnMs: 300 },
  { stage: 3, chantLo: 3000, chantHi: 3000, watchLo: 1500, watchHi: 1500, mistake: 0, turnMs: 300 },
  { stage: 4, chantLo: 2800, chantHi: 3500, watchLo: 1500, watchHi: 1800, mistake: 250, turnMs: 300 },
  { stage: 10, chantLo: 2500, chantHi: 3500, watchLo: 1200, watchHi: 1800, mistake: 150, turnMs: 280 },
  { stage: 11, chantLo: 2400, chantHi: 3500, watchLo: 1200, watchHi: 1800, mistake: 140, turnMs: 280 },
  { stage: 20, chantLo: 1800, chantHi: 3500, watchLo: 900, watchHi: 1800, mistake: 90, turnMs: 240 },
  { stage: 21, chantLo: 1600, chantHi: 3500, watchLo: 800, watchHi: 1500, mistake: 80, turnMs: 240 },
  { stage: 30, chantLo: 1200, chantHi: 3500, watchLo: 600, watchHi: 1500, mistake: 40, turnMs: 200 },
];

/**
 * par = 기준 플레이어(PAR_REFERENCE) 소요 시간 × PAR_PCT[stage-1] / 100.
 * 값은 test/calibrate.report.test.ts(CALIBRATE=1)로 산출한다 — 인간형 모델 기반 임시값이며,
 * 실제 플레이 데이터가 쌓이면 완주 시간 분포의 백분위로 대체한다.
 */
const PAR_PCT: readonly number[] = [
  120, 120, 120, 103, 103, 103, 103, 103, 102, 102, 103, 103, 102, 102, 103, 103, 102, 102, 102, 102, 103, 103, 102, 102, 102, 103,
  103, 103, 103, 103,
];

const lerpInt = (a: number, b: number, num: number, den: number): number => a + Math.round(((b - a) * num) / den);
const round10 = (v: number): number => Math.round(v / 10) * 10;

function anchorFor(stage: number): Anchor {
  const last = ANCHORS[ANCHORS.length - 1];
  const first = ANCHORS[0];
  if (!first || !last) throw new Error('no anchors');
  if (stage >= last.stage) return last; // 30 이후는 최고 난이도 고정
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const a = ANCHORS[i];
    const b = ANCHORS[i + 1];
    if (!a || !b) continue;
    if (stage >= a.stage && stage <= b.stage) {
      const num = stage - a.stage;
      const den = b.stage - a.stage;
      return {
        stage,
        chantLo: round10(lerpInt(a.chantLo, b.chantLo, num, den)),
        chantHi: round10(lerpInt(a.chantHi, b.chantHi, num, den)),
        watchLo: round10(lerpInt(a.watchLo, b.watchLo, num, den)),
        watchHi: round10(lerpInt(a.watchHi, b.watchHi, num, den)),
        mistake: lerpInt(a.mistake, b.mistake, num, den),
        turnMs: round10(lerpInt(a.turnMs, b.turnMs, num, den)),
      };
    }
  }
  return first;
}

/** Assist 상한(tick). 60 ms ≈ 4 tick */
export const ASSIST_CAP = msToTicks(60);

/** 처음 플레이하는 유저의 기본 Assist: 초반 스테이지에서 60ms, 점진 해제 (GDD §6) */
export function defaultAssist(stage: number): number {
  if (stage <= 3) return msToTicks(60);
  if (stage <= 6) return msToTicks(30);
  return 0;
}

export interface StageOutcome {
  readonly cleared: boolean;
  /** 해당 스테이지에서 잃은 목숨 수 */
  readonly deaths: number;
}

/**
 * 동적 난이도 (GDD §6 "연속 성공 시 단계적 해제"):
 * 무사고 클리어 → 1 tick 감소, 2회 이상 탈락 후 클리어 또는 목숨 소진 → 1 tick 증가.
 * 그 외(1회 탈락 후 클리어)는 유지.
 */
export function adjustAssist(prev: number, outcome: StageOutcome): number {
  let next = prev;
  if (outcome.cleared && outcome.deaths === 0) next = prev - 1;
  else if (!outcome.cleared || outcome.deaths >= 2) next = prev + 1;
  return Math.max(0, Math.min(ASSIST_CAP, next));
}

function parPctFor(stage: number): number {
  return PAR_PCT[Math.min(stage, PAR_PCT.length) - 1] ?? 110;
}

export function makeStageSpec(stage: number, seed: number, assistGraceTicks?: number): StageSpec {
  if (!Number.isInteger(stage) || stage < 1) throw new RangeError('stage must be an integer >= 1');
  const tier = tierFor(stage);
  const anchor = anchorFor(stage);
  const rng = new Rng(seed);
  const chantTicks: number[] = [];
  const watchTicks: number[] = [];
  for (let i = 0; i < CYCLE_COUNT; i++) {
    chantTicks.push(msToTicks(rng.range(anchor.chantLo, anchor.chantHi)));
    watchTicks.push(msToTicks(rng.range(anchor.watchLo, anchor.watchHi)));
  }
  const trackLength = meters(tier.trackM);
  const turnTicks = msToTicks(anchor.turnMs);
  const base: StageSpec = {
    stage,
    seed: seed >>> 0,
    trackLength,
    chantTicks,
    watchTicks,
    botCount: tier.bots,
    botMistakePermille: anchor.mistake,
    assistGraceTicks: Math.max(0, Math.min(ASSIST_CAP, assistGraceTicks ?? defaultAssist(stage))),
    parTicks: 0,
    turnTicks,
  };
  const ref = referenceFinishTicks(base, PAR_REFERENCE);
  return { ...base, parTicks: Math.ceil((ref * parPctFor(stage)) / 100) };
}
