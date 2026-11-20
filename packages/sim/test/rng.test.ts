import { describe, expect, it } from 'vitest';
import { Rng } from '../src';

describe('Rng', () => {
  it('같은 시드는 같은 수열', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('다른 시드는 다른 수열', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
  it('range 는 양끝 포함 범위 안', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
  });
  it('골든 값 (엔진/수정 회귀 감지)', () => {
    const r = new Rng(42);
    expect([r.next(), r.next(), r.next()]).toMatchInlineSnapshot(`
      [
        2581720956,
        1925393290,
        3661312704,
      ]
    `);
  });
});
