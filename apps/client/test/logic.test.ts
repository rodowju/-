import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  DEFAULT_EQUIPPED,
  DEFAULT_IDS,
  FREE_SKIN_ID,
  SKINS,
  skinById,
  skinsOf,
} from '../src/logic/skins';
import {
  addCoins,
  applyClear,
  buy,
  coinsForClear,
  defaultProgress,
  equip,
  migrate,
  nextStageOf,
} from '../src/logic/progress';
import {
  INTERSTITIAL_COOLDOWN_MS,
  INTERSTITIAL_MIN_SESSIONS,
  shouldShowInterstitial,
  type AdContext,
} from '../src/logic/adPolicy';
import { DICTS, detectLang, placeholders, t, type MsgKey } from '../src/logic/i18n';
import { contrast, hue, hueDistance } from '../src/logic/color';

describe('스킨 카탈로그', () => {
  it('id 는 유일하고 카테고리 접두사와 일치', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    for (const s of SKINS) expect(s.id.startsWith(`${s.category}.`)).toBe(true);
  });
  it('카테고리마다 기본(무료) 스킨이 정확히 1개이고 기본 장착과 일치', () => {
    for (const c of CATEGORIES) {
      const free = skinsOf(c).filter((s) => s.price === 0);
      expect(free).toHaveLength(1);
      expect(DEFAULT_EQUIPPED[c]).toBe(free[0]!.id);
    }
    expect(DEFAULT_IDS).toHaveLength(CATEGORIES.length);
  });
  it('무료 해금 스킨은 유료 스킨이다', () => {
    expect(skinById(FREE_SKIN_ID)?.price).toBeGreaterThan(0);
  });
  it('캐릭터 색은 트랙 배경과 대비 ≥ 3:1 이고 "위험(빨강)" 색상과 구분된다 (공정성·가독성)', () => {
    const TRACK = 0x1c222a;
    const RED = 0xe53e3e;
    for (const s of skinsOf('character')) {
      expect(contrast(s.color, TRACK)).toBeGreaterThanOrEqual(3);
      const h = hue(s.color);
      if (h >= 0) expect(hueDistance(h, hue(RED))).toBeGreaterThan(25);
    }
  });
  it('모든 스킨 이름 키가 두 언어에 존재', () => {
    for (const s of SKINS) {
      expect(DICTS.en[s.nameKey as MsgKey]).toBeTruthy();
      expect(DICTS.ko[s.nameKey as MsgKey]).toBeTruthy();
    }
  });
});

describe('진행 저장 마이그레이션', () => {
  it('손상/비객체 데이터는 기본값', () => {
    expect(migrate(null)).toEqual(defaultProgress());
    expect(migrate('x')).toEqual(defaultProgress());
    expect(migrate([1, 2])).toEqual(defaultProgress());
  });
  it('v1({stars, assist}) 데이터를 보존하며 승격', () => {
    const p = migrate({ stars: { '1': 3, '2': 1 }, assist: 2 });
    expect(p.stars).toEqual({ '1': 3, '2': 1 });
    expect(p.assist).toBe(2);
    expect(p.highestStage).toBe(2);
    expect(nextStageOf(p)).toBe(3);
    expect(p.owned).toEqual(expect.arrayContaining([...DEFAULT_IDS]));
  });
  it('잘못된 값은 걸러낸다 (별 0/4, 알 수 없는 스킨, 남의 카테고리 장착)', () => {
    const p = migrate({
      stars: { '1': 0, '2': 4, '3': 2, abc: 3 },
      owned: ['character.ember', 'nope.x'],
      equipped: { character: 'trail.dust', trail: 'trail.dust' }, // 소유하지 않거나 카테고리 불일치
      coins: -5,
      lang: 'fr',
    });
    expect(p.stars).toEqual({ '3': 2 });
    expect(p.owned).toContain('character.ember');
    expect(p.owned).not.toContain('nope.x');
    expect(p.equipped.character).toBe('character.default');
    expect(p.equipped.trail).toBe('trail.none');
    expect(p.coins).toBe(0);
    expect(p.lang).toBeUndefined();
  });
});

