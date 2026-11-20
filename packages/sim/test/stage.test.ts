import { describe, expect, it } from 'vitest';
import { CYCLE_COUNT, makeStageSpec, meters, msToTicks } from '../src';

describe('makeStageSpec', () => {
  it('같은 입력은 같은 스펙', () => {
    expect(makeStageSpec(12, 99)).toEqual(makeStageSpec(12, 99));
  });
  it('스테이지 구간별 난이도 (GDD §6)', () => {
    const s1 = makeStageSpec(1, 1);
    expect(s1.trackLength).toBe(meters(40));
    expect(s1.botCount).toBe(0);
    expect(new Set(s1.chantTicks)).toEqual(new Set([msToTicks(3000)]));
    expect(makeStageSpec(5, 1).botCount).toBe(4);
    expect(makeStageSpec(15, 1).botCount).toBe(8);
    expect(makeStageSpec(25, 1).botCount).toBe(12);
    expect(makeStageSpec(25, 1).trackLength).toBe(meters(100));
  });
  it('가변 구간 범위 준수', () => {
    const s = makeStageSpec(25, 3);
    expect(s.chantTicks).toHaveLength(CYCLE_COUNT);
    for (const c of s.chantTicks) {
      expect(c).toBeGreaterThanOrEqual(msToTicks(1200));
      expect(c).toBeLessThanOrEqual(msToTicks(3500));
    }
    for (const w of s.watchTicks) {
      expect(w).toBeGreaterThanOrEqual(msToTicks(600));
      expect(w).toBeLessThanOrEqual(msToTicks(1500));
    }
  });
  it('Assist 는 초반에만', () => {
    expect(makeStageSpec(1, 1).assistGraceTicks).toBeGreaterThan(0);
    expect(makeStageSpec(7, 1).assistGraceTicks).toBe(0);
  });
  it('잘못된 stage 거부', () => {
    expect(() => makeStageSpec(0, 1)).toThrow();
    expect(() => makeStageSpec(1.5, 1)).toThrow();
  });
});

import { ASSIST_CAP, adjustAssist, defaultAssist, idealFinishTicks, referenceFinishTicks, PAR_REFERENCE, createWorld, rankOf, aliveCount, step, starsFor, comboTargetFor, type WorldState } from '../src';

describe('난이도 곡선 (30 스테이지)', () => {
  const specs = Array.from({ length: 30 }, (_, i) => makeStageSpec(i + 1, 4242));
  const min = (a: readonly number[]): number => Math.min(...a);

  it('트랙 길이·봇 수는 비감소, 술래 경고(turn)는 비증가', () => {
    for (let i = 1; i < specs.length; i++) {
      const p = specs[i - 1]!;
      const c = specs[i]!;
      expect(c.trackLength).toBeGreaterThanOrEqual(p.trackLength);
      expect(c.botCount).toBeGreaterThanOrEqual(p.botCount);
      expect(c.turnTicks).toBeLessThanOrEqual(p.turnTicks);
    }
  });

  it('구간 끝점은 GDD §6 범위와 일치', () => {
    expect(specs[9]!.chantTicks.every((t) => t >= msToTicks(2500) && t <= msToTicks(3500))).toBe(true);
    expect(specs[19]!.watchTicks.every((t) => t >= msToTicks(900) && t <= msToTicks(1800))).toBe(true);
    expect(min(specs[29]!.chantTicks)).toBeGreaterThanOrEqual(msToTicks(1200));
    expect(min(specs[29]!.watchTicks)).toBeGreaterThanOrEqual(msToTicks(600));
    expect(specs[29]!.turnTicks).toBe(msToTicks(200));
  });

  it('시드 하한 변화가 점진적이다 (스테이지 30 에서 가장 짧은 chant 하한)', () => {
    // 하한 앵커는 단조 감소해야 한다 — 표본 최솟값으로 대략 확인
    expect(min(makeStageSpec(30, 1).chantTicks)).toBeLessThanOrEqual(min(makeStageSpec(11, 1).chantTicks));
  });

  it('par 는 유한하고, 기준 플레이어보다 약간 느린 값이다', () => {
    for (const s of specs) {
      expect(Number.isFinite(s.parTicks)).toBe(true);
      const ref = referenceFinishTicks(s, PAR_REFERENCE);
      expect(s.parTicks).toBeGreaterThanOrEqual(ref);
      expect(s.parTicks).toBeLessThanOrEqual(Math.ceil(ref * 1.3));
      expect(idealFinishTicks(s)).toBeLessThan(ref); // 이상적 플레이가 기준보다 빠르다
    }
  });

  it('30 이후 스테이지는 최고 난이도로 고정', () => {
    const a = makeStageSpec(30, 7);
    const b = makeStageSpec(45, 7);
    expect(b.trackLength).toBe(a.trackLength);
    expect(b.turnTicks).toBe(a.turnTicks);
  });
});

