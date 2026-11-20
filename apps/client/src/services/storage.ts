/** 진행 저장 (localStorage). 접근이 막힌 환경에서도 게임이 동작하도록 모든 접근을 try/catch 로 감싼다. */
const KEY = 'freeze.progress.v1';

interface Progress {
  /** stage → 최고 별 개수 */
  stars: Record<string, number>;
  /** 동적 Assist(tick). 미설정이면 스테이지 기본값을 쓴다. */
  assist?: number;
}

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (p && typeof p === 'object' && p.stars) return p;
    }
  } catch {
    /* 무시: 저장 불가 환경 */
  }
  return { stars: {} };
}

export function bestStars(stage: number): number {
  return load().stars[String(stage)] ?? 0;
}

/** 다음에 플레이할 스테이지: 클리어한 최대 스테이지 + 1 (기록 없으면 1) */
export function nextStage(): number {
  const cleared = Object.keys(load().stars).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return cleared.length ? Math.max(...cleared) + 1 : 1;
}

export function loadAssist(): number | undefined {
  const a = load().assist;
  return typeof a === 'number' && Number.isFinite(a) ? a : undefined;
}

export function saveAssist(assist: number): void {
  const p = load();
  p.assist = assist;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 무시 */
  }
}

/** 갱신되었으면 true */
export function saveStars(stage: number, stars: number): boolean {
  const p = load();
  const prev = p.stars[String(stage)] ?? 0;
  if (stars <= prev) return false;
  p.stars[String(stage)] = stars;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 무시 */
  }
  return true;
}
