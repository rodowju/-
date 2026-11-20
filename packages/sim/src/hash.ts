import type { WorldState } from './types';

const PHASE_CODE = { chant: 1, turn: 2, watch: 3, turnback: 4 } as const;
const STATUS_CODE = { running: 1, caught: 2, finished: 3 } as const;

/** FNV-1a 32bit 로 상태를 요약한다 (결정론 회귀 테스트·서버 검증용). */
export function hashState(s: WorldState): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    // 부호 있는 정수/큰 정수도 안전하게 하위·상위 32bit를 모두 섞는다.
    const lo = n | 0;
    const hi = Math.floor(n / 4294967296) | 0;
    for (const v of [lo, hi]) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 24) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(s.tick);
  mix(PHASE_CODE[s.guardian.phase]);
  mix(s.guardian.phaseStart);
  mix(s.guardian.cycleIdx);
  mix(s.comboPoints);
  mix(s.score);
  mix(s.finishedCount);
  for (const r of s.runners) {
    mix(r.id);
    mix(r.pos);
    mix(r.vel);
    mix(r.holding ? 1 : 0);
    mix(STATUS_CODE[r.status]);
    mix(r.endTick);
    mix(r.place);
    mix(r.nextInput);
  }
  return h >>> 0;
}
