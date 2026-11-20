import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { NetSession, encode, parseS2C, type C2S, type S2C } from '@freeze/net';
import { SAFE_RELEASE_TICKS, canonicalSeed, guardianSchedule, makeStageSpec } from '@freeze/sim';
import { startServer, type RunningServer } from '../src/server';

/** 테스트 가속: 서버와 클라이언트가 같은 4배속 시계를 쓴다 (tick 기반이라 결과는 동일) */
const SPEED = 4;
const now = (): number => performance.now() * SPEED;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: RunningServer;
let base = '';

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', now, queueWaitMs: 400 * SPEED, countdownMs: 800 * SPEED, maxHumans: 2 });
  base = `127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
});

/**
 * 인위적 지연(편도 ms, 실시간 기준) + 지터를 넣은 WebSocket 클라이언트.
 * 지터가 있어도 메시지 순서는 보존한다 (TCP/WebSocket 의미론).
 */
async function connect(oneWayMs: number, jitterMs = 0): Promise<{ s: NetSession; ws: WebSocket }> {
  const ws = new WebSocket(`ws://${base}/ws`);
  await new Promise((r, j) => {
    ws.once('open', r);
    ws.once('error', j);
  });
  let upAt = 0;
  let downAt = 0;
  const delay = (prev: number): { at: number; wait: number } => {
    const t = Date.now();
    const at = Math.max(prev + 0.1, t + oneWayMs + Math.random() * jitterMs);
    return { at, wait: at - t };
  };
  const send = (m: C2S): void => {
    const d = delay(upAt);
    upAt = d.at;
    setTimeout(() => ws.readyState === ws.OPEN && ws.send(encode(m)), d.wait);
  };
  const s = new NetSession(send, now);
  ws.on('message', (raw) => {
    const m = parseS2C(raw.toString()) as S2C | null;
    if (!m) return;
    const d = delay(downAt);
    downAt = d.at;
    setTimeout(() => s.handle(m), d.wait);
  });
  s.hello();
  return { s, ws };
}

describe('실시간 매치 (실제 WebSocket, 지연 주입)', () => {
  async function duel(aDelay: [number, number], bDelay: [number, number]) {
    const a = await connect(...aDelay);
    const b = await connect(...bDelay);
    for (let i = 0; i < 8; i++) {
      a.s.ping();
      b.s.ping();
      await sleep(25);
    }
    a.s.queue(1);
    b.s.queue(2);
    const t0 = Date.now();
    while ((!a.s.match || !b.s.match) && Date.now() - t0 < 5000) await sleep(10);
    expect(a.s.match?.room).toBe(b.s.match?.room);
    expect(new Set([a.s.me, b.s.me])).toEqual(new Set([0, 1]));

    // A: 계속 홀드 → 탈락 / B: 매 사이클 D-6 tick 에 릴리즈 → 완주
    const spec = b.s.spec!;
    const sch = guardianSchedule(spec, 40);
    let pingAt = 0;
    while ((a.s.phase !== 'ended' || b.s.phase !== 'ended') && Date.now() - t0 < 30000) {
      a.s.update();
      b.s.update();
      if (Date.now() - pingAt > 100) {
        a.s.ping();
        b.s.ping();
        pingAt = Date.now();
      }
      if (a.s.phase === 'running' && !a.s.holding && a.s.world!.tick < 30) a.s.press();
      if (b.s.phase === 'running') {
        const t = b.s.world!.tick;
        const c = sch.find((x) => t <= x.end)!;
        const releaseAt = c.watchStart + SAFE_RELEASE_TICKS - 6;
        const inWindow = t >= releaseAt && t < c.turnbackStart;
        if (inWindow && b.s.holding) b.s.release();
        if (!inWindow && !b.s.holding) b.s.press();
      }
      await sleep(4);
    }
    const info = (x: typeof a) => ({ ...x.s.stats, lead: x.s.lead(), rtt: Math.round(x.s.clock.rtt / SPEED), rolledBack: x.s.world!.rolledBackTicks });
    console.log('duel', JSON.stringify({ a: info(a), b: info(b) }));
    a.ws.close();
    b.ws.close();
    return { a: a.s, b: b.s };
  }

  it('두 클라이언트가 같은 결과에 도달하고, 서버 해시와 끝까지 일치한다 (편도 5ms / 45ms)', async () => {
    const { a, b } = await duel([5, 0], [45, 0]);
    expect(a.phase).toBe('ended');
    expect(b.phase).toBe('ended');
    // 동기화 품질
    expect(a.stats.desyncs).toBe(0);
    expect(b.stats.desyncs).toBe(0);
    expect(a.stats.hashChecks).toBeGreaterThan(5);
    expect(a.endVerified).toBe(true);
    expect(b.endVerified).toBe(true);
    // 결과 일치
    expect(a.results).toEqual(b.results);
    expect(a.results!.find((r) => r.runner === a.me)!.status).toBe('caught');
    expect(b.results!.find((r) => r.runner === b.me)!.status).toBe('finished');
    // 지연 있는 B 도 리드 덕분에 입력이 밀리지 않는다
    expect(b.stats.late).toBeLessThanOrEqual(1);
    // 상대 입력은 늦게 도착하므로 롤백이 실제로 일어났다 (테스트가 롤백 경로를 탔는지 확인)
    expect(a.world!.rolledBackTicks + b.world!.rolledBackTicks).toBeGreaterThan(0);
  }, 40_000);

  // 주의: 시계가 4배속이므로 게임 시간 기준 지연은 아래 실시간 값의 4배다.
  it('현실적 지터(게임 시간 편도 60±40ms)에서 늦은 입력 없이 완주하고 동기화가 유지된다', async () => {
    const { a, b } = await duel([3, 3], [15, 10]);
    expect(a.stats.desyncs + b.stats.desyncs).toBe(0);
    expect(a.endVerified && b.endVerified).toBe(true);
    expect(a.results).toEqual(b.results);
    expect(b.stats.late).toBe(0);
    expect(b.results!.find((r) => r.runner === b.me)!.status).toBe('finished');
  }, 40_000);

  it('극단적 지연(게임 시간 편도 240±160ms)에서도 동기화는 깨지지 않고, 불이익은 지연된 본인에게만 간다', async () => {
    const { a, b } = await duel([10, 10], [60, 40]);
    // 무결성: 모든 클라이언트와 서버가 같은 결과
    expect(a.stats.desyncs + b.stats.desyncs).toBe(0);
    expect(a.endVerified && b.endVerified).toBe(true);
    expect(a.results).toEqual(b.results);
    // 리드가 상한에 걸려 일부 입력이 현재 tick 으로 밀린다 (과거로 끼워 넣지 않음 = 치트 불가 정책의 대가)
    const bResult = b.results!.find((r) => r.runner === b.me)!;
    if (bResult.status === 'caught') expect(b.stats.late).toBeGreaterThan(0);
    // 지연이 거의 없는 A 는 영향을 받지 않는다 (A 는 의도적으로 계속 홀드 → 탈락)
    expect(a.stats.late).toBe(0);
  }, 40_000);

  it('혼자 대기하면 대기 시간 후 봇과 함께 시작한다', async () => {
    const c = await connect(0);
    for (let i = 0; i < 4; i++) {
      c.s.ping();
      await sleep(20);
    }
    c.s.queue(15);
    const t0 = Date.now();
    while (!c.s.match && Date.now() - t0 < 5000) await sleep(10);
    expect(c.s.match?.humans).toBe(1);
    expect(c.s.match?.stage).toBe(20);
    expect(c.s.spec!.botCount).toBeGreaterThan(0);
    c.ws.close();
  }, 10_000);

  it('지원하지 않는 프로토콜 버전은 끊는다', async () => {
    const ws = new WebSocket(`ws://${base}/ws`);
    await new Promise((r) => ws.once('open', r));
    const msgs: string[] = [];
    ws.on('message', (d) => msgs.push(d.toString()));
    ws.send(JSON.stringify({ t: 'hello', v: 999 }));
    await new Promise((r) => ws.once('close', r));
    expect(msgs.some((m) => m.includes('protocol'))).toBe(true);
  });
});