describe('경제', () => {
  it('클리어 코인은 ★ 이 높을수록 많다', () => {
    expect(coinsForClear(1)).toBeLessThan(coinsForClear(2));
    expect(coinsForClear(2)).toBeLessThan(coinsForClear(3));
  });
  it('클리어: 코인 적립, 최고 별/최고 스테이지 갱신, 별이 낮으면 최고 유지', () => {
    const a = applyClear(defaultProgress(), 1, 2);
    expect(a.next.coins).toBe(coinsForClear(2));
    expect(a.newBest).toBe(true);
    const b = applyClear(a.next, 1, 1);
    expect(b.newBest).toBe(false);
    expect(b.next.stars['1']).toBe(2);
    expect(b.next.coins).toBe(coinsForClear(2) + coinsForClear(1)); // 재클리어도 코인은 받는다
    expect(b.next.highestStage).toBe(1);
  });
  it('스테이지 3 첫 클리어 시 무료 스킨 1회 해금', () => {
    const early = applyClear(defaultProgress(), 2, 1);
    expect(early.freeSkin).toBeUndefined();
    const third = applyClear(early.next, 3, 1);
    expect(third.freeSkin).toBe(FREE_SKIN_ID);
    expect(third.next.owned).toContain(FREE_SKIN_ID);
    const again = applyClear(third.next, 4, 1);
    expect(again.freeSkin).toBeUndefined();
  });
  it('구매: 잔액 차감 + 소유 + 자동 장착', () => {
    const p = addCoins(defaultProgress(), 150);
    const r = buy(p, 'character.mint');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next.coins).toBe(0);
      expect(r.next.owned).toContain('character.mint');
      expect(r.next.equipped.character).toBe('character.mint');
    }
  });
  it('구매 실패: 코인 부족/중복/없는 스킨 (상태 불변)', () => {
    const p = defaultProgress();
    expect(buy(p, 'character.gold')).toEqual({ ok: false, reason: 'funds' });
    expect(buy(p, 'character.default')).toEqual({ ok: false, reason: 'owned' });
    expect(buy(p, 'nope')).toEqual({ ok: false, reason: 'unknown' });
  });
  it('장착: 소유한 것만, 같은 카테고리 안에서 교체', () => {
    const p = addCoins(defaultProgress(), 1000);
    const bought = buy(p, 'trail.dust');
    if (!bought.ok) throw new Error('buy failed');
    expect(equip(bought.next, 'trail.none').equipped.trail).toBe('trail.none');
    expect(equip(p, 'trail.spark')).toBe(p); // 미소유 → 변화 없음
  });
  it('불변성: 입력 Progress 를 변경하지 않는다', () => {
    const p = Object.freeze(addCoins(defaultProgress(), 500));
    expect(() => buy(p, 'character.ember')).not.toThrow();
    expect(() => applyClear(p, 3, 3)).not.toThrow();
  });
});

describe('광고 정책', () => {
  const ok: AdContext = { sessions: INTERSTITIAL_MIN_SESSIONS, highestStage: 4, lastInterstitialAt: 0, now: 10_000_000 };
  it('조건 충족 시 노출', () => expect(shouldShowInterstitial(ok)).toBe(true));
  it('첫 3세션은 비노출', () => expect(shouldShowInterstitial({ ...ok, sessions: 3 })).toBe(false));
  it('5스테이지 도달 전 비노출', () => expect(shouldShowInterstitial({ ...ok, highestStage: 3 })).toBe(false));
  it('쿨다운 3분', () => {
    expect(shouldShowInterstitial({ ...ok, lastInterstitialAt: ok.now - INTERSTITIAL_COOLDOWN_MS + 1 })).toBe(false);
    expect(shouldShowInterstitial({ ...ok, lastInterstitialAt: ok.now - INTERSTITIAL_COOLDOWN_MS })).toBe(true);
  });
  it('광고 제거 구매자는 비노출', () => expect(shouldShowInterstitial({ ...ok, adsRemoved: true })).toBe(false));
});

describe('i18n', () => {
  const keys = Object.keys(DICTS.en) as MsgKey[];
  it('두 언어의 키 집합이 같다', () => {
    expect(Object.keys(DICTS.ko).sort()).toEqual([...keys].sort());
  });
  it('모든 문자열이 비어 있지 않고 자리표시자가 두 언어에서 일치', () => {
    for (const k of keys) {
      expect(DICTS.en[k].length).toBeGreaterThan(0);
      expect(DICTS.ko[k].length).toBeGreaterThan(0);
      expect(placeholders(DICTS.ko[k])).toEqual(placeholders(DICTS.en[k]));
    }
  });
  it('자리표시자 치환과 누락 처리', () => {
    expect(t('en', 'why.late', { ms: 17 })).toBe('You released 17 ms too late');
    expect(t('ko', 'why.late', { ms: 17 })).toBe('17ms 늦게 손을 뗐어요');
    expect(t('en', 'why.late')).toContain('{ms}');
  });
  it('언어 감지', () => {
    expect(detectLang('ko-KR')).toBe('ko');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('ja')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});
