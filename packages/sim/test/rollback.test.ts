import { describe, expect, it } from 'vitest';
import {
  RollbackWorld,
  Rng,
  analyzeCatch,
  createWorld,
  guardianSchedule,
  hashState,
  makeStageSpec,
  step,
  SAFE_RELEASE_TICKS,
  type InputEvent,
  type StageSpec,
  type WorldState,
} from '../src';

/** 사람 h명의 무작위 입력 (러너별 tick 엄격 증가, down/up 교대) */
function randomInputs(spec: StageSpec, rng: Rng, until: number): InputEvent[] {
  const out: InputEvent[] = [];
  for (let r = 0; r < spec.humans; r++) {
    let t = rng.int(20);
    let down = true;
    while (t < until) {
      out.push({ tick: t, type: down ? 'down' : 'up', runner: r });
      down = !down;
      t += 1 + rng.int(down ? 60 : 140);
    }
  }
  return out;
}

/** 기준: 모든 입력을 알고 처음부터 순차 시뮬레이션 */
function reference(spec: StageSpec, inputs: readonly InputEvent[], until: number): WorldState {
  let s = createWorld(spec);
  while (s.tick < until) s = step(s, spec, inputs.filter((e) => e.tick === s.tick));
  return s;
}

describe('다인원 시뮬레이션', () => {
  it('사람 수만큼 봇이 줄어 총 러너 수가 유지된다', () => {
    const a = makeStageSpec(12, 1);
    const b = makeStageSpec(12, 1, 0, { humans: 4 });
    expect(a.humans + a.botCount).toBe(b.humans + b.botCount);
    expect(createWorld(b).runners).toHaveLength(a.humans + a.botCount);
  });

  it('각 사람은 자기 입력으로만 움직이고 점수·콤보가 따로 쌓인다', () => {
    const spec = makeStageSpec(7, 3, 0, { humans: 2 });
    const c0 = guardianSchedule(spec, 1)[0]!;
    const D = c0.watchStart + SAFE_RELEASE_TICKS;
    const inputs: InputEvent[] = [
      { tick: 0, type: 'down', runner: 0 },
      { tick: D, type: 'up', runner: 0 }, // 퍼펙트
      { tick: 0, type: 'down', runner: 1 }, // 끝까지 안 놓음 → 탈락
    ];
    const s = reference(spec, inputs, c0.turnbackStart);
    expect(s.runners[0]!.status).toBe('running');
    expect(s.runners[0]!.combo).toBeGreaterThan(0);
    expect(s.runners[0]!.score).toBeGreaterThan(0);
    expect(s.runners[1]!.status).toBe('caught');
    expect(s.runners[1]!.score).toBe(0);
    // 러너별 탈락 분석
    expect(analyzeCatch(spec, inputs, s.runners[1]!.endTick, c0.watchStart, 1).kind).toBe('no-release');
  });

  it('봇 입력은 사람 수와 무관하게 봇 인덱스로 결정된다 (사람이 늘어도 봇 행동이 재배치되지 않음)', () => {
    const spec = makeStageSpec(12, 9, 0, { humans: 3 });
    const s = reference(spec, [], 600);
    // 사람은 입력이 없으니 그대로, 봇은 달린다
    expect(s.runners.slice(0, 3).every((r) => r.pos === 0)).toBe(true);
    expect(s.runners.slice(3).some((r) => r.pos > 0)).toBe(true);
  });
});

