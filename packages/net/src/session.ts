import { RollbackWorld, makeStageSpec, type InputEvent, type SimEvent, type StageSpec } from '@freeze/sim';
import { ClockSync } from './clock';
import { TICK_MS, leadTicks } from './policy';
import { PROTOCOL, type C2S, type MatchResult, type S2C } from './protocol';

export type SessionPhase = 'connecting' | 'idle' | 'queued' | 'countdown' | 'running' | 'ended';

export interface MatchInfo {
  readonly room: string;
  readonly stage: number;
  readonly seed: number;
  readonly humans: number;
  readonly you: number;
  readonly startAt: number;
  readonly maxTicks: number;
}

/**
 * 클라이언트 넷코드 엔진 (전송 계층과 분리 — 브라우저와 테스트가 같은 코드를 쓴다).
 *
 * - 서버 시계를 추정하고, 서버보다 lead tick 앞서 로컬 월드를 실행한다 → 내 입력이 서버에 "제때" 도착한다.
 * - 내 입력은 즉시 예측 적용 후 전송, 서버 확정 tick 이 오면 교체(필요 시 롤백).
 * - 다른 사람의 입력은 도착하는 대로 과거 tick 에 끼워 넣고 롤백한다.
 * - 서버가 보내는 확정 tick 해시와 비교해 어긋나면 전체 입력으로 재구성한다.
 */
export class NetSession {
  readonly clock = new ClockSync();
  phase: SessionPhase = 'connecting';
  match?: MatchInfo;
  spec?: StageSpec;
  world?: RollbackWorld;
  results?: readonly MatchResult[];
  /** 종료 시 서버 최종 상태와 로컬 상태가 일치했는가 */
  endVerified?: boolean;
  holding = false;
  queuedStage = 0;
  waiting = 0;
  readonly left = new Set<number>();
  stats = { desyncs: 0, resyncs: 0, late: 0, rejects: 0, hashChecks: 0 };

  private cid = 0;
  private readonly pending = new Map<number, InputEvent>();
  private lastOwnTick = -1;
  private readonly hashQueue: { tick: number; h: number }[] = [];

  constructor(
    private readonly send: (msg: C2S) => void,
    private readonly now: () => number,
  ) {}

  hello(): void {
    this.send({ t: 'hello', v: PROTOCOL });
  }

  ping(): void {
    this.send({ t: 'ping', c: this.now() });
  }

  queue(stage: number): void {
    this.send({ t: 'queue', stage });
  }

  get me(): number {
    return this.match?.you ?? 0;
  }

  /** 현재 서버 tick 추정 (경기 시작 전이면 음수) */
  serverTick(): number {
    if (!this.match) return -1;
    return Math.floor((this.clock.serverNow(this.now()) - this.match.startAt) / TICK_MS);
  }

  lead(): number {
    return leadTicks(this.clock.rtt, this.clock.jitter);
  }

  /** 카운트다운 남은 ms */
  countdownMs(): number {
    if (!this.match) return 0;
    return Math.max(0, this.match.startAt - this.clock.serverNow(this.now()));
  }

  handle(msg: S2C): void {
    switch (msg.t) {
      case 'welcome':
        this.phase = 'idle';
        return;
      case 'queued':
        this.phase = 'queued';
        this.queuedStage = msg.stage;
        this.waiting = msg.waiting;
        return;
      case 'pong':
        this.clock.add(msg.c, this.now(), msg.s);
        return;
      case 'match':
        this.match = msg;
        this.spec = makeStageSpec(msg.stage, msg.seed, 0, { humans: msg.humans });
        this.world = new RollbackWorld(this.spec);
        this.phase = 'countdown';
        this.pending.clear();
        this.lastOwnTick = -1;
        this.holding = false;
        return;
      case 'input': {
        const w = this.world;
        if (!w) return;
        const confirmed: InputEvent = { tick: msg.tick, type: msg.type, runner: msg.runner };
        const pred = msg.cid !== undefined ? this.pending.get(msg.cid) : undefined;
        if (pred && msg.cid !== undefined) {
          this.pending.delete(msg.cid);
          w.replaceInput(pred, confirmed);
          if (msg.runner === this.me) this.lastOwnTick = Math.max(this.lastOwnTick, msg.tick);
          if (msg.late) this.stats.late += 1;
        } else {
          w.addInput(confirmed);
        }
        return;
      }
      case 'reject': {
        const pred = this.pending.get(msg.cid);
        this.stats.rejects += 1;
        if (pred && this.world) {
          this.pending.delete(msg.cid);
          this.world.removeInput(pred);
          this.holding = pred.type === 'up';
        }
        return;
      }
      case 'hash':
        this.hashQueue.push({ tick: msg.tick, h: msg.h });
        this.checkHashes();
        return;
      case 'resync': {
        if (!this.spec || !this.world) return;
        this.stats.resyncs += 1;
        const target = Math.max(this.world.tick, msg.tick);
        this.world = RollbackWorld.rebuild(this.spec, msg.inputs, target);
        for (const p of this.pending.values()) this.world.addInput(p);
        return;
      }
      case 'left':
        this.left.add(msg.runner);
        return;
      case 'end':
        this.results = msg.results;
        this.phase = 'ended';
        if (this.world) {
          this.world.advanceTo(Math.max(this.world.tick, msg.tick));
          this.endVerified = this.world.hashAt(msg.tick) === msg.h;
        }
        return;
      case 'error':
        return;
    }
  }

  /** 프레임마다 호출: 로컬 월드를 (서버 tick + lead)까지 전진. 전진 중 이벤트를 돌려준다. */
  update(): SimEvent[] {
    const w = this.world;
    const m = this.match;
    if (!w || !m || this.phase === 'ended') return [];
    const st = this.serverTick();
    if (st < 0) {
      this.phase = 'countdown';
      return [];
    }
    this.phase = 'running';
    const target = Math.min(st + this.lead(), m.maxTicks + 60);
    const ev = w.advanceTo(target);
    this.checkHashes();
    return ev;
  }

  press(): boolean {
    return this.input('down');
  }

  release(): boolean {
    return this.input('up');
  }

  private input(type: 'down' | 'up'): boolean {
    const w = this.world;
    if (!w || this.phase !== 'running') return false;
    if ((type === 'down') === this.holding) return false;
    const tick = Math.max(w.tick, this.lastOwnTick + 1);
    const ev: InputEvent = { tick, type, runner: this.me };
    const cid = ++this.cid;
    this.pending.set(cid, ev);
    this.lastOwnTick = tick;
    this.holding = type === 'down';
    w.addInput(ev);
    this.send({ t: 'input', type, tick, cid });
    return true;
  }

  private checkHashes(): void {
    const w = this.world;
    if (!w) return;
    while (this.hashQueue.length && (this.hashQueue[0]?.tick ?? Infinity) <= w.tick) {
      const { tick, h } = this.hashQueue.shift()!;
      this.stats.hashChecks += 1;
      if (w.hashAt(tick) !== h) {
        this.stats.desyncs += 1;
        this.send({ t: 'resync' });
      }
    }
  }
}
