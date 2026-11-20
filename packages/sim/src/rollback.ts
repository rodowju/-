import { hashState } from './hash';
import type { InputEvent, SimEvent, StageSpec, WorldState } from './types';
import { createWorld, step } from './world';

/** 입력 정렬 키: tick → runner. 같은 러너의 같은 tick 입력은 서버가 금지하므로 이것으로 순서가 유일하게 정해진다. */
function cmp(a: InputEvent, b: InputEvent): number {
  return a.tick - b.tick || (a.runner ?? 0) - (b.runner ?? 0) || (a.type === b.type ? 0 : a.type === 'down' ? -1 : 1);
}

const keyOf = (e: InputEvent): string => `${e.tick}:${e.runner ?? 0}:${e.type}`;

export interface RollbackOptions {
  /** tick 단위로 모든 상태를 보관하는 최근 구간 길이 */
  readonly recentTicks?: number;
  /** 그보다 오래된 구간은 이 간격으로만 스냅샷 보관 */
  readonly coarseEvery?: number;
}

/**
 * 롤백 가능한 결정론적 월드 (넷코드의 공용 코어 — 서버와 클라이언트가 같은 코드를 쓴다).
 *
 * - 입력은 언제든 추가/교체할 수 있다. 과거 tick 의 입력이면 그 시점으로 되감아 현재 tick 까지 재시뮬레이션한다.
 * - 같은 (spec, 입력 집합)이면 입력이 도착한 순서와 무관하게 항상 같은 상태가 된다 (테스트로 보장).
 */
export class RollbackWorld {
  private cur: WorldState;
  private readonly byTick = new Map<number, InputEvent[]>();
  private readonly keys = new Set<string>();
  private readonly recent = new Map<number, WorldState>();
  private readonly coarse = new Map<number, WorldState>();
  private readonly recentTicks: number;
  private readonly coarseEvery: number;
  /** 누적 재시뮬레이션 tick 수 (계측용) */
  rolledBackTicks = 0;

  constructor(
    readonly spec: StageSpec,
    opts: RollbackOptions = {},
  ) {
    this.recentTicks = opts.recentTicks ?? 240;
    this.coarseEvery = opts.coarseEvery ?? 30;
    this.cur = createWorld(spec);
    this.remember(this.cur);
  }

  get state(): WorldState {
    return this.cur;
  }

  get tick(): number {
    return this.cur.tick;
  }

  /** 지금까지 받은 모든 입력 (정렬됨) */
  inputs(): InputEvent[] {
    const all: InputEvent[] = [];
    for (const list of this.byTick.values()) all.push(...list);
    return all.sort(cmp);
  }

  has(ev: InputEvent): boolean {
    return this.keys.has(keyOf(ev));
  }

  /**
   * 입력 추가. 이미 있으면 무시. 과거 tick 이면 되감는다.
   * @returns 되감은 tick 수 (0 이면 되감기 없음)
   */
  addInput(ev: InputEvent): number {
    const k = keyOf(ev);
    if (this.keys.has(k)) return 0;
    if (!Number.isInteger(ev.tick) || ev.tick < 0) throw new RangeError('input tick must be a non-negative integer');
    this.keys.add(k);
    const list = this.byTick.get(ev.tick) ?? [];
    list.push(ev);
    list.sort(cmp);
    this.byTick.set(ev.tick, list);
    return ev.tick < this.cur.tick ? this.rewindFrom(ev.tick) : 0;
  }

  /** 입력 제거 (예측 입력을 서버 확정값으로 바꿀 때). 과거면 되감는다. */
  removeInput(ev: InputEvent): number {
    const k = keyOf(ev);
    if (!this.keys.delete(k)) return 0;
    const list = (this.byTick.get(ev.tick) ?? []).filter((e) => keyOf(e) !== k);
    if (list.length) this.byTick.set(ev.tick, list);
    else this.byTick.delete(ev.tick);
    return ev.tick < this.cur.tick ? this.rewindFrom(ev.tick) : 0;
  }

