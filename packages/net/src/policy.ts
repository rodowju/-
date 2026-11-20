import { TICK_HZ } from '@freeze/sim';

export const TICK_MS = 1000 / TICK_HZ;

/**
 * 과거 입력 허용치(tick). 클라이언트는 서버보다 앞서 실행하므로 정상 입력은 "미래 또는 현재" tick 으로 도착한다.
 * 이 값을 크게 잡으면 "시간 되돌리기" 치트(늦게 본 뒤 과거 시점으로 릴리즈)가 그만큼 반응 이득을 얻는다.
 * 반응 게임이므로 지터 흡수에 필요한 최소값만 허용한다.
 */
export const INPUT_PAST_TOLERANCE = 2;
/** 미래 입력 상한(tick). 리드(lead)보다 커야 한다. */
export const INPUT_FUTURE_LIMIT = 20;
/** 이 tick 이 지나면 상태가 확정된다 (이후 어떤 입력도 이 tick 이전을 바꾸지 못함) */
export const CONFIRM_DELAY = INPUT_PAST_TOLERANCE + 1;
/** 상태 해시 브로드캐스트 간격 */
export const HASH_EVERY = 30;

export interface Acceptance {
  readonly tick: number;
  /** 허용치보다 늦게 도착해 현재 tick 으로 밀렸다 (지연 큰 유저: 결과 화면에서 원인 안내) */
  readonly late: boolean;
}

/**
 * 서버가 입력의 확정 tick 을 결정한다.
 * - 너무 늦은 입력: 현재 tick 으로 (과거로 끼워 넣지 않음 → 치트 불가)
 * - 너무 먼 미래: 상한으로
 * - 같은 러너의 이전 입력보다 늦도록 (tick 엄격 증가)
 */
export function acceptTick(stamp: number, serverTick: number, lastAccepted: number): Acceptance {
  let t = Number.isFinite(stamp) ? Math.round(stamp) : serverTick;
  let late = false;
  if (t < serverTick - INPUT_PAST_TOLERANCE) {
    t = serverTick;
    late = true;
  }
  if (t > serverTick + INPUT_FUTURE_LIMIT) t = serverTick + INPUT_FUTURE_LIMIT;
  if (t <= lastAccepted) t = lastAccepted + 1;
  return { tick: t, late };
}

/**
 * 클라이언트 리드(서버보다 앞서 실행할 tick 수). 입력이 허용치 안에 도착하도록 편도 지연 + 지터 + 여유를 덮는다.
 */
export function leadTicks(rttMs: number, jitterMs: number): number {
  const ms = Math.max(0, rttMs) / 2 + Math.max(0, jitterMs) + 8;
  return Math.max(1, Math.min(INPUT_FUTURE_LIMIT - 2, Math.ceil(ms / TICK_MS) - INPUT_PAST_TOLERANCE + 1));
}
