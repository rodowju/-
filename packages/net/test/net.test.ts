import { describe, expect, it } from 'vitest';
import {
  CONFIRM_DELAY,
  ClockSync,
  INPUT_FUTURE_LIMIT,
  INPUT_PAST_TOLERANCE,
  TICK_MS,
  acceptTick,
  checkGhost,
  leadTicks,
  parseC2S,
  pickGhost,
} from '../src';
import { SAFE_RELEASE_TICKS, canonicalSeed, guardianSchedule, makeStageSpec } from '@freeze/sim';

describe('프로토콜 파싱 (서버 입력 검증)', () => {
  it('정상 메시지', () => {
    expect(parseC2S('{"t":"input","type":"down","tick":10,"cid":1}')).toEqual({ t: 'input', type: 'down', tick: 10, cid: 1 });
    expect(parseC2S('{"t":"queue","stage":5}')).toEqual({ t: 'queue', stage: 5 });
    expect(parseC2S('{"t":"ping","c":12.5}')).toEqual({ t: 'ping', c: 12.5 });
  });
  it('잘못된 메시지는 null (예외 없음)', () => {
    for (const bad of [
      'not json',
      '[]',
      '{"t":"input","type":"jump","tick":1,"cid":1}',
      '{"t":"input","type":"down","tick":-1,"cid":1}',
      '{"t":"input","type":"down","tick":1.5,"cid":1}',
      '{"t":"input","type":"down","tick":1}',
      '{"t":"queue","stage":0}',
      '{"t":"unknown"}',
      'x'.repeat(5000),
      42,
    ]) {
      expect(parseC2S(bad)).toBeNull();
    }
  });
});

describe('입력 수락 정책 (치트 방지)', () => {
  it('허용치 안의 과거 입력은 그대로 수락', () => {
    expect(acceptTick(98, 100, -1)).toEqual({ tick: 98, late: false });
  });
  it('허용치보다 늦은 입력은 과거로 끼워 넣지 않고 현재 tick 으로 (시간 되돌리기 치트 차단)', () => {
    expect(acceptTick(100 - INPUT_PAST_TOLERANCE - 1, 100, -1)).toEqual({ tick: 100, late: true });
    expect(acceptTick(0, 100, -1)).toEqual({ tick: 100, late: true });
  });
  it('먼 미래 입력은 상한으로', () => {
    expect(acceptTick(10_000, 100, -1).tick).toBe(100 + INPUT_FUTURE_LIMIT);
  });
  it('같은 러너의 입력 tick 은 엄격 증가', () => {
    expect(acceptTick(105, 100, 105).tick).toBe(106);
    expect(acceptTick(100, 100, 110).tick).toBe(111);
  });
  it('확정 지연은 허용치보다 크다 (확정된 tick 은 다시 바뀌지 않음)', () => {
    expect(CONFIRM_DELAY).toBeGreaterThan(INPUT_PAST_TOLERANCE);
  });
  it('리드: 지연이 클수록 크고, 미래 상한 안에 있다', () => {
    expect(leadTicks(0, 0)).toBeGreaterThanOrEqual(1);
    expect(leadTicks(200, 20)).toBeGreaterThan(leadTicks(40, 5));
    expect(leadTicks(5000, 500)).toBeLessThan(INPUT_FUTURE_LIMIT);
  });
  it('리드를 따르면 편도 지연 + 지터 안에서 입력이 허용치 안에 도착한다', () => {
    for (const rtt of [20, 60, 120, 200]) {
      const jitter = 15;
      const lead = leadTicks(rtt, jitter);
      const travelTicks = (rtt / 2 + jitter) / TICK_MS;
      // 보낸 시점 서버 tick S, 스탬프 S+lead, 도착 시 서버 tick S+travel
      expect(lead).toBeGreaterThanOrEqual(travelTicks - INPUT_PAST_TOLERANCE);
    }
  });
});

describe('시계 동기화', () => {
  it('대칭 지연이면 오프셋을 정확히 추정', () => {
    const c = new ClockSync();
    // 서버 = 클라이언트 + 1000, 편도 30ms
    for (const t of [0, 100, 200, 300]) c.add(t, t + 60, t + 30 + 1000);
    expect(c.offset).toBeCloseTo(1000, 6);
    expect(c.rtt).toBe(60);
    expect(c.ready).toBe(true);
  });
  it('큐잉으로 느려진 표본보다 최소 RTT 표본을 신뢰', () => {
    const c = new ClockSync();
    c.add(0, 300, 1000 + 30); // 비대칭(응답 지연 큼) → 오프셋 왜곡
    c.add(1000, 1060, 2000 + 30); // 깨끗한 표본
    c.add(2000, 2200, 3000 + 30);
    expect(c.offset).toBeCloseTo(1000, 6);
  });
});

describe('고스트 검증', () => {
  const stage = 1;
  const spec = makeStageSpec(stage, canonicalSeed(stage), 0);
  const sch = guardianSchedule(spec, 30);
  const perfect = sch.flatMap((c, i) => [
    { tick: i === 0 ? 0 : sch[i - 1]!.turnbackStart, type: 'down' as const },
    { tick: c.watchStart + SAFE_RELEASE_TICKS, type: 'up' as const },
  ]);

  it('완주하는 입력은 수락하고 결과는 서버가 계산', () => {
    const r = checkGhost({ stage, assist: 0, inputs: perfect, finishTick: 1 /* 무시됨 */ });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.finishTick).toBeGreaterThan(100);
  });
  it('완주 못 하는 입력·형식 위반은 거부', () => {
    expect(checkGhost({ stage, assist: 0, inputs: [{ tick: 0, type: 'down' }] })).toEqual({ ok: false, reason: 'not-finished' });
    expect(checkGhost({ stage, assist: 0, inputs: [{ tick: 5, type: 'up' }] })).toMatchObject({ reason: 'alternation' });
    expect(checkGhost({ stage, assist: 0, inputs: [{ tick: 5, type: 'down' }, { tick: 5, type: 'up' }] })).toMatchObject({ reason: 'order' });
    expect(checkGhost({ stage, assist: 99, inputs: perfect })).toMatchObject({ reason: 'assist' });
    expect(checkGhost({ stage: 0, assist: 0, inputs: perfect })).toMatchObject({ reason: 'stage' });
    expect(checkGhost(null)).toMatchObject({ reason: 'body' });
  });
  it('Assist 없이는 탈락하는 늦은 릴리즈도 Assist 를 주장하면 서버가 그 Assist 로 검증한다', () => {
    const late = perfect.map((e) => (e.type === 'up' ? { ...e, tick: e.tick + 2 } : e));
    expect(checkGhost({ stage, assist: 0, inputs: late }).ok).toBe(false);
    expect(checkGhost({ stage, assist: 4, inputs: late }).ok).toBe(true);
  });
  it('고스트 선택: 목표 이하 중 가장 느린 기록, 없으면 가장 느린 기록', () => {
    const recs = [{ finishTick: 500 }, { finishTick: 600 }, { finishTick: 700 }];
    expect(pickGhost(recs, 650)?.finishTick).toBe(600);
    expect(pickGhost(recs, 100)?.finishTick).toBe(700);
    expect(pickGhost([], 100)).toBeUndefined();
  });
});
