import { describe, expect, it } from 'vitest';
import {
  hashState,
  makeReplay,
  makeStageSpec,
  parseReplay,
  runReplay,
  serializeReplay,
  createWorld,
  step,
  SnapshotBuffer,
} from '../src';
import { scriptedInputs } from './helpers';

describe('결정론', () => {
  it('같은 (spec, inputs) → 같은 해시', () => {
    const spec = makeStageSpec(12, 2024);
    const inputs = scriptedInputs(spec, 4);
    const a = runReplay(makeReplay(spec, inputs), { maxTicks: 3000 });
    const b = runReplay(makeReplay(spec, inputs), { maxTicks: 3000 });
    expect(hashState(a.final)).toBe(hashState(b.final));
    expect(a.events).toEqual(b.events);
  });

  it('다른 시드 → 다른 해시', () => {
    const inputs = scriptedInputs(makeStageSpec(12, 1), 4);
    const a = runReplay(makeReplay(makeStageSpec(12, 1), inputs), { untilTick: 600 });
    const b = runReplay(makeReplay(makeStageSpec(12, 2), inputs), { untilTick: 600 });
    expect(hashState(a.final)).not.toBe(hashState(b.final));
  });

  it('직렬화 왕복 후에도 동일 결과', () => {
    const spec = makeStageSpec(3, 77);
    const r = makeReplay(spec, scriptedInputs(spec, 2));
    const back = parseReplay(serializeReplay(r));
    expect(hashState(runReplay(back, { untilTick: 1500 }).final)).toBe(
      hashState(runReplay(r, { untilTick: 1500 }).final),
    );
  });

  it('지원하지 않는 버전은 거부', () => {
    const spec = makeStageSpec(1, 1);
    const bad = JSON.stringify({ ...makeReplay(spec, []), version: 999 });
    expect(() => parseReplay(bad)).toThrow();
  });

  it('골든 해시: 규칙이 바뀌면 의도적으로 갱신해야 한다', () => {
    const spec = makeStageSpec(12, 20260101);
    const r = runReplay(makeReplay(spec, scriptedInputs(spec, 5)), { untilTick: 1200 });
    expect(hashState(r.final)).toMatchInlineSnapshot(`4145851322`);
  });
});

describe('스냅샷 버퍼', () => {
  it('스냅샷에서 이어 재생해도 처음부터와 동일', () => {
    const spec = makeStageSpec(12, 5);
    const inputs = scriptedInputs(spec, 3);
    const buf = new SnapshotBuffer(20, 30);
    let s = createWorld(spec);
    for (let t = 0; t < 600; t++) {
      s = step(s, spec, inputs.filter((i) => i.tick === s.tick));
      buf.push(s);
    }
    const full = hashState(s);

    let from = buf.latestAtOrBefore(300)!;
    expect(from.tick).toBe(300);
    while (from.tick < 600) from = step(from, spec, inputs.filter((i) => i.tick === from.tick));
    expect(hashState(from)).toBe(full);
  });
});
