import type { InputEvent, RunnerStatus } from '@freeze/sim';

/** 프로토콜 버전. 호환되지 않는 변경 시 올린다. */
export const PROTOCOL = 1;

/** 메시지 최대 크기(바이트) — 서버 WebSocket maxPayload 와 일치 */
export const MAX_MESSAGE_BYTES = 1024;

// ───────── Client → Server ─────────
export type C2S =
  | { readonly t: 'hello'; readonly v: number }
  /** 빠른 매치 대기열 참가 (요청 스테이지 → 서버가 구간별 경기장 스테이지로 매핑) */
  | { readonly t: 'queue'; readonly stage: number }
  /** cid: 클라이언트가 붙이는 일련번호. 서버가 확정 tick 과 함께 되돌려준다 (예측 입력 교체용) */
  | { readonly t: 'input'; readonly type: 'down' | 'up'; readonly tick: number; readonly cid: number }
  | { readonly t: 'ping'; readonly c: number }
  | { readonly t: 'resync' }
  | { readonly t: 'leave' };

// ───────── Server → Client ─────────
export interface MatchResult {
  readonly runner: number;
  readonly human: boolean;
  readonly status: RunnerStatus;
  readonly place: number;
  readonly endTick: number;
  readonly score: number;
}

export type S2C =
  | { readonly t: 'welcome'; readonly v: number }
  | { readonly t: 'queued'; readonly stage: number; readonly waiting: number }
  /**
   * 매치 시작. startAt 은 서버 단조 시계(ms) 기준 tick 0 시각.
   * 클라이언트는 pong 으로 추정한 서버 시계로 현재 서버 tick 을 계산한다.
   */
  | {
      readonly t: 'match';
      readonly room: string;
      readonly stage: number;
      readonly seed: number;
      readonly humans: number;
      readonly you: number;
      readonly startAt: number;
      readonly maxTicks: number;
    }
  /** 확정된 입력. 보낸 사람에게는 cid 를 포함한다 */
  | { readonly t: 'input'; readonly runner: number; readonly tick: number; readonly type: 'down' | 'up'; readonly cid?: number; readonly late?: boolean }
  /** 입력 거부 (중복 상태·속도 제한). 클라이언트는 해당 예측 입력을 지운다 */
  | { readonly t: 'reject'; readonly cid: number }
  | { readonly t: 'pong'; readonly c: number; readonly s: number }
  /** 확정 tick 의 상태 해시 (동기화 검증) */
  | { readonly t: 'hash'; readonly tick: number; readonly h: number }
  | { readonly t: 'resync'; readonly tick: number; readonly inputs: readonly InputEvent[] }
  | { readonly t: 'left'; readonly runner: number }
  | { readonly t: 'end'; readonly tick: number; readonly h: number; readonly results: readonly MatchResult[] }
  | { readonly t: 'error'; readonly code: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** 서버측 엄격 파싱: 알 수 없는 형식은 null (예외를 던지지 않는다) */
export function parseC2S(raw: unknown): C2S | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello':
      return isInt(m.v) ? { t: 'hello', v: m.v } : null;
    case 'queue':
      return isInt(m.stage) && m.stage >= 1 && m.stage <= 999 ? { t: 'queue', stage: m.stage } : null;
    case 'input':
      return (m.type === 'down' || m.type === 'up') && isInt(m.tick) && m.tick >= 0 && m.tick < 1e7 && isInt(m.cid) && m.cid >= 0
        ? { t: 'input', type: m.type, tick: m.tick, cid: m.cid }
        : null;
    case 'ping':
      return isNum(m.c) ? { t: 'ping', c: m.c } : null;
    case 'resync':
      return { t: 'resync' };
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}

/** 클라이언트측 파싱 (서버를 신뢰하되 형식 오류로 죽지 않도록 최소 검증) */
export function parseS2C(raw: unknown): S2C | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw) as unknown;
    return isObj(m) && typeof m.t === 'string' ? (m as unknown as S2C) : null;
  } catch {
    return null;
  }
}

export const encode = (m: C2S | S2C): string => JSON.stringify(m);
