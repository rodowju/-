import { describe, expect, it } from 'vitest';
import {
  SAFE_RELEASE_TICKS,
  analyzeCatch,
  createWorld,
  guardianSchedule,
  hashState,
  isPlayerDone,
  makeStageSpec,
  resimulate,
  starsFor,
  step,
  SnapshotBuffer,
  type InputEvent,
  type StageSpec,
} from '../src';

const spec: StageSpec = { ...makeStageSpec(7, 1), botCount: 0 };
const sch = guardianSchedule(spec, 1)[0]!;
const D = sch.watchStart + SAFE_RELEASE_TICKS;

/** 플레이어가 탈락할 때까지 진행하고 탈락 tick 과 상태를 돌려준다 */
function runUntilCaught(inputs: InputEvent[]) {
  let s = createWorld(spec);
  let catchTick = -1;
  while (!isPlayerDone(s) && s.tick < 3000) {
    s = step(s, spec, inputs.filter((i) => i.tick === s.tick));
    for (const e of s.events) if (e.type === 'caught') catchTick = e.tick;
  }
  return { s, catchTick };
}

describe('analyzeCatch', () => {
  it('늦게 풀면 late-release 와 초과 tick', () => {
    const inputs: InputEvent[] = [{ tick: 0, type: 'down' }, { tick: D + 3, type: 'up' }];
    const { s, catchTick } = runUntilCaught(inputs);
    expect(s.runners[0]?.status).toBe('caught');
    const a = analyzeCatch(spec, inputs, catchTick, s.guardian.phaseStart);
    expect(a.kind).toBe('late-release');
    expect(a.lateTicks).toBe(3);
    expect(a.deadline).toBe(D);
  });

  it('끝까지 안 풀면 no-release', () => {
    const inputs: InputEvent[] = [{ tick: 0, type: 'down' }];
    const { s, catchTick } = runUntilCaught(inputs);
    expect(analyzeCatch(spec, inputs, catchTick, s.guardian.phaseStart).kind).toBe('no-release');
  });

  it('Watch 중에 다시 누르면 pressed-in-watch', () => {
    const inputs: InputEvent[] = [{ tick: sch.watchStart + 2, type: 'down' }];
    const { s, catchTick } = runUntilCaught(inputs);
    expect(s.runners[0]?.status).toBe('caught');
    expect(analyzeCatch(spec, inputs, catchTick, s.guardian.phaseStart).kind).toBe('pressed-in-watch');
  });

  it('Assist 는 마감에 반영된다', () => {
    const assisted = { ...spec, assistGraceTicks: 4 };
    expect(analyzeCatch(assisted, [], 0, 100).deadline).toBe(100 + SAFE_RELEASE_TICKS + 4);
  });
});

describe('resimulate', () => {
  it('스냅샷 + 입력 재시뮬레이션이 실시간 결과와 비트 단위로 같다', () => {
    const inputs: InputEvent[] = [{ tick: 0, type: 'down' }, { tick: D + 3, type: 'up' }];
    const buf = new SnapshotBuffer(12, 30);
    let live = createWorld(spec);
    buf.push(live);
    while (!isPlayerDone(live)) {
      live = step(live, spec, inputs.filter((i) => i.tick === live.tick));
      buf.push(live);
    }
    const start = buf.latestAtOrBefore(live.tick - 1 - 180)!;
    const states = resimulate(spec, inputs, start, live.tick);
    expect(states[0]).toBe(start);
    expect(states[states.length - 1]!.tick).toBe(live.tick);
    expect(hashState(states[states.length - 1]!)).toBe(hashState(live));
    // 연속 tick
    states.forEach((s, i) => expect(s.tick).toBe(start.tick + i));
  });
});

describe('starsFor', () => {
  it('클리어 1, par 이내 2, par 이내 + 콤보 ×3 이상 3', () => {
    expect(starsFor(spec, spec.parTicks + 1, 5)).toBe(1);
    expect(starsFor(spec, spec.parTicks, 2)).toBe(2);
    expect(starsFor(spec, spec.parTicks, 3)).toBe(3);
  });
});
