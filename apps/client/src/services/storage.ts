import { defaultProgress, migrate, type Lang, type Progress } from '../logic/progress';
import { detectLang } from '../logic/i18n';

/**
 * 진행 저장 (localStorage). 접근이 막힌 환경(프라이빗 모드 등)에서도 게임이 동작하도록
 * 모든 접근을 try/catch 로 감싸고, 실패 시 메모리 값으로 폴백한다.
 */
const KEY = 'freeze.progress.v1';

let memory: Progress | undefined;

export function getProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      memory = migrate(JSON.parse(raw));
      return memory;
    }
  } catch {
    /* 읽기/파싱 실패: 메모리 폴백 */
  }
  return memory ?? defaultProgress();
}

export function saveProgress(p: Progress): void {
  memory = p;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 저장 불가 환경: 이번 세션 동안만 유지 */
  }
}

/** 앱 실행 시 1회 호출 (전면 광고 정책의 세션 수 집계) */
export function noteSession(): void {
  const p = getProgress();
  saveProgress({ ...p, sessions: p.sessions + 1 });
}

export function getLang(): Lang {
  const saved = getProgress().lang;
  if (saved) return saved;
  // 영문 주소(/en/)로 들어오면 영어로 시작 (11-23)
  if (typeof location !== 'undefined' && /^\/en(\/|$)/.test(location.pathname)) return 'en';
  return detectLang(typeof navigator !== 'undefined' ? navigator.language : undefined);
}

export function setLang(lang: Lang): void {
  saveProgress({ ...getProgress(), lang });
}
