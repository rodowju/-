/**
 * 스킨 카탈로그 (GDD §8.2): 외형 전용. 판정/능력치에 영향 없음.
 * 가격은 초기 가설값이며 소프트런치 데이터로 조정한다.
 */
export type SkinCategory = 'character' | 'trail' | 'stopfx' | 'guardian';

export const CATEGORIES: readonly SkinCategory[] = ['character', 'trail', 'stopfx', 'guardian'];

export interface Skin {
  readonly id: string;
  readonly category: SkinCategory;
  /** i18n 키 */
  readonly nameKey: string;
  readonly price: number;
  /** 대표 색 (0xRRGGBB) */
  readonly color: number;
  /** 카테고리별 스타일 식별자 */
  readonly style: string;
}

const s = (category: SkinCategory, name: string, price: number, color: number, style: string): Skin => ({
  id: `${category}.${name}`,
  category,
  nameKey: `skin.${category}.${name}`,
  price,
  color,
  style,
});

export const SKINS: readonly Skin[] = [
  // 캐릭터: 모양 + 색
  s('character', 'default', 0, 0x4fd1c5, 'circle'),
  s('character', 'ember', 100, 0xf6ad55, 'circle'),
  s('character', 'mint', 150, 0x9ae6b4, 'square'),
  s('character', 'violet', 200, 0xb794f4, 'diamond'),
  s('character', 'gold', 400, 0xf6e05e, 'ring'),
  // 이동 트레일
  s('trail', 'none', 0, 0xffffff, 'none'),
  s('trail', 'dust', 80, 0xa0aec0, 'dust'),
  s('trail', 'spark', 160, 0xf6e05e, 'spark'),
  s('trail', 'ribbon', 240, 0x63b3ed, 'ribbon'),
  // 정지(Perfect) 이펙트
  s('stopfx', 'ring', 0, 0xffffff, 'ring'),
  s('stopfx', 'burst', 120, 0xf6e05e, 'burst'),
  s('stopfx', 'confetti', 200, 0xed64a6, 'confetti'),
  // 술래 테마: 외곽/장식만 바꾼다 (상태 색은 유지: 가독성·공정성)
  s('guardian', 'default', 0, 0xffffff, 'default'),
  s('guardian', 'frame', 100, 0x63b3ed, 'frame'),
  s('guardian', 'crown', 180, 0xf6e05e, 'crown'),
];

/** 처음부터 소유하는 기본 스킨 */
export const DEFAULT_IDS: readonly string[] = SKINS.filter((x) => x.price === 0).map((x) => x.id);

export const DEFAULT_EQUIPPED: Readonly<Record<SkinCategory, string>> = {
  character: 'character.default',
  trail: 'trail.none',
  stopfx: 'stopfx.ring',
  guardian: 'guardian.default',
};

const BY_ID = new Map(SKINS.map((x) => [x.id, x]));

export function skinById(id: string): Skin | undefined {
  return BY_ID.get(id);
}

export function skinsOf(category: SkinCategory): Skin[] {
  return SKINS.filter((x) => x.category === category);
}

/** 스테이지 3 첫 클리어 시 무료로 해금되는 스킨 (GDD §9 FTUE) */
export const FREE_SKIN_ID = 'character.ember';
