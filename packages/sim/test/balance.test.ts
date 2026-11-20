import { describe, expect, it } from 'vitest';
import { SKILLS, stageStats } from './balance';

/**
 * 인간형 플레이어 모델(가설) 기반 난이도 곡선 회귀 테스트.
 * 모델이 실제 유저와 다를 수 있으므로 엄격한 수치가 아니라 "곡선이 무너지지 않았는가"만 확인한다.
 */
describe('난이도 곡선 회귀 (모델 기반)', () => {
  const N = 60;
  const sample = [1, 10, 20, 30];
  const stats = Object.fromEntries(
    sample.map((st) => [
      st,
      {
        novice: stageStats(st, SKILLS.novice, N),
        average: stageStats(st, SKILLS.average, N),
        expert: stageStats(st, SKILLS.expert, N),
      },
    ]),
  );

  it('평균 플레이어는 모든 샘플 스테이지에서 대체로 클리어한다 (생존 난이도 낮음, GDD "더 쉽게")', () => {
    for (const st of sample) expect(stats[st]!.average.clearRate).toBeGreaterThanOrEqual(0.9);
  });

  it('숙련도 순서: ★2 달성률은 expert ≥ average ≥ novice', () => {
    for (const st of sample) {
      const s = stats[st]!;
      expect(s.expert.star2Rate).toBeGreaterThanOrEqual(s.average.star2Rate);
      expect(s.average.star2Rate).toBeGreaterThanOrEqual(s.novice.star2Rate);
    }
  });

  it('★2 는 평균 플레이어에게 달성 가능하되 보장되지는 않는다 (20~95%)', () => {
    for (const st of sample) {
      const r = stats[st]!.average.star2Rate;
      expect(r).toBeGreaterThan(0.2);
      expect(r).toBeLessThan(0.97);
    }
  });

  it('봇 경쟁은 스테이지가 올라갈수록 치열해진다 (평균 순위 악화)', () => {
    expect(stats[30]!.average.meanPlace).toBeGreaterThan(stats[1]!.average.meanPlace);
  });
});
