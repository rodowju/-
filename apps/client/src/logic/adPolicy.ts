/**
 * 광고 노출 정책 (GDD §8.3, §9). 순수 함수로 두어 테스트 가능하게 한다.
 * - 전면(인터스티셜): 첫 3세션 비노출, 5스테이지 도달 전 비노출, 쿨다운 ≥ 3분, 플레이 중 절대 비노출(호출 측 책임).
 * - 리워드: 유저가 선택할 때만 (정책 제한 없음).
 */
export const INTERSTITIAL_MIN_SESSIONS = 4;
export const INTERSTITIAL_MIN_STAGE_REACHED = 5;
export const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000;

export interface AdContext {
  readonly sessions: number;
  /** 클리어한 최고 스테이지 */
  readonly highestStage: number;
  readonly lastInterstitialAt: number;
  readonly now: number;
  /** 광고 제거 구매 여부 (후속 IAP) */
  readonly adsRemoved?: boolean;
}

export function shouldShowInterstitial(c: AdContext): boolean {
  if (c.adsRemoved) return false;
  if (c.sessions < INTERSTITIAL_MIN_SESSIONS) return false;
  if (c.highestStage + 1 < INTERSTITIAL_MIN_STAGE_REACHED) return false;
  if (c.lastInterstitialAt > 0 && c.now - c.lastInterstitialAt < INTERSTITIAL_COOLDOWN_MS) return false;
  return true;
}