  /** 예측 입력을 확정 입력으로 교체 (되감기는 한 번만) */
  replaceInput(oldEv: InputEvent, newEv: InputEvent): number {
    if (keyOf(oldEv) === keyOf(newEv)) return 0;
    const now = this.cur.tick;
    const earliest = Math.min(oldEv.tick, newEv.tick);
    // 되감기 없이 집합만 바꾼 뒤 한 번에 재시뮬레이션
    const k = keyOf(oldEv);
    if (this.keys.delete(k)) {
      const list = (this.byTick.get(oldEv.tick) ?? []).filter((e) => keyOf(e) !== k);
      if (list.length) this.byTick.set(oldEv.tick, list);
      else this.byTick.delete(oldEv.tick);
    }
    const nk = keyOf(newEv);
    if (!this.keys.has(nk)) {
      this.keys.add(nk);
      const list = this.byTick.get(newEv.tick) ?? [];
      list.push(newEv);
      list.sort(cmp);
      this.byTick.set(newEv.tick, list);
    }
    return earliest < now ? this.rewindFrom(earliest) : 0;
  }

  /** targetTick 까지 전진. 전진 중 발생한 이벤트를 돌려준다 (되감기 재시뮬레이션의 이벤트는 포함하지 않는다). */
  advanceTo(targetTick: number): SimEvent[] {
    const events: SimEvent[] = [];
    while (this.cur.tick < targetTick) {
      this.cur = step(this.cur, this.spec, this.byTick.get(this.cur.tick) ?? []);
      this.remember(this.cur);
      if (this.cur.events.length) events.push(...this.cur.events);
    }
    return events;
  }

  /** 특정 tick 의 상태 (state.tick === tick). 현재보다 미래면 undefined. */
  stateAt(tick: number): WorldState | undefined {
    if (tick > this.cur.tick || tick < 0) return undefined;
    if (tick === this.cur.tick) return this.cur;
    const hit = this.recent.get(tick);
    if (hit) return hit;
    const base = this.baseAtOrBefore(tick);
    let s = base;
    while (s.tick < tick) s = step(s, this.spec, this.byTick.get(s.tick) ?? []);
    return s;
  }

  hashAt(tick: number): number | undefined {
    const s = this.stateAt(tick);
    return s ? hashState(s) : undefined;
  }

  /** 모든 입력으로 처음부터 다시 만든다 (동기화 오류 복구용) */
  static rebuild(spec: StageSpec, inputs: readonly InputEvent[], tick: number, opts?: RollbackOptions): RollbackWorld {
    const rw = new RollbackWorld(spec, opts);
    for (const e of inputs) rw.addInput(e);
    rw.advanceTo(tick);
    return rw;
  }

  private baseAtOrBefore(tick: number): WorldState {
    for (let t = tick; t >= 0 && t > tick - this.coarseEvery; t--) {
      const r = this.recent.get(t);
      if (r) return r;
    }
    const c = this.coarse.get(Math.floor(tick / this.coarseEvery) * this.coarseEvery);
    if (c) return c;
    // 이론상 도달하지 않음: 0 은 항상 coarse 에 있다
    const zero = this.coarse.get(0);
    if (!zero) throw new Error('missing initial snapshot');
    return zero;
  }

  private rewindFrom(tick: number): number {
    const target = this.cur.tick;
    const base = this.baseAtOrBefore(tick);
    let s = base;
    while (s.tick < target) {
      s = step(s, this.spec, this.byTick.get(s.tick) ?? []);
      this.remember(s);
    }
    this.cur = s;
    const n = target - base.tick;
    this.rolledBackTicks += n;
    return n;
  }

  private remember(s: WorldState): void {
    this.recent.set(s.tick, s);
    this.recent.delete(s.tick - this.recentTicks);
    if (s.tick % this.coarseEvery === 0) this.coarse.set(s.tick, s);
  }
}
