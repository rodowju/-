import {
  SAFE_RELEASE_TICKS,
  Rng,
  createWorld,
  guardianSchedule,
  isPlayerDone,
  comboMultiplier,
  PAR_REFERENCE,
  makeStageSpec,
  referenceFinishTicks,
  starsFor,
  step,
  type InputEvent,
  type StageSpec,
} from '../src';

/** 인간형 플레이어 모델 (가설): 릴리즈 시점은 D 이전 mean tick 을 중심으로 정규분포 오차를 가진다. */
export interface Skill {
  readonly name: string;
  /** 평균적으로 D 보다 몇 tick 일찍 놓는가 (안전 여유) */
  readonly mean: number;
  /** 표준편차(tick). 60 Hz 기준 1 tick ≈ 16.7 ms */
  readonly sd: number;
  /** Turnback 이후 다시 누르기까지 반응 지연(tick) */
  readonly reaction: number;
  /** 술래가 돌아서는 모습을 보고 손을 떼기까지의 시각 반응 시간 평균/표준편차(tick) */
  readonly rtMean: number;
  readonly rtSd: number;
}

export const SKILLS: Record<'novice' | 'average' | 'expert', Skill> = {
  novice: { name: 'novice', mean: 14, sd: 6, reaction: 20, rtMean: 17, rtSd: 3 },
  average: { name: 'average', mean: 8, sd: 4, reaction: 12, rtMean: 14, rtSd: 2.5 },
  expert: { name: 'expert', mean: 3, sd: 2, reaction: 6, rtMean: 11, rtSd: 2 },
};

function gauss(rng: Rng): number {
  const u1 = (rng.next() + 1) / 4294967297;
  const u2 = rng.next() / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function modelInputs(spec: StageSpec, skill: Skill, rng: Rng, cycles = 64): InputEvent[] {
  const sch = guardianSchedule(spec, cycles);
  const out: InputEvent[] = [];
  sch.forEach((c, i) => {
    const prev = i === 0 ? undefined : sch[i - 1];
    const down = (prev ? prev.turnbackStart : 0) + Math.max(0, Math.round(skill.reaction + gauss(rng) * 3));
    // 박자를 예측해 놓는 시점과, 술래가 돌아서는 모습을 보고 반응하는 시점 중 이른 쪽
    const lead = Math.round(skill.mean + gauss(rng) * skill.sd);
    const anticipated = c.watchStart + SAFE_RELEASE_TICKS - lead;
    const reactive = c.turnStart + Math.max(3, Math.round(skill.rtMean + gauss(rng) * skill.rtSd));
    const up = Math.max(down + 1, Math.min(anticipated, reactive));
    out.push({ tick: down, type: 'down' }, { tick: up, type: 'up' });
  });
  return out;
}

export interface Attempt {
  readonly cleared: boolean;
  readonly seconds: number;
  readonly place: number;
  readonly total: number;
  /** 클리어 못 하면 0 */
  readonly stars: 0 | 1 | 2 | 3;
  readonly maxMult: number;
  /** 클리어 못 하면 0 */
  readonly finishTick: number;
  /** 같은 스펙에서 PAR_REFERENCE 플레이어의 완주 tick */
  readonly refTick: number;
}

export function attempt(stage: number, seed: number, skill: Skill, assist?: number): Attempt {
  const spec = makeStageSpec(stage, seed, assist);
  const inputs = modelInputs(spec, skill, new Rng(seed ^ 0x5bd1e995));
  let s = createWorld(spec);
  let ptr = 0;
  const sorted = [...inputs].sort((a, b) => a.tick - b.tick);
  let maxMult = 1;
  while (!isPlayerDone(s) && s.tick < 60 * 240) {
    const now: InputEvent[] = [];
    while (ptr < sorted.length && (sorted[ptr]?.tick ?? Infinity) <= s.tick) {
      const ev = sorted[ptr];
      if (ev && ev.tick === s.tick) now.push(ev);
      ptr++;
    }
    s = step(s, spec, now);
    maxMult = Math.max(maxMult, comboMultiplier(s.runners[0]!.combo));
  }
  const p = s.runners[0];
  const cleared = p?.status === 'finished';
  return {
    cleared,
    seconds: s.tick / 60,
    place: p?.place ?? 0,
    total: s.runners.length,
    stars: cleared ? starsFor(spec, p?.endTick ?? s.tick, maxMult) : 0,
    maxMult,
    finishTick: cleared ? (p?.endTick ?? 0) : 0,
    refTick: referenceFinishTicks(spec, PAR_REFERENCE),
  };
}

export interface StageStats {
  readonly clearRate: number;
  readonly meanSeconds: number;
  readonly meanPlace: number;
  /** 시도 대비 별 2개 이상 / 3개 비율 */
  readonly star2Rate: number;
  readonly star3Rate: number;
}

export function stageStats(stage: number, skill: Skill, n = 200, assist?: number): StageStats {
  let clears = 0;
  let sec = 0;
  let place = 0;
  let s2 = 0;
  let s3 = 0;
  for (let i = 0; i < n; i++) {
    const a = attempt(stage, 1000 + i * 31, skill, assist);
    if (a.stars >= 2) s2++;
    if (a.stars === 3) s3++;
    if (a.cleared) {
      clears++;
      sec += a.seconds;
      place += a.place;
    }
  }
  return {
    clearRate: clears / n,
    meanSeconds: clears ? sec / clears : 0,
    meanPlace: clears ? place / clears : 0,
    star2Rate: s2 / n,
    star3Rate: s3 / n,
  };
}

/** 클리어한 시도들의 (완주 tick / 기준 플레이어 tick) 비율 목록 (오름차순) */
export function finishRatios(stage: number, skill: Skill, n = 150): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = attempt(stage, 1000 + i * 31, skill);
    if (a.cleared && a.refTick > 0 && Number.isFinite(a.refTick)) out.push(a.finishTick / a.refTick);
  }
  return out.sort((a, b) => a - b);
}
