import { t } from '../logic/i18n';
import { getLang } from './storage';

/**
 * 광고 추상화 (아키텍처 §5, §8). 실제 SDK(웹 광고 네트워크/게임 포털) 선정 전까지는 MockAds 를 사용한다.
 * 호출 규칙: 플레이 중에는 절대 호출하지 않는다 (결과 화면에서만).
 */
export interface AdsService {
  rewardedReady(): boolean;
  /** 끝까지 시청했을 때만 true (보상 지급 조건) */
  showRewarded(): Promise<boolean>;
  showInterstitial(): Promise<void>;
}

const params = new URLSearchParams(location.search);
/** 테스트에서 광고 길이를 줄이기 위한 옵션 */
const MOCK_MS = Math.max(200, Number(params.get('adms') ?? 3000) || 3000);

/** 개발용 광고: 전체 화면 오버레이를 일정 시간 보여준다. */
export class MockAds implements AdsService {
  private busy = false;

  rewardedReady(): boolean {
    return !this.busy;
  }

  showRewarded(): Promise<boolean> {
    return this.show(true).then(() => true);
  }

  showInterstitial(): Promise<void> {
    return this.show(false);
  }

  private show(rewarded: boolean): Promise<void> {
    if (this.busy) return Promise.resolve();
    this.busy = true;
    const lang = getLang();
    const el = document.createElement('div');
    el.setAttribute('data-testid', rewarded ? 'ad-rewarded' : 'ad-interstitial');
    el.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#000c;color:#fff;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;font:600 18px system-ui,sans-serif;gap:8px;touch-action:none;';
    // 광고 위의 터치가 게임 입력으로 새지 않도록 차단
    for (const ev of ['pointerdown', 'pointerup', 'pointercancel']) el.addEventListener(ev, (e) => e.stopPropagation());
    document.body.appendChild(el);
    return new Promise<void>((resolve) => {
      const start = performance.now();
      const tick = (): void => {
        const left = Math.max(0, MOCK_MS - (performance.now() - start));
        el.textContent = `${t(lang, 'ad.mock')} — ${t(lang, 'ad.closing', { s: Math.ceil(left / 1000) })}`;
        if (left <= 0) {
          el.remove();
          this.busy = false;
          resolve();
        } else {
          setTimeout(tick, 100);
        }
      };
      tick();
    });
  }
}

export const ads: AdsService = new MockAds();
