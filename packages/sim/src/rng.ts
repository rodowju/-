/** mulberry32 — 정수 연산만 사용하므로 엔진 간 결과가 동일하다. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }

  /** [0, 2^32) 정수 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** [0, n) 정수 */
  int(n: number): number {
    return this.next() % n;
  }

  /** [lo, hi] 정수(양끝 포함) */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** 확률 permille/1000 (정수 비교, 부동소수점 미사용) */
  chance(permille: number): boolean {
    return this.int(1000) < permille;
  }
}

/** 시드와 인덱스를 섞어 독립 스트림 시드를 만든다. */
export function mixSeed(seed: number, index: number): number {
  return (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}
