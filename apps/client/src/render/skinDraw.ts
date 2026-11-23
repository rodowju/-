import Phaser from 'phaser';
import type { Skin } from '../logic/skins';

type G = Phaser.GameObjects.Graphics;

/** 러너(플레이어) 모양 */
export function drawRunner(g: G, x: number, y: number, r: number, skin: Skin, color = skin.color): void {
  g.fillStyle(color, 1);
  switch (skin.style) {
    case 'square':
      g.fillRoundedRect(x - r, y - r, r * 2, r * 2, r * 0.3);
      g.lineStyle(2, 0x000000, 0.35).strokeRoundedRect(x - r, y - r, r * 2, r * 2, r * 0.3);
      break;
    case 'diamond':
      g.fillPoints(
        [new Phaser.Geom.Point(x, y - r * 1.15), new Phaser.Geom.Point(x + r * 1.05, y), new Phaser.Geom.Point(x, y + r * 1.15), new Phaser.Geom.Point(x - r * 1.05, y)],
        true,
      );
      break;
    case 'ring':
      g.fillCircle(x, y, r);
      g.lineStyle(3, 0xffffff, 0.9).strokeCircle(x, y, r * 0.55);
      break;
    default:
      g.fillCircle(x, y, r);
      g.lineStyle(2, 0x000000, 0.35).strokeCircle(x, y, r);
  }
}

/**
 * 이동 트레일: 러너 뒤(아래)쪽에 속도 비례로 그린다. 순수 장식이며 상태를 갖지 않는다.
 * @param speed01 0..1
 * @param phase   애니메이션용 시간(ms)
 */
export function drawTrail(g: G, x: number, y: number, speed01: number, skin: Skin, phase: number): void {
  if (skin.style === 'none' || speed01 <= 0.05) return;
  const n = skin.style === 'ribbon' ? 0 : 5;
  if (skin.style === 'ribbon') {
    g.lineStyle(5, skin.color, 0.55 * speed01);
    g.lineBetween(x, y + 8, x + Math.sin(phase / 90) * 4, y + 8 + 34 * speed01);
    g.lineStyle(3, skin.color, 0.3 * speed01);
    g.lineBetween(x + 6, y + 8, x + 6 + Math.sin(phase / 90 + 1) * 4, y + 8 + 26 * speed01);
    return;
  }
  for (let i = 0; i < n; i++) {
    const k = (i + 1) / n;
    const jitter = skin.style === 'spark' ? Math.sin(phase / 60 + i * 2) * 5 : 0;
    g.fillStyle(skin.color, (1 - k) * 0.7 * speed01);
    g.fillCircle(x + jitter, y + 12 + i * 9 * speed01, skin.style === 'spark' ? 2.5 : 4 - i * 0.5);
  }
}

/** Perfect 정지 이펙트 (일회성 연출) */
export function spawnStopFx(scene: Phaser.Scene, x: number, y: number, skin: Skin): void {
  const g = scene.add.graphics().setDepth(14);
  const obj = { t: 0 };
  const draw = (): void => {
    g.clear();
    const t = obj.t;
    const a = 1 - t;
    if (skin.style === 'burst') {
      g.lineStyle(3, skin.color, a);
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        g.lineBetween(x + Math.cos(ang) * (10 + t * 8), y + Math.sin(ang) * (10 + t * 8), x + Math.cos(ang) * (16 + t * 30), y + Math.sin(ang) * (16 + t * 30));
      }
    } else if (skin.style === 'confetti') {
      const colors = [0xed64a6, 0xf6e05e, 0x63b3ed, 0x68d391];
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + i;
        const d = 12 + t * (28 + (i % 3) * 8);
        g.fillStyle(colors[i % colors.length] ?? 0xffffff, a);
        g.fillRect(x + Math.cos(ang) * d - 2, y + Math.sin(ang) * d - 2 + t * 10, 4, 4);
      }
    } else {
      g.lineStyle(3, skin.color, a).strokeCircle(x, y, 12 + t * 26);
    }
  };
  draw();
  scene.tweens.add({ targets: obj, t: 1, duration: 450, ease: 'Cubic.easeOut', onUpdate: draw, onComplete: () => g.destroy() });
}

