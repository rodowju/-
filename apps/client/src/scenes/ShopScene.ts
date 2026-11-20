import Phaser from 'phaser';
import { CATEGORIES, SKINS, skinById, skinsOf, type Skin, type SkinCategory } from '../logic/skins';
import { buy, equip } from '../logic/progress';
import { t, type MsgKey } from '../logic/i18n';
import { getLang, getProgress, saveProgress, setLang } from '../services/storage';
import { COLORS, GAME_H, GAME_W } from '../layout';
import { drawGuardianDeco, drawRunner, drawTrail } from '../render/skinDraw';
import { sfx } from '../audio/sfx';
import { isAnalyticsEnabled, setAnalyticsEnabled, track } from '../services/analytics';

interface ShopData {
  /** 상점을 나갈 때 시작할 플레이 씬 데이터 */
  back?: { stage?: number; lives?: number; deaths?: number; revived?: boolean };
}

const CARD_H = 66;
const LIST_TOP = 150;

/** 스킨 상점 (GDD §8.2). 외형 전용, 코인으로만 구매. */
export class ShopScene extends Phaser.Scene {
  private tab: SkinCategory = 'character';
  private back: ShopData['back'];
  private ui: Phaser.GameObjects.GameObject[] = [];
  private toastText?: Phaser.GameObjects.Text;

  constructor() {
    super('Shop');
  }

  init(data: ShopData): void {
    this.back = data.back;
    this.tab = 'character';
    track('shop_open', { from: data.back ? 'result' : 'direct' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#111418');
    this.rebuild();
    (window as unknown as { __shop: unknown }).__shop = {
      tab: () => this.tab,
      progress: () => getProgress(),
      select: (id: string) => this.onCard(skinById(id)),
      setTab: (c: SkinCategory) => {
        this.tab = c;
        this.rebuild();
      },
    };
  }

  private rebuild(): void {
    for (const o of this.ui) o.destroy();
    this.ui = [];
    const lang = getLang();
    const p = getProgress();
    const mono = { fontFamily: 'system-ui, sans-serif' };
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.ui.push(o);
      return o;
    };

    add(this.add.text(16, 16, t(lang, 'shop.title'), { ...mono, fontSize: '24px', color: COLORS.text, fontStyle: 'bold' }));
    add(this.add.text(GAME_W - 16, 20, `● ${p.coins}`, { ...mono, fontSize: '20px', color: '#f6e05e' }).setOrigin(1, 0));
    // 설정 토글 (오른쪽에서 왼쪽으로): 언어 / 소리 / 통계
    const muted = p.muted === true;
    const statsOn = isAnalyticsEnabled();
    this.button(add, GAME_W - 38, 62, 44, 26, t(lang, 'lang.toggle'), () => {
      setLang(lang === 'ko' ? 'en' : 'ko');
      this.rebuild();
    });
    this.button(add, GAME_W - 38 - 22 - 6 - 40, 62, 80, 26, t(lang, muted ? 'settings.sound.off' : 'settings.sound.on'), () => {
      saveProgress({ ...getProgress(), muted: !muted });
      sfx.setMuted(!muted);
      this.rebuild();
    }, muted ? 0x4a2b2b : 0x2d3640);
    this.button(add, GAME_W - 38 - 22 - 6 - 80 - 6 - 40, 62, 80, 26, t(lang, statsOn ? 'settings.stats.on' : 'settings.stats.off'), () => {
      setAnalyticsEnabled(!statsOn);
      this.rebuild();
    }, statsOn ? 0x2d3640 : 0x4a2b2b);

    // 탭
    const tabW = (GAME_W - 24) / CATEGORIES.length;
    CATEGORIES.forEach((c, i) => {
      const x = 12 + i * tabW + tabW / 2;
      const active = c === this.tab;
      this.button(add, x, 106, tabW - 6, 32, t(lang, `tab.${c}` as MsgKey), () => {
        this.tab = c;
        this.rebuild();
      }, active ? 0x2c5282 : 0x2d3640);
    });

    // 스킨 카드
    skinsOf(this.tab).forEach((skin, i) => this.card(add, skin, LIST_TOP + i * (CARD_H + 8), lang));

    this.button(add, GAME_W / 2, GAME_H - 36, 200, 40, t(lang, 'shop.back'), () => this.exit(), 0x2f855a);
    this.toastText = add(
      this.add.text(GAME_W / 2, GAME_H - 80, '', { ...mono, fontSize: '16px', color: '#f6e05e', fontStyle: 'bold' }).setOrigin(0.5),
    );
  }

  private card(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T, skin: Skin, y: number, lang: ReturnType<typeof getLang>): void {
    const p = getProgress();
    const owned = p.owned.includes(skin.id);
    const equipped = p.equipped[skin.category] === skin.id;
    const bg = add(
      this.add.rectangle(GAME_W / 2, y + CARD_H / 2, GAME_W - 24, CARD_H, equipped ? 0x22543d : 0x1c222a).setStrokeStyle(2, equipped ? 0x68d391 : 0x2d3640),
    );
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.onCard(skin));

    // 미리보기
    const g = add(this.add.graphics());
    const px = 50;
    const py = y + CARD_H / 2;
    if (skin.category === 'character') {
      drawRunner(g, px, py, 14, skin);
    } else if (skin.category === 'trail') {
      const base = skinById('character.default');
      if (base) drawRunner(g, px, py - 10, 9, base);
      drawTrail(g, px, py - 10, 1, skin, 0);
    } else if (skin.category === 'stopfx') {
      g.lineStyle(3, skin.color, 1);
      if (skin.style === 'burst') {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.lineBetween(px + Math.cos(a) * 8, py + Math.sin(a) * 8, px + Math.cos(a) * 18, py + Math.sin(a) * 18);
        }
      } else if (skin.style === 'confetti') {
        [0xed64a6, 0xf6e05e, 0x63b3ed, 0x68d391].forEach((c, i) => g.fillStyle(c, 1).fillRect(px - 16 + i * 9, py - 4 + (i % 2) * 8, 5, 5));
      } else {
        g.strokeCircle(px, py, 14);
      }
    } else {
      g.fillStyle(0x38a169, 1).fillCircle(px, py + 2, 14);
      drawGuardianDeco(g, px, py + 2, 14, skin);
    }

