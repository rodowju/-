import {
  CONFIRM_DELAY,
  HASH_EVERY,
  TICK_MS,
  acceptTick,
  type C2S,
  type MatchResult,
  type S2C,
} from '@freeze/net';
import { RollbackWorld, hashState, isHuman, makeStageSpec, type StageSpec, type WorldState } from '@freeze/sim';

export interface Peer {
  readonly id: string;
  send(msg: S2C): void;
}

interface Player {
  readonly peer: Peer;
  readonly runner: number;
  lastTick: number;
  lastType: 'down' | 'up';
  connected: boolean;
  /** 초당 입력 제한 (토큰 버킷) */
  tokens: number;
  tokenAt: number;
  late: number;
}

export interface RoomOptions {
  readonly id: string;
  readonly stage: number;
  readonly seed: number;
  /** 서버 단조 시계(ms) 기준 tick 0 시각 */
  readonly startAt: number;
  readonly now: () => number;
  /** 최대 경기 길이 (기본 3분) */
  readonly maxTicks?: number;
}

const INPUT_RATE = 20; // 초당
const MAX_TICKS_DEFAULT = 60 * 180;

/**
 * 서버 권위 매치 룸. 전송 계층(WebSocket)과 분리해 단위 테스트가 가능하다.
 * - 입력만 받는다. 상태는 서버가 RollbackWorld 로 계산한다 (클라이언트 결과를 신뢰하지 않음).
 * - 확정 tick(현재 - CONFIRM_DELAY)의 해시를 주기적으로 보내 클라이언트 동기화를 검증한다.
 */
export class MatchRoom {
  readonly spec: StageSpec;
  readonly world: RollbackWorld;
  readonly maxTicks: number;
  private readonly players: Player[];
  private lastHashTick = 0;
  private ended = false;

  constructor(
    peers: readonly Peer[],
    private readonly opts: RoomOptions,
  ) {
    if (peers.length < 1) throw new Error('room needs at least one player');
    this.spec = makeStageSpec(opts.stage, opts.seed, 0, { humans: peers.length });
    this.world = new RollbackWorld(this.spec);
    this.maxTicks = opts.maxTicks ?? MAX_TICKS_DEFAULT;
    const now = opts.now();
    this.players = peers.map((peer, runner) => ({
      peer,
      runner,
      lastTick: -1,
      lastType: 'up',
      connected: true,
      tokens: INPUT_RATE,
      tokenAt: now,
      late: 0,
    }));
  }

  get id(): string {
    return this.opts.id;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  has(peer: Peer): boolean {
    return this.players.some((p) => p.peer.id === peer.id);
  }

  start(): void {
    for (const p of this.players) {
      p.peer.send({
        t: 'match',
        room: this.opts.id,
        stage: this.opts.stage,
        seed: this.opts.seed,
        humans: this.spec.humans,
        you: p.runner,
        startAt: this.opts.startAt,
        maxTicks: this.maxTicks,
      });
    }
  }

  /** 서버 tick (경기 시작 전에는 0) */
  serverTick(): number {
    return Math.max(0, Math.floor((this.opts.now() - this.opts.startAt) / TICK_MS));
  }

  /** 시계에 맞춰 전진하고, 해시 브로드캐스트와 종료 판정을 한다. 끝났으면 true. */
  update(): boolean {
    if (this.ended) return true;
    const target = Math.min(this.serverTick(), this.maxTicks + CONFIRM_DELAY);
    if (target > this.world.tick) this.world.advanceTo(target);
    const confirmed = this.world.tick - CONFIRM_DELAY;
    while (this.lastHashTick + HASH_EVERY <= confirmed) {
      this.lastHashTick += HASH_EVERY;
      const h = this.world.hashAt(this.lastHashTick);
      if (h !== undefined) this.broadcast({ t: 'hash', tick: this.lastHashTick, h });
    }
    if (confirmed >= 0) {
      const s = this.world.stateAt(confirmed);
      if (s && (this.allHumansDone(s) || confirmed >= this.maxTicks)) this.finish(s);
    }
    return this.ended;
  }

  onMessage(peer: Peer, msg: C2S): void {
    const p = this.players.find((x) => x.peer.id === peer.id);
    if (!p || this.ended) return;
    switch (msg.t) {
      case 'ping':
        peer.send({ t: 'pong', c: msg.c, s: this.opts.now() });
        return;
      case 'resync':
        this.update();
        peer.send({ t: 'resync', tick: this.world.tick, inputs: this.world.inputs() });
        return;
      case 'leave':
        this.onLeave(peer);
        return;
      case 'input':
        this.onInput(p, msg.type, msg.tick, msg.cid);
        return;
      default:
        return;
    }
  }

  onLeave(peer: Peer): void {
    const p = this.players.find((x) => x.peer.id === peer.id);
    if (!p || !p.connected) return;
    p.connected = false;
    // 누른 채로 나가면 손을 뗀 것으로 처리 (남은 플레이어의 순위에 영향 최소화)
    if (p.lastType === 'down' && !this.ended) {
      this.update();
      const acc = acceptTick(this.world.tick, this.world.tick, p.lastTick);
      this.world.addInput({ tick: acc.tick, type: 'up', runner: p.runner });
      p.lastTick = acc.tick;
      p.lastType = 'up';
      this.broadcast({ t: 'input', runner: p.runner, tick: acc.tick, type: 'up' });
    }
    this.broadcast({ t: 'left', runner: p.runner });
    if (this.players.every((x) => !x.connected)) this.ended = true;
  }

  private onInput(p: Player, type: 'down' | 'up', stamp: number, cid: number): void {
    const now = this.opts.now();
    p.tokens = Math.min(INPUT_RATE, p.tokens + ((now - p.tokenAt) / 1000) * INPUT_RATE);
    p.tokenAt = now;
    if (p.tokens < 1 || type === p.lastType || this.opts.now() < this.opts.startAt) {
      p.peer.send({ t: 'reject', cid });
      return;
    }
    p.tokens -= 1;
    this.update();
    const acc = acceptTick(stamp, this.world.tick, p.lastTick);
    if (acc.late) p.late += 1;
    this.world.addInput({ tick: acc.tick, type, runner: p.runner });
    p.lastTick = acc.tick;
    p.lastType = type;
    for (const q of this.players) {
      if (!q.connected) continue;
      q.peer.send(
        q === p
          ? { t: 'input', runner: p.runner, tick: acc.tick, type, cid, ...(acc.late ? { late: true } : {}) }
          : { t: 'input', runner: p.runner, tick: acc.tick, type },
      );
    }
  }

  private allHumansDone(s: WorldState): boolean {
    return this.players.every((p) => !p.connected || s.runners[p.runner]?.status !== 'running');
  }

  private finish(s: WorldState): void {
    this.ended = true;
    const results: MatchResult[] = s.runners.map((r) => ({
      runner: r.id,
      human: isHuman(this.spec, r.id),
      status: r.status,
      place: r.place,
      endTick: r.endTick,
      score: r.score,
    }));
    this.broadcast({ t: 'end', tick: s.tick, h: hashState(s), results });
  }

  private broadcast(msg: S2C): void {
    for (const p of this.players) if (p.connected) p.peer.send(msg);
  }

  /** 계측: 늦게 도착해 밀린 입력 수 */
  lateCounts(): number[] {
    return this.players.map((p) => p.late);
  }
}
