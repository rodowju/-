import { CYCLE_COUNT, SAFE_RELEASE_TICKS, TURN_TICKS, msToTicks } from './config';
import { guardianSchedule } from './guardian';
import { Rng, mixSeed } from './rng';
import type { InputEvent, StageSpec } from './types';

const cache = new WeakMap<StageSpec, readonly (readonly InputEvent[])[]>();

/**
 * 봇별 입력 로그를 스펙에서 결정론적으로 생성한다.
 * 봇은 일반 러너와 동일한 입력 경로를 쓰므로 판정 규칙이 플레이어와 같다.
 */
export function getBotInputs(spec: StageSpec): readonly (readonly InputEvent[])[] {
  const hit = cache.get(spec);
  if (hit) return hit;
  const schedule = guardianSchedule(spec, CYCLE_COUNT);
  const all: InputEvent[][] = [];
  for (let b = 0; b < spec.botCount; b++) {
    const rng = new Rng(mixSeed(spec.seed, b));
    const reaction = msToTicks(150) + rng.int(msToTicks(250) + 1);
    const inputs: InputEvent[] = [];
    for (let c = 0; c < schedule.length; c++) {
      const cur = schedule[c];
      if (!cur) continue;
      const prev = c === 0 ? undefined : schedule[c - 1];
      const downAt = (prev ? prev.turnbackStart : 0) + reaction;
      const mistake = rng.chance(spec.botMistakePermille);
      const upAt = mistake
        ? cur.watchStart + SAFE_RELEASE_TICKS + 1 + rng.int(6) // 늦은 릴리즈 → 탈락
        : cur.watchStart + SAFE_RELEASE_TICKS - rng.int(TURN_TICKS + 1);
      inputs.push({ tick: downAt, type: 'down' });
      inputs.push({ tick: upAt, type: 'up' });
    }
    all.push(inputs);
  }
  cache.set(spec, all);
  return all;
}
