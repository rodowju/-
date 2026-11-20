import { EventQueue, buildPayload, sanitize, type EventName } from '../logic/analytics';
import { getProgress, saveProgress } from './storage';

/**
 * 익명 사용 통계 전송. 엔드포인트(VITE_ANALYTICS_URL)가 없으면 메모리 큐에만 쌓인다(개발/테스트).
 * 개인정보 없음: 무작위 설치 ID + 스키마에 허용된 키만 전송 (logic/analytics.ts).
 */
const ENDPOINT = import.meta.env.VITE_ANALYTICS_URL as string | undefined;
const INSTALL_KEY = 'freeze.install';
const FLUSH_MS = 15_000;
const BATCH = 50;

const queue = new EventQueue(200);

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* 폴백 */
  }
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const session = randomId();
let install = '';

function getInstallId(): string {
  if (install) return install;
  try {
    const stored = localStorage.getItem(INSTALL_KEY);
    if (stored) return (install = stored);
    install = randomId();
    localStorage.setItem(INSTALL_KEY, install);
  } catch {
    install = install || randomId();
  }
  return install;
}

export function isAnalyticsEnabled(): boolean {
  return getProgress().analytics !== false;
}

export function setAnalyticsEnabled(on: boolean): void {
  saveProgress({ ...getProgress(), analytics: on });
  if (!on) queue.ack(queue.size); // 끄면 아직 보내지 않은 데이터도 폐기
}

export function track(name: EventName, props: Readonly<Record<string, unknown>> = {}): void {
  if (!isAnalyticsEnabled()) return;
  queue.push({ name, ts: Date.now(), props: sanitize(name, props) });
  if (queue.size >= 10) void flush();
}

export async function flush(): Promise<void> {
  if (!ENDPOINT || queue.size === 0 || !isAnalyticsEnabled()) return;
  const batch = queue.peek(BATCH);
  const body = JSON.stringify(buildPayload(getInstallId(), session, 'freeze', batch));
  try {
    let ok: boolean;
    if (typeof navigator.sendBeacon === 'function') {
      ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      ok = (await fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } })).ok;
    }
    if (ok) queue.ack(batch.length);
  } catch {
    /* 네트워크 실패: 큐에 남겨 다음 기회에 재시도 */
  }
}

export function initAnalytics(): void {
  setInterval(() => void flush(), FLUSH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flush();
  });
  addEventListener('pagehide', () => void flush());
  (window as unknown as { __analytics: unknown }).__analytics = {
    events: () => queue.all(),
    enabled: isAnalyticsEnabled,
  };
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  track('session_start', {
    lang: navigator.language,
    dpr,
    vw: innerWidth,
    vh: innerHeight,
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    standalone: matchMedia('(display-mode: standalone)').matches,
    sessions: getProgress().sessions,
  });
  addEventListener('error', (e) => track('error', { msg: e.message, src: `${(e.filename ?? '').split('/').pop() ?? ''}:${e.lineno ?? 0}` }));
  addEventListener('unhandledrejection', (e) => track('error', { msg: String((e.reason as Error | undefined)?.message ?? e.reason), src: 'promise' }));
}
