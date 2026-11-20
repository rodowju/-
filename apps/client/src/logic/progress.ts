import { CATEGORIES, DEFAULT_EQUIPPED, DEFAULT_IDS, FREE_SKIN_ID, skinById, type SkinCategory } from './skins';

export type Lang = 'ko' | 'en';

/** 저장 데이터 (localStorage JSON). v1: {stars, assist} → v2 로 마이그레이션. */
export interface Progress {
  readonly v: 2;
  /** stage → 최고 별 */
  readonly stars: Readonly<Record<string, number>>;
  /** 동적 Assist(tick), 미설정이면 스테이지 기본값 */
  readonly assist?: number;
  readonly coins: number;
  readonly owned: readonly string[];
  readonly equipped: Readonly<Record<SkinCategory, string>>;
  readonly lang?: Lang;
  /** 실행(세션) 횟수 */
  readonly sessions: number;
  /** 마지막 전면 광고 시각(ms epoch), 없으면 0 */
  readonly lastInterstitialAt: number;
  /** 클리어한 최고 스테이지 */
  readonly highestStage: number;
  readonly freeSkinGranted: boolean;
  /** 효과음 끔 */
  readonly muted?: boolean;
  /** 익명 사용 통계 전송 허용 (미설정이면 기본 허용 — 지역별 동의 정책은 출시 전 검토 필요) */
  readonly analytics?: boolean;
}

export function defaultProgress(): Progress {
  return {
    v: 2,
    stars: {},
    coins: 0,
    owned: [...DEFAULT_IDS],
    equipped: { ...DEFAULT_EQUIPPED },
    sessions: 0,
    lastInterstitialAt: 0,
    highestStage: 0,
    freeSkinGranted: false,
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, d: number, min = 0): number => (typeof x === 'number' && Number.isFinite(x) && x >= min ? x : d);

/** 임의의 저장값을 안전하게 Progress 로 정규화한다 (손상/구버전 데이터 허용). */
export function migrate(raw: unknown): Progress {
  const base = defaultProgress();
  if (!isObj(raw)) return base;

  const stars: Record<string, number> = {};
  if (isObj(raw.stars)) {
    for (const [k, v] of Object.entries(raw.stars)) {
      if (Number.isInteger(Number(k)) && Number(k) > 0 && typeof v === 'number' && v >= 1 && v <= 3) stars[k] = Math.floor(v);
    }
  }
  const owned = new Set<string>(DEFAULT_IDS);
  if (Array.isArray(raw.owned)) for (const id of raw.owned) if (typeof id === 'string' && skinById(id)) owned.add(id);

  const equipped: Record<SkinCategory, string> = { ...DEFAULT_EQUIPPED };
  if (isObj(raw.equipped)) {
    for (const c of CATEGORIES) {
      const id = raw.equipped[c];
      if (typeof id === 'string' && owned.has(id) && skinById(id)?.category === c) equipped[c] = id;
    }
  }
  const stageKeys = Object.keys(stars).map(Number);
  const assist = typeof raw.assist === 'number' && Number.isFinite(raw.assist) && raw.assist >= 0 ? Math.floor(raw.assist) : undefined;
  const lang = raw.lang === 'ko' || raw.lang === 'en' ? raw.lang : undefined;

  return {
    ...base,
    stars,
    ...(assist !== undefined ? { assist } : {}),
    coins: Math.floor(num(raw.coins, 0)),
    owned: [...owned],
    equipped,
    ...(lang ? { lang } : {}),
    sessions: Math.floor(num(raw.sessions, 0)),
    lastInterstitialAt: num(raw.lastInterstitialAt, 0),
    highestStage: Math.max(Math.floor(num(raw.highestStage, 0)), stageKeys.length ? Math.max(...stageKeys) : 0),
    freeSkinGranted: raw.freeSkinGranted === true,
    ...(typeof raw.muted === 'boolean' ? { muted: raw.muted } : {}),
    ...(typeof raw.analytics === 'boolean' ? { analytics: raw.analytics } : {}),
  };
}

// ───────── 경제 (GDD §8) ─────────

/** 클리어 코인: 기본 20 + ★당 10 (가설값) */
export function coinsForClear(stars: number): number {
  return 20 + 10 * Math.max(1, Math.min(3, stars));
}

export interface ClearResult {
  readonly next: Progress;
  readonly coins: number;
  readonly newBest: boolean;
  /** 이번 클리어로 무료 해금된 스킨 id */
  readonly freeSkin?: string;
}

export function applyClear(p: Progress, stage: number, stars: number): ClearResult {
  const prevBest = p.stars[String(stage)] ?? 0;
  const newBest = stars > prevBest;
  const coins = coinsForClear(stars);
  let owned = p.owned;
  let freeSkinGranted = p.freeSkinGranted;
  let freeSkin: string | undefined;
  // 스테이지 3 첫 클리어 시 첫 스킨 무료 해금 (GDD §9)
  if (stage >= 3 && !p.freeSkinGranted) {
    freeSkinGranted = true;
    if (!owned.includes(FREE_SKIN_ID)) {
      owned = [...owned, FREE_SKIN_ID];
      freeSkin = FREE_SKIN_ID;
    }
  }
  return {
    next: {
      ...p,
      stars: newBest ? { ...p.stars, [String(stage)]: stars } : p.stars,
      coins: p.coins + coins,
      owned,
      freeSkinGranted,
      highestStage: Math.max(p.highestStage, stage),
    },
    coins,
    newBest,
    ...(freeSkin ? { freeSkin } : {}),
  };
}

export type BuyResult = { ok: true; next: Progress } | { ok: false; reason: 'unknown' | 'owned' | 'funds' };

export function buy(p: Progress, id: string): BuyResult {
  const skin = skinById(id);
  if (!skin) return { ok: false, reason: 'unknown' };
  if (p.owned.includes(id)) return { ok: false, reason: 'owned' };
  if (p.coins < skin.price) return { ok: false, reason: 'funds' };
  return {
    ok: true,
    next: {
      ...p,
      coins: p.coins - skin.price,
      owned: [...p.owned, id],
      equipped: { ...p.equipped, [skin.category]: id },
    },
  };
}

export function equip(p: Progress, id: string): Progress {
  const skin = skinById(id);
  if (!skin || !p.owned.includes(id)) return p;
  return { ...p, equipped: { ...p.equipped, [skin.category]: id } };
}

/** 리워드 광고 등으로 코인을 추가 지급 */
export function addCoins(p: Progress, amount: number): Progress {
  return { ...p, coins: p.coins + Math.max(0, Math.floor(amount)) };
}

export function nextStageOf(p: Progress): number {
  return p.highestStage + 1;
}
