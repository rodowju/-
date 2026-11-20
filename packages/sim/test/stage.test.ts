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