    add(this.add.text(88, y + 12, t(lang, skin.nameKey as MsgKey), { fontFamily: 'system-ui, sans-serif', fontSize: '17px', color: COLORS.text }));
    const status = equipped ? t(lang, 'shop.equipped') : owned ? t(lang, 'shop.owned') : `● ${skin.price}`;
    add(
      this.add
        .text(GAME_W - 24, y + CARD_H / 2, status, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '16px',
          color: equipped ? '#68d391' : owned ? COLORS.dim : p.coins >= skin.price ? '#f6e05e' : '#fc8181',
        })
        .setOrigin(1, 0.5),
    );
  }

  private onCard(skin: Skin | undefined): void {
    if (!skin) return;
    const lang = getLang();
    const p = getProgress();
    if (p.owned.includes(skin.id)) {
      saveProgress(equip(p, skin.id));
      track('equip', { skin: skin.id });
    } else {
      const r = buy(p, skin.id);
      if (!r.ok) {
        if (r.reason === 'funds') this.toast(t(lang, 'shop.notEnough'));
        return;
      }
      saveProgress(r.next);
      track('purchase', { skin: skin.id, price: skin.price });
      this.toast(t(lang, 'shop.bought'));
    }
    this.rebuild();
  }

  private toast(msg: string): void {
    this.toastText?.setText(msg);
    this.time.delayedCall(1400, () => this.toastText?.setText(''));
  }

  private exit(): void {
    this.scene.start('Play', this.back ?? {});
  }

  private button(
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
    cx: number,
    cy: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    fill = 0x2d3640,
  ): void {
    const r = add(this.add.rectangle(cx, cy, w, h, fill).setStrokeStyle(1, 0x4a5563));
    r.setInteractive({ useHandCursor: true }).on('pointerup', onClick);
    add(this.add.text(cx, cy, label, { fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: COLORS.text }).setOrigin(0.5));
  }
}

// 사용되지 않는 import 경고 방지용 (카탈로그 크기 참조)
export const SHOP_ITEM_COUNT = SKINS.length;