describe('RollbackWorld', () => {
  const spec = makeStageSpec(12, 77, 0, { humans: 3 });
  const UNTIL = 1500;

  it('입력이 늦게·뒤섞여 도착해도 결과는 처음부터 다 알았을 때와 비트 단위로 같다 (무작위 50회)', () => {
    for (let trial = 0; trial < 50; trial++) {
      const rng = new Rng(1000 + trial);
      const inputs = randomInputs(spec, rng, UNTIL);
      const ref = reference(spec, inputs, UNTIL);

      const rw = new RollbackWorld(spec, { recentTicks: 60, coarseEvery: 30 });
      // 각 입력은 자기 tick 이후 0~200 tick 늦게 도착 (일부는 recent 범위 밖 → coarse 에서 되감기)
      const arrivals = inputs
        .map((e) => ({ e, at: e.tick + rng.int(200) }))
        .sort((a, b) => a.at - b.at || rng.int(3) - 1);
      let i = 0;
      for (let t = 0; t <= UNTIL; t += 1 + rng.int(7)) {
        while (i < arrivals.length && arrivals[i]!.at <= t) rw.addInput(arrivals[i++]!.e);
        rw.advanceTo(Math.min(t, UNTIL));
      }
      while (i < arrivals.length) rw.addInput(arrivals[i++]!.e);
      rw.advanceTo(UNTIL);
      expect(hashState(rw.state), `trial ${trial}`).toBe(hashState(ref));
    }
  });

  it('중복 입력은 무시된다', () => {
    const rw = new RollbackWorld(spec);
    const e: InputEvent = { tick: 10, type: 'down', runner: 1 };
    rw.advanceTo(50);
    expect(rw.addInput(e)).toBeGreaterThan(0);
    expect(rw.addInput(e)).toBe(0);
    expect(rw.inputs()).toHaveLength(1);
  });

  it('예측 입력을 확정값으로 교체하면 확정값만 있었던 것과 같다', () => {
    const predicted: InputEvent = { tick: 100, type: 'up', runner: 0 };
    const confirmed: InputEvent = { tick: 104, type: 'up', runner: 0 };
    const base: InputEvent[] = [{ tick: 0, type: 'down', runner: 0 }];

    const rw = new RollbackWorld(spec);
    for (const e of base) rw.addInput(e);
    rw.addInput(predicted);
    rw.advanceTo(300);
    rw.replaceInput(predicted, confirmed);
    rw.advanceTo(400);
    expect(hashState(rw.state)).toBe(hashState(reference(spec, [...base, confirmed], 400)));
  });

  it('입력 제거 후 상태는 그 입력이 없던 것과 같다', () => {
    const rw = new RollbackWorld(spec);
    const keep: InputEvent = { tick: 0, type: 'down', runner: 2 };
    const drop: InputEvent = { tick: 50, type: 'up', runner: 2 };
    rw.addInput(keep);
    rw.addInput(drop);
    rw.advanceTo(200);
    rw.removeInput(drop);
    expect(hashState(rw.state)).toBe(hashState(reference(spec, [keep], 200)));
  });

  it('stateAt: 최근 구간·오래된 구간 모두 처음부터 계산한 상태와 같다', () => {
    const inputs = randomInputs(spec, new Rng(5), 900);
    const rw = new RollbackWorld(spec, { recentTicks: 50, coarseEvery: 30 });
    for (const e of inputs) rw.addInput(e);
    rw.advanceTo(900);
    for (const t of [0, 1, 29, 30, 31, 333, 849, 850, 899, 900]) {
      expect(rw.hashAt(t), `tick ${t}`).toBe(hashState(reference(spec, inputs, t)));
    }
    expect(rw.stateAt(901)).toBeUndefined();
  });

  it('rebuild 는 같은 입력으로 같은 상태를 만든다', () => {
    const inputs = randomInputs(spec, new Rng(8), 700);
    const a = RollbackWorld.rebuild(spec, inputs, 700);
    expect(hashState(a.state)).toBe(hashState(reference(spec, inputs, 700)));
  });

  it('advanceTo 는 전진 중 이벤트만 돌려주고 되감기 재시뮬레이션 이벤트는 돌려주지 않는다', () => {
    const rw = new RollbackWorld(spec);
    const ev = rw.advanceTo(400);
    expect(ev.some((e) => e.type === 'phase')).toBe(true);
    const n = rw.addInput({ tick: 10, type: 'down', runner: 0 });
    expect(n).toBeGreaterThan(0);
    expect(rw.advanceTo(400)).toEqual([]);
  });

  it('음수/비정수 tick 은 거부', () => {
    const rw = new RollbackWorld(spec);
    expect(() => rw.addInput({ tick: -1, type: 'down' })).toThrow();
    expect(() => rw.addInput({ tick: 1.5, type: 'down' })).toThrow();
  });
});
