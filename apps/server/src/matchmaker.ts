import { randomInt } from 'node:crypto';
import type { Peer } from './room';
import { MatchRoom } from './room';

/** 요청 스테이지 → 경기장 스테이지 (난이도 구간의 대표값). 같은 구간끼리 매칭한다. */
export function arenaStage(stage: number): number {
  if (stage <= 3) return 3;
  if (stage <= 10) return 10;
  if (stage <= 20) return 20;
  return 30;
}

export interface MatchmakerOptions {
  readonly now: () => number;
  /** 첫 참가자 이후 이 시간이 지나면 인원이 덜 차도 시작 (봇이 빈자리를 채움) */
  readonly waitMs: number;
  readonly maxHumans: number;
  readonly countdownMs: number;
  readonly onRoom: (room: MatchRoom) => void;
}

interface Waiting {
  readonly peer: Peer;
  readonly since: number;
}

export class Matchmaker {
  private readonly queues = new Map<number, Waiting[]>();
  private seq = 0;

  constructor(private readonly opts: MatchmakerOptions) {}

  enqueue(peer: Peer, stage: number): void {
    this.remove(peer);
    const arena = arenaStage(stage);
    const q = this.queues.get(arena) ?? [];
    q.push({ peer, since: this.opts.now() });
    this.queues.set(arena, q);
    for (const w of q) w.peer.send({ t: 'queued', stage: arena, waiting: q.length });
    if (q.length >= this.opts.maxHumans) this.launch(arena);
  }

  remove(peer: Peer): void {
    for (const [arena, q] of this.queues) {
      const next = q.filter((w) => w.peer.id !== peer.id);
      if (next.length !== q.length) this.queues.set(arena, next);
    }
  }

  waiting(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  /** 주기적으로 호출: 대기 시간이 지난 큐를 시작 */
  tick(): void {
    const now = this.opts.now();
    for (const [arena, q] of this.queues) {
      const first = q[0];
      if (first && now - first.since >= this.opts.waitMs) this.launch(arena);
    }
  }

  private launch(arena: number): void {
    const q = this.queues.get(arena) ?? [];
    const take = q.slice(0, this.opts.maxHumans);
    this.queues.set(arena, q.slice(take.length));
    if (take.length === 0) return;
    const room = new MatchRoom(
      take.map((w) => w.peer),
      {
        id: `r${++this.seq}`,
        stage: arena,
        seed: randomInt(0, 2 ** 31),
        startAt: this.opts.now() + this.opts.countdownMs,
        now: this.opts.now,
      },
    );
    room.start();
    this.opts.onRoom(room);
  }
}
