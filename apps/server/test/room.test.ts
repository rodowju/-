import { describe, expect, it } from 'vitest';
import { CONFIRM_DELAY, HASH_EVERY, INPUT_PAST_TOLERANCE, TICK_MS, type S2C } from '@freeze/net';
import { RollbackWorld, hashState } from '@freeze/sim';
import { MatchRoom, type Peer } from '../src/room';

function setup(n: number) {
  let t = 0;
  const now = (): number => t;
  const inbox: S2C[][] = Array.from({ length: n }, () => []);
  const peers: Peer[] = inbox.map((box, i) => ({ id: `p${i}`, send: (m) => box.push(m) }));
  const room = new MatchRoom(peers, { id: 'r', stage: 10, seed: 42, startAt: 1000, now, maxTicks: 60 * 60 });
  room.start();
  const at = (tick: number): void => {
    t = 1000 + tick * TICK_MS + 0.5;
    room.update();
  };
  return { room, peers, inbox, at, setTime: (ms: number) => (t = ms) };
}

describe('MatchRoom', () => {
  it('매치 정보를 각자 러너 번호와 함께 보낸다', () => {
    const { inbox } = setup(2);
    expect(inbox[0]![0]).toMatchObject({ t: 'match', you: 0, humans: 2, stage: 10, seed: 42 });
    expect(inbox[1]![0]).toMatchObject({ t: 'match', you: 1 });
  });

  it('경기 시작 전 입력은 거부', () => {
    const { room, peers, inbox } = setup(1);
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 0, cid: 1 });
    expect(inbox[0]!.at(-1)).toEqual({ t: 'reject', cid: 1 });
  });

  it('입력을 확정해 보낸 사람(cid 포함)과 다른 사람에게 중계한다', () => {
    const { room, peers, inbox, at } = setup(2);
    at(100);
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 105, cid: 7 });
    expect(inbox[0]!.at(-1)).toEqual({ t: 'input', runner: 0, tick: 105, type: 'down', cid: 7 });
    expect(inbox[1]!.at(-1)).toEqual({ t: 'input', runner: 0, tick: 105, type: 'down' });
  });

  it('허용치보다 늦은 입력은 현재 tick 으로 밀고 late 표시 (과거 끼워 넣기 불가)', () => {
    const { room, peers, inbox, at } = setup(1);
    at(200);
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 200 - INPUT_PAST_TOLERANCE - 5, cid: 1 });
    expect(inbox[0]!.at(-1)).toMatchObject({ t: 'input', tick: 200, late: true });
    expect(room.lateCounts()).toEqual([1]);
  });

  it('같은 상태 반복 입력(down 두 번)은 거부', () => {
    const { room, peers, inbox, at } = setup(1);
    at(50);
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 50, cid: 1 });
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 51, cid: 2 });
    expect(inbox[0]!.at(-1)).toEqual({ t: 'reject', cid: 2 });
  });

  it('초당 입력 제한', () => {
    const { room, peers, inbox, at } = setup(1);
    at(100);
    let rejects = 0;
    for (let i = 0; i < 40; i++) {
      room.onMessage(peers[0]!, { t: 'input', type: i % 2 ? 'up' : 'down', tick: 100 + i, cid: i });
      if (inbox[0]!.at(-1)?.t === 'reject') rejects++;
    }
    expect(rejects).toBeGreaterThan(0);
  });

  it('확정 tick 해시는 중계된 입력만으로 재구성한 월드와 같다 (클라이언트가 검증 가능)', () => {
    const { room, peers, inbox, at } = setup(2);
    at(10);
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 12, cid: 1 });
    at(80);
    room.onMessage(peers[1]!, { t: 'input', type: 'down', tick: 79, cid: 1 }); // 허용치 안 과거 → 서버 롤백
    at(140);
    room.onMessage(peers[0]!, { t: 'input', type: 'up', tick: 141, cid: 2 });
    at(HASH_EVERY * 8 + CONFIRM_DELAY);
    // 관전자 입장: peer1 이 받은 메시지만으로 재구성
    const client = new RollbackWorld(room.spec);
    const hashes: { tick: number; h: number }[] = [];
    for (const m of inbox[1]!) {
      if (m.t === 'input') client.addInput({ tick: m.tick, type: m.type, runner: m.runner });
      if (m.t === 'hash') hashes.push(m);
    }
    expect(hashes.length).toBeGreaterThanOrEqual(8);
    client.advanceTo(HASH_EVERY * 8);
    for (const { tick, h } of hashes) expect(client.hashAt(tick), `tick ${tick}`).toBe(h);
  });

  it('누른 채 나가면 손을 뗀 것으로 처리하고 알린다', () => {
    const { room, peers, inbox, at } = setup(2);
    at(30);
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 30, cid: 1 });
    at(60);
    room.onLeave(peers[0]!);
    const msgs = inbox[1]!.slice(-2);
    expect(msgs[0]).toMatchObject({ t: 'input', runner: 0, type: 'up' });
    expect(msgs[1]).toEqual({ t: 'left', runner: 0 });
  });

  it('모든 사람이 끝나면 확정 상태로 결과를 보낸다', () => {
    const { room, peers, inbox, at } = setup(1);
    at(5);
    room.onMessage(peers[0]!, { t: 'input', type: 'down', tick: 5, cid: 1 }); // 계속 홀드 → 첫 감시에서 탈락
    for (let tk = 6; tk < 1000 && !room.isEnded; tk += 5) at(tk);
    const end = inbox[0]!.find((m) => m.t === 'end');
    expect(end).toBeDefined();
    if (end?.t === 'end') {
      const me = end.results.find((r) => r.runner === 0)!;
      expect(me.human).toBe(true);
      expect(me.status).toBe('caught');
      expect(end.h).toBe(hashState(room.world.stateAt(end.tick)!));
    }
  });
});
