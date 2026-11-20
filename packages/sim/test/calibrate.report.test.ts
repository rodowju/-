import { describe, it } from 'vitest';
import { SKILLS, finishRatios } from './balance';

/**
 * CALIBRATE=1 일 때만 실행. "average" 모델 플레이어의 ★2 달성률이 목표(스테이지 1: 65% → 30: 35%)가 되도록
 * 스테이지별 parPct 를 산출해 출력한다. 출력값을 src/stage.ts 의 PAR_PCT 에 붙여 넣는다.
 */
describe.skipIf(!process.env.CALIBRATE)('par calibration', () => {
  it('prints PAR_PCT', () => {
    const out: number[] = [];
    for (let stage = 1; stage <= 30; stage++) {
      const target = 0.65 - ((0.65 - 0.35) * (stage - 1)) / 29;
      const r = finishRatios(stage, SKILLS.average, 150);
      const idx = Math.min(r.length - 1, Math.max(0, Math.floor(target * r.length)));
      out.push(Math.ceil((r[idx] ?? 1) * 100));
    }
    console.log(JSON.stringify(out));
  });
});