describe('고스트 HTTP API', () => {
  const stage = 2;
  const spec = makeStageSpec(stage, canonicalSeed(stage), 0);
  const sch = guardianSchedule(spec, 30);
  const run = (lead: number) =>
    sch.flatMap((c, i) => [
      { tick: i === 0 ? 0 : sch[i - 1]!.turnbackStart, type: 'down' },
      { tick: c.watchStart + SAFE_RELEASE_TICKS - lead, type: 'up' },
    ]);
  const post = (body: unknown) =>
    fetch(`http://${base}/api/ghosts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('유효한 기록은 저장되고, 결과는 서버가 계산한다', async () => {
    const r = await post({ stage, assist: 0, inputs: run(0), finishTick: 1 });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; finishTick: number; stored: boolean; rank: number };
    expect(j.ok && j.stored).toBe(true);
    expect(j.finishTick).toBeGreaterThan(100);
    expect(j.rank).toBe(1);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('같은 기록 중복 제출은 저장하지 않는다', async () => {
    const j = (await (await post({ stage, assist: 0, inputs: run(0) })).json()) as { stored: boolean };
    expect(j.stored).toBe(false);
  });

  it('완주 못 하는 입력은 422', async () => {
    const r = await post({ stage, assist: 0, inputs: [{ tick: 0, type: 'down' }] });
    expect(r.status).toBe(422);
  });

  it('고스트 조회: 목표보다 느리지 않은 기록 중 가장 느린 것', async () => {
    await post({ stage, assist: 0, inputs: run(10) }); // 더 느린 기록
    const best = (await (await fetch(`http://${base}/api/leaderboard?stage=${stage}`)).json()) as { top: { finishTick: number }[] };
    expect(best.top.length).toBe(2);
    const [fast, slow] = best.top.map((x) => x.finishTick) as [number, number];
    expect(fast).toBeLessThan(slow);
    const g = (await (await fetch(`http://${base}/api/ghosts?stage=${stage}&target=${slow - 1}`)).json()) as { finishTick: number; inputs: unknown[] };
    expect(g.finishTick).toBe(fast);
    expect(g.inputs.length).toBeGreaterThan(0);
  });

  it('잘못된 JSON 400, 과대 본문 413, 고스트 없는 스테이지 204', async () => {
    expect((await fetch(`http://${base}/api/ghosts`, { method: 'POST', body: '{nope' })).status).toBe(400);
    const huge = await fetch(`http://${base}/api/ghosts`, { method: 'POST', body: 'x'.repeat(70_000) }).catch(() => null);
    expect(huge === null || huge.status === 413).toBe(true);
    expect((await fetch(`http://${base}/api/ghosts?stage=999`)).status).toBe(204);
  });
});
