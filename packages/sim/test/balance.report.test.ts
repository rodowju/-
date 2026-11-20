import { describe, it } from 'vitest';
import { SKILLS, stageStats } from './balance';

/** BALANCE_REPORT=1 일 때만 난이도 곡선 표를 출력한다 (튜닝용). */
describe.skipIf(!process.env.BALANCE_REPORT)('balance report', () => {
  it('prints table', () => {
    const rows: Record<string, string>[] = [];
    const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
    for (let stage = 1; stage <= 30; stage += stage < 4 || stage > 28 ? 1 : 3) {
      const row: Record<string, string> = { stage: String(stage) };
      for (const k of ['novice', 'average', 'expert'] as const) {
        const st = stageStats(stage, SKILLS[k], 120);
        row[`${k} clr`] = pct(st.clearRate);
        row[`${k} ★2+`] = pct(st.star2Rate);
        row[`${k} ★3`] = pct(st.star3Rate);
        if (k === 'average') row['avg place'] = st.meanPlace.toFixed(1);
      }
      rows.push(row);
    }
    console.table(rows);
  });
});
