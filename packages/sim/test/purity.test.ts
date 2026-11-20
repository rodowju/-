import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 코어는 DOM/Node/시간/비결정 API 에 의존하면 안 된다 (아키텍처 §3, §4.2). */
const FORBIDDEN = [
  /\bDate\.now\b/,
  /\bnew Date\b/,
  /\bMath\.random\b/,
  /\bperformance\.now\b/,
  /\bprocess\./,
  /\bdocument\./,
  /\bwindow\./,
  /\brequire\(/,
  /from ['"]node:/,
  /\bMath\.(sin|cos|tan|exp|log|pow|sqrt)\b/,
];

describe('sim 코어 순수성', () => {
  const dir = join(__dirname, '../src');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    it(`${file} 에 금지 API 가 없다`, () => {
      // 주석은 제외하고 검사
      const code = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const re of FORBIDDEN) expect(code).not.toMatch(re);
    });
  }
});