/** 술래 테마 장식: 상태 색(초록/노랑/빨강)은 건드리지 않고 외곽·장식만 추가한다. */
export function drawGuardianDeco(g: G, cx: number, cy: number, r: number, skin: Skin): void {
  if (skin.style === 'frame') {
    g.lineStyle(3, skin.color, 0.9).strokeCircle(cx, cy, r + 5);
  } else if (skin.style === 'crown') {
    g.fillStyle(skin.color, 1);
    g.fillPoints(
      [
        new Phaser.Geom.Point(cx - 16, cy - r + 2),
        new Phaser.Geom.Point(cx - 18, cy - r - 14),
        new Phaser.Geom.Point(cx - 7, cy - r - 6),
        new Phaser.Geom.Point(cx, cy - r - 18),
        new Phaser.Geom.Point(cx + 7, cy - r - 6),
        new Phaser.Geom.Point(cx + 18, cy - r - 14),
        new Phaser.Geom.Point(cx + 16, cy - r + 2),
      ],
      true,
    );
  }
}

/**
 * 장승 술래 (천하대장군). 시안 A 를 축소해 그린다.
 * @param open 0 = 등(뒷면), 1 = 정면. 돌아보는 중에는 그 사이 값.
 * @param ring 상태 색(초록/노랑/빨강) — 바깥 원으로 표시해 가독성을 유지한다.
 */
export function drawJangseung(g: G, cx: number, cy: number, r: number, open: number, ring: number, watching: boolean): void {
  const k = r / 88; // 시안 좌표(200x240, 원 반지름 88, 중심 100,110) → 게임 좌표
  const X = (x: number): number => cx + (x - 100) * k;
  const Y = (y: number): number => cy + (y - 110) * k;
  const WOOD = 0xa0683a;
  const FACE = 0xd9a066;
  const DARK = 0x3b2412;
  const INK = 0x1a1a1a;

  g.fillStyle(ring, 0.18).fillCircle(cx, cy, r);
  g.lineStyle(3, ring, 1).strokeCircle(cx, cy, r);

  // 몸통(기둥)
  g.fillStyle(WOOD, 1).fillRoundedRect(X(62), Y(70), 76 * k, 132 * k, 6 * k);
  // 관모
  g.fillStyle(INK, 1).fillEllipse(X(100), Y(68), 84 * k, 70 * k);
  g.fillRoundedRect(X(48), Y(66), 104 * k, 12 * k, 5 * k);

  if (open < 0.25) {
    // 뒷면: 나뭇결
    g.lineStyle(Math.max(1, 2 * k * 2), DARK, 0.5);
    for (const x of [76, 92, 108, 124]) g.lineBetween(X(x), Y(84), X(x), Y(196));
    g.fillStyle(DARK, 0.5).fillEllipse(X(100), Y(140), 12 * k, 20 * k);
    return;
  }

  // 정면(돌아보는 중에는 옆으로 치우치고 좁게)
  const sq = Math.min(1, 0.45 + open * 0.55);
  const dx = 18 * (1 - open);
  const FX = (x: number): number => X(100 + dx + (x - 100) * sq);
  const w = (v: number): number => v * k * sq;

  g.fillStyle(FACE, 1).fillRoundedRect(FX(64), Y(80), w(72), 104 * k, 6 * k);
  // 눈썹
  g.lineStyle(Math.max(2, 7 * k), INK, 1);
  g.lineBetween(FX(68), Y(96), FX(94), Y(104));
  g.lineBetween(FX(132), Y(96), FX(106), Y(104));
  // 눈
  const pr = (watching ? 8 : 5) * k;
  for (const ex of [82, 118]) {
    g.fillStyle(0xffffff, 1).fillEllipse(FX(ex), Y(118), w(26), 26 * k);
    g.lineStyle(Math.max(1, 3 * k), INK, 1).strokeEllipse(FX(ex), Y(118), w(26), 26 * k);
    g.fillStyle(INK, 1).fillCircle(FX(ex), Y(118), pr);
  }
  // 코
  g.fillStyle(WOOD, 1).fillTriangle(FX(100), Y(120), FX(92), Y(150), FX(108), Y(150));
  // 이빨 웃음
  const pts: Phaser.Geom.Point[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = (1 - t) * (1 - t) * 72 + 2 * (1 - t) * t * 100 + t * t * 128;
    const y = (1 - t) * (1 - t) * 158 + 2 * (1 - t) * t * 182 + t * t * 158;
    pts.push(new Phaser.Geom.Point(FX(x), Y(y)));
  }
  g.fillStyle(0xffffff, 1).fillPoints(pts, true);
  g.lineStyle(Math.max(1, 3 * k), INK, 1).strokePoints(pts, true);
  g.lineStyle(Math.max(1, 2 * k), INK, 1);
  for (const tx of [84, 94, 104, 114]) g.lineBetween(FX(tx), Y(160), FX(tx), Y(169));
}
