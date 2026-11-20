import { SIM_VERSION } from './config';
import { PLAYER_ID, createWorld, step } from './world';
import type { InputEvent, SimEvent, StageSpec, WorldState } from './types';

export interface ReplayData {
  readonly version: number;
  readonly spec: StageSpec;
  readonly inputs: readonly InputEvent[];
}

export function makeReplay(spec: StageSpec, inputs: readonly InputEvent[]): ReplayData {
  return { version: SIM_VERSION, spec, inputs };
}

export function serializeReplay(r: ReplayData): string {
  return JSON.stringify(r);
}

export function parseReplay(json: string): ReplayData {
  const r = JSON.parse(json) as ReplayData;
  if (r.version !== SIM_VERSION) throw new Error(`unsupported replay version: ${String(r.version)}`);
  return r;
}

export interface RunOptions {
  /** 이 tick(미포함)까지만 진행. 기본: 플레이어 런 종료까지. */
  readonly untilTick?: number;
  /** 안전장치: 최대 tick 수 */
  readonly maxTicks?: number;
  /** 플레이어 종료 후 추가로 진행할 tick (봇 순위 등) */
  readonly tailTicks?: number;
}

export interface RunResult {
  readonly final: WorldState;
  readonly events: readonly SimEvent[];
}

/** 입력 로그로 월드를 재현한다. */
export function runReplay(replay: ReplayData, opts: RunOptions = {}): RunResult {
  const maxTicks = opts.maxTicks ?? 60 * 60 * 10;
  const sorted = [...replay.inputs].sort((a, b) => a.tick - b.tick);
  let state = createWorld(replay.spec);
  const events: SimEvent[] = [];
  let ptr = 0;
  let doneAt = -1;
  while (state.tick < maxTicks) {
    if (opts.untilTick !== undefined && state.tick >= opts.untilTick) break;
    const now: InputEvent[] = [];
    while (ptr < sorted.length && (sorted[ptr]?.tick ?? Infinity) <= state.tick) {
      const ev = sorted[ptr];
      if (ev && ev.tick === state.tick) now.push(ev);
      ptr++;
    }
    state = step(state, replay.spec, now);
    events.push(...state.events);
    const p = state.runners[PLAYER_ID];
    if (opts.untilTick === undefined && p && p.status !== 'running') {
      if (doneAt < 0) doneAt = state.tick;
      if (state.tick - doneAt >= (opts.tailTicks ?? 0)) break;
    }
  }
  return { final: state, events };
}

/** 일정 tick마다 스냅샷을 보관하는 링 버퍼 (탈락 리플레이용). 저장된 state는 불변으로 취급한다. */
export class SnapshotBuffer {
  private readonly buf: WorldState[] = [];
  constructor(
    private readonly capacity: number,
    private readonly interval: number,
  ) {}

  push(state: WorldState): void {
    if (state.tick % this.interval !== 0) return;
    this.buf.push(state);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  /** tick 이하에서 가장 가까운 스냅샷 */
  latestAtOrBefore(tick: number): WorldState | undefined {
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const s = this.buf[i];
      if (s && s.tick <= tick) return s;
    }
    return undefined;
  }
}

/**
 * start 상태에서 시작해 untilTick 까지의 모든 tick 상태를 재현한다 (탈락 리플레이용).
 * 반환 배열의 첫 원소는 start, 마지막 원소는 tick === untilTick 인 상태.
 */
export function resimulate(
  spec: StageSpec,
  inputs: readonly InputEvent[],
  start: WorldState,
  untilTick: number,
): WorldState[] {
  const sorted = inputs.filter((i) => i.tick >= start.tick).sort((a, b) => a.tick - b.tick);
  const states: WorldState[] = [start];
  let s = start;
  let ptr = 0;
  while (s.tick < untilTick) {
    const now: InputEvent[] = [];
    while (ptr < sorted.length && (sorted[ptr]?.tick ?? Infinity) <= s.tick) {
      const ev = sorted[ptr];
      if (ev && ev.tick === s.tick) now.push(ev);
      ptr++;
    }
    s = step(s, spec, now);
    states.push(s);
  }
  return states;
}
