/**
 * 시뮬레이션 상수 (GDD §4.3). 모든 값은 정수이며, 시간은 tick, 거리는 마이크로미터(µm).
 * 수치는 초기 튜닝값(가설)이다.
 */
export const TICK_HZ = 60;

/** ms → tick (모듈 초기화 시점에만 사용: 입력은 상수 리터럴). */
export const msToTicks = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);

/** 미터 → µm */
export const meters = (m: number): number => Math.round(m * 1_000_000);

/** 최대 속도 ≈ 5.0 m/s (µm/tick) */
export const MAX_SPEED = 83_333;
/** 홀드 → 최대 속도까지 1.2 s */
export const ACCEL_TICKS = msToTicks(1200);
export const ACCEL = Math.ceil(MAX_SPEED / ACCEL_TICKS);
/** 제동 80 ms */
export const BRAKE_TICKS = msToTicks(80);
export const DECEL = Math.ceil(MAX_SPEED / BRAKE_TICKS);

/** 감시 허용 속도 ≈ 0.3 m/s */
export const V_TOL = 5_000;
/** Watch 시작 후 판정 유예 100 ms */
export const GRACE_TICKS = msToTicks(100);
/** 술래 회전 연출 300 ms (이 구간은 아직 안전) */
export const TURN_TICKS = msToTicks(300);
/**
 * 안전 릴리즈 마감 D = Watch 시작 + SAFE_RELEASE_TICKS.
 * 최대 속도에서 D에 릴리즈하면 판정 시점(Watch 시작 + GRACE)에 정확히 정지한다.
 * 제동(5 tick)·유예(6 tick) 값에서 파생하므로 둘을 바꾸면 자동 갱신된다.
 */
export const SAFE_RELEASE_TICKS = GRACE_TICKS - BRAKE_TICKS + 1;

/** Close Call 등급 창 (D 이전 tick 수) */
export const CC_PERFECT_TICKS = msToTicks(100);
export const CC_GREAT_TICKS = msToTicks(200);
export const CC_GOOD_TICKS = msToTicks(300);

/** 콤보 포인트(0.5 단위): Perfect +2, Great +1, Good +0.5 */
export const COMBO_POINTS = { perfect: 4, great: 2, good: 1 } as const;
/** 콤보 배율: 1 + floor(points / COMBO_PER_LEVEL), 최대 5 */
export const COMBO_PER_LEVEL = 4;
export const COMBO_MAX_MULT = 5;

export const CLOSE_CALL_BASE_SCORE = { perfect: 100, great: 50, good: 25 } as const;
export const CLEAR_SCORE = 1000;
/** par 대비 빠른 6 tick(0.1 s)마다 보너스 */
export const TIME_BONUS_PER_6_TICKS = 10;

/** 스테이지 스펙에 미리 생성하는 술래 사이클 수 (초과 시 순환) */
export const CYCLE_COUNT = 64;

/** 시뮬레이션 규칙 버전. 리플레이 호환성 판단에 사용. */
export const SIM_VERSION = 2;