describe('Assist 동적 조정', () => {
  it('무사고 클리어는 1 감소(0 미만 불가)', () => {
    expect(adjustAssist(3, { cleared: true, deaths: 0 })).toBe(2);
    expect(adjustAssist(0, { cleared: true, deaths: 0 })).toBe(0);
  });
  it('1회 탈락 후 클리어는 유지', () => {
    expect(adjustAssist(2, { cleared: true, deaths: 1 })).toBe(2);
  });
  it('2회 이상 탈락 또는 목숨 소진은 1 증가(상한 ASSIST_CAP)', () => {
    expect(adjustAssist(1, { cleared: true, deaths: 2 })).toBe(2);
    expect(adjustAssist(1, { cleared: false, deaths: 3 })).toBe(2);
    expect(adjustAssist(ASSIST_CAP, { cleared: false, deaths: 3 })).toBe(ASSIST_CAP);
  });
  it('기본값은 초반 스테이지에서 크고 점진 해제', () => {
    expect(defaultAssist(1)).toBeGreaterThan(defaultAssist(5));
    expect(defaultAssist(5)).toBeGreaterThan(defaultAssist(7));
    expect(defaultAssist(7)).toBe(0);
  });
  it('makeStageSpec 에 전달한 Assist 는 상한으로 잘린다', () => {
    expect(makeStageSpec(10, 1, 99).assistGraceTicks).toBe(ASSIST_CAP);
    expect(makeStageSpec(10, 1, -5).assistGraceTicks).toBe(0);
  });
});

describe('순위', () => {
  const spec = makeStageSpec(7, 11);
  const run = (ticks: number): WorldState => {
    let s = createWorld(spec);
    while (s.tick < ticks) s = step(s, spec, []);
    return s;
  };
  it('시작 직후 동률은 id 오름차순', () => {
    const s = createWorld(spec);
    expect(rankOf(s, 0)).toBe(1);
    expect(rankOf(s, 3)).toBe(4);
  });
  it('탈락자는 진행 중인 러너보다 뒤', () => {
    const forced = { ...spec, botMistakePermille: 1000 };
    let s = createWorld(forced);
    while (s.tick < 60 * 30) s = step(s, forced, []);
    // 봇 전원 탈락, 플레이어(정지)는 진행 중 → 1위
    expect(rankOf(s, 0)).toBe(1);
    expect(aliveCount(s)).toBe(1);
  });
  it('rank 는 1..N 의 순열', () => {
    const s = run(200);
    const ranks = s.runners.map((r) => rankOf(s, r.id)).sort((a, b) => a - b);
    expect(ranks).toEqual(s.runners.map((_, i) => i + 1));
  });
});

describe('별 기준', () => {
  it('★3 콤보 목표는 스테이지가 올라갈수록 비감소', () => {
    let prev = 0;
    for (let st = 1; st <= 30; st++) {
      const t = comboTargetFor(st);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
  it('par 초과면 콤보와 무관하게 ★1', () => {
    const s = makeStageSpec(12, 1);
    expect(starsFor(s, s.parTicks + 1, 5)).toBe(1);
    expect(starsFor(s, s.parTicks, comboTargetFor(12))).toBe(3);
    expect(starsFor(s, s.parTicks, comboTargetFor(12) - 1)).toBe(2);
  });
});
