import Phaser from 'phaser';
import {
  CC_GOOD_TICKS,
  MAX_SPEED,
  SAFE_RELEASE_TICKS,
  TICK_HZ,
  V_TOL,
  aliveCount,
  comboMultiplier,
  isHuman,
  rankOf,
  type StageSpec,
  type WorldState,
} from '@freeze/sim';
import { COLORS, GAME_H, GAME_W, PLAYER_Y, PPM, TRACK_CX, TRACK_LEFT, TRACK_RIGHT } from '../layout';
import { t, type MsgKey } from '../logic/i18n';
import type { Lang } from '../logic/progress';
import type { Skin, SkinCategory } from '../logic/skins';
import { drawGuardianDeco, drawJangseung, drawRunner, drawTrail } from './skinDraw';

const UM_PER_M = 1_000_000;
const toMps = (v: number): number => (v * TICK_HZ) / UM_PER_M;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 다른 사람 플레이어 색 (내 스킨과 구분) */
/** 이 높이보다 위(술래·타이밍 바 영역 또는 화면 밖)로 앞서간 상대는 ▲ 표시로 바꾼다 */
const AHEAD_Y = 190;

const OTHER_HUMAN_COLORS = [0xf6ad55, 0xb794f4, 0x63b3ed, 0xfbb6ce];

export interface DrawOptions {
  /** 카메라가 따라갈 러너 (내 러너) */
  readonly me: number;
  readonly alpha: number;
  /** 결과 화면 등에서 화면을 어둡게 */
  readonly dim?: boolean;
  readonly lives?: { readonly left: number; readonly max: number };
  readonly showHint?: boolean;
  /** 리플레이: 실제로 손을 뗀 tick 표시 */
  readonly releaseTicks?: readonly number[];
  /** 고스트의 현재 위치(m) */
  readonly ghostM?: number;
}

/**
 * 월드 렌더러 (트랙, 러너, 술래, 타이밍 바, HUD). 싱글/온라인 씬이 공유한다.
 * 상태를 바꾸지 않는다: 주어진 WorldState 를 그리기만 한다.
 */
export class WorldView {
  readonly big: Phaser.GameObjects.Text;
  readonly sub: Phaser.GameObjects.Text;
  readonly tag: Phaser.GameObjects.Text;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly comboText: Phaser.GameObjects.Text;
  private readonly stageText: Phaser.GameObjects.Text;
  private readonly phaseText: Phaser.GameObjects.Text;
  private readonly hintText: Phaser.GameObjects.Text;
  private readonly distText: Phaser.GameObjects.Text;
  private readonly rankText: Phaser.GameObjects.Text;
  private readonly debugText?: Phaser.GameObjects.Text;
  /** 화면 위로 벗어난 상대의 거리 표시 (필요할 때 만들어 재사용) */
  private readonly aheadTexts: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private spec: StageSpec,
    private readonly skins: Record<SkinCategory, Skin>,
    private readonly lang: Lang,
    stageLabel: string,
    debug: boolean,
  ) {
    const mono = { fontFamily: 'system-ui, sans-serif' };
    this.gfx = scene.add.graphics();
    this.overlay = scene.add.graphics().setDepth(20);
    this.scoreText = scene.add.text(12, 10, '0', { ...mono, fontSize: '22px', color: COLORS.text }).setDepth(10);
    this.stageText = scene.add.text(8, 38, stageLabel, { ...mono, fontSize: '11px', color: COLORS.dim }).setDepth(10);
    this.tag = scene.add
      .text(GAME_W / 2, GAME_H - 40, '', { ...mono, fontSize: '16px', color: '#f6e05e', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(25);
    this.comboText = scene.add.text(GAME_W - 12, 10, '', { ...mono, fontSize: '22px', color: COLORS.perfect }).setOrigin(1, 0).setDepth(10);
    this.rankText = scene.add
      .text(GAME_W - 6, 52, '', { ...mono, fontSize: '11px', color: COLORS.dim, align: 'right' })
      .setOrigin(1, 0)
      .setDepth(10);
    this.phaseText = scene.add.text(GAME_W / 2, 118, '', { ...mono, fontSize: '13px', color: COLORS.dim }).setOrigin(0.5, 0).setDepth(10);
    this.distText = scene.add.text(GAME_W - 6, 38, '', { ...mono, fontSize: '11px', color: COLORS.dim }).setOrigin(1, 0).setDepth(10);
    this.hintText = scene.add
      .text(GAME_W / 2, GAME_H - 70, `${t(lang, 'hint.hold')}\n${t(lang, 'hint.release')}`, {
        ...mono,
        fontSize: '18px',
        color: COLORS.text,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.big = scene.add
      .text(GAME_W / 2, 236, '', { ...mono, fontSize: '40px', color: COLORS.text, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(30);
    this.sub = scene.add
      .text(GAME_W / 2, 272, '', { ...mono, fontSize: '15px', color: COLORS.text, align: 'center' })
      .setOrigin(0.5, 0)
      .setDepth(30);
    if (debug) {
      this.debugText = scene.add.text(8, GAME_H - 80, '', { fontFamily: 'monospace', fontSize: '10px', color: '#a0aec0' }).setDepth(40);
    }
  }

  /** 온라인: 매치가 정해지면 스펙 교체 */
  setSpec(spec: StageSpec, stageLabel: string): void {
    this.spec = spec;
    this.stageText.setText(stageLabel);
  }

  setDebug(text: string): void {
    this.debugText?.setText(text);
  }

  popup(text: string, color: string, sub: string): void {
    const p = this.scene.add
      .text(TRACK_CX, PLAYER_Y - 60, sub ? `${text}  ${sub}` : text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(15);
    this.scene.tweens.add({ targets: p, y: p.y - 50, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => p.destroy() });
  }

  draw(cur: WorldState, pr: WorldState, o: DrawOptions): void {
    const g = this.gfx;
    const ov = this.overlay;
    g.clear();
    ov.clear();
    const spec = this.spec;
    const me = cur.runners[o.me];
    const meP = pr.runners[o.me] ?? me;
    if (!me || !meP) return;
    const phase = cur.guardian.phase;
    const meM = lerp(meP.pos, me.pos, o.alpha) / UM_PER_M;
    const trackM = spec.trackLength / UM_PER_M;
    const sy = (posM: number): number => PLAYER_Y - (posM - meM) * PPM;

    // 트랙
    g.fillStyle(COLORS.track, 1).fillRect(TRACK_LEFT, 0, TRACK_RIGHT - TRACK_LEFT, GAME_H);
    g.lineStyle(2, COLORS.line, 1);
    g.lineBetween(TRACK_LEFT, 0, TRACK_LEFT, GAME_H);
    g.lineBetween(TRACK_RIGHT, 0, TRACK_RIGHT, GAME_H);
    const first = Math.floor(meM - (GAME_H - PLAYER_Y) / PPM);
    const last = Math.ceil(meM + PLAYER_Y / PPM);
    for (let m = Math.max(0, first); m <= Math.min(trackM, last); m += 1) {
      if (m % 5 === 0) g.lineBetween(TRACK_LEFT, sy(m), TRACK_RIGHT, sy(m));
    }
    g.fillStyle(0x4a5563, 1).fillRect(TRACK_LEFT, sy(0) - 2, TRACK_RIGHT - TRACK_LEFT, 4);
    this.drawFinish(g, sy(trackM));

    // 고스트 (비동기 대전 상대)
    if (o.ghostM !== undefined) {
      const y = sy(o.ghostM);
      if (y > -20 && y < GAME_H + 20) {
        g.fillStyle(0xffffff, 0.28).fillCircle(TRACK_CX - 28, y, 10);
        g.lineStyle(2, 0xffffff, 0.5).strokeCircle(TRACK_CX - 28, y, 10);
      }
    }

    // 다른 러너: 나를 제외하고 레인에 고르게 배치
    const others = cur.runners.filter((r) => r.id !== o.me);
    const n = others.length;
    let humanIdx = 0;
    let aheadUsed = 0;
    others.forEach((r, i) => {
      const rp = pr.runners[r.id] ?? r;
      const x = n > 1 ? TRACK_LEFT + 22 + (i * (TRACK_RIGHT - TRACK_LEFT - 44)) / (n - 1) : TRACK_LEFT + 30;
      const posM = lerp(rp.pos, r.pos, o.alpha) / UM_PER_M;
      const y = sy(posM);
      const human = isHuman(spec, r.id);
      const color = human ? OTHER_HUMAN_COLORS[humanIdx++ % OTHER_HUMAN_COLORS.length]! : COLORS.bot;
      // 술래·타이밍 바 영역(위쪽)이나 화면 밖으로 앞서간 상대: 가장자리에 ▲ + 앞선 거리
      if (y < AHEAD_Y && r.status !== 'caught' && !o.dim) {
        g.fillStyle(color, 0.95).fillTriangle(x, AHEAD_Y - 7, x - 6, AHEAD_Y + 3, x + 6, AHEAD_Y + 3);
        if (human) g.lineStyle(1.5, 0xffffff, 0.8).strokeTriangle(x, AHEAD_Y - 7, x - 6, AHEAD_Y + 3, x + 6, AHEAD_Y + 3);
        const label = this.aheadText(aheadUsed++);
        label.setText(`${Math.max(1, Math.round(posM - meM))}m`).setPosition(x, AHEAD_Y + 6).setColor(human ? '#ffffff' : '#a0aec0').setVisible(true);
        return;
      }
      if (y < -10 || y > GAME_H + 10) return;
      const out = r.status === 'caught';
      g.fillStyle(out ? COLORS.botOut : color, out ? 0.6 : 1);
      g.fillCircle(x, y, human ? 8 : 6);
      if (human) g.lineStyle(2, 0xffffff, 0.8).strokeCircle(x, y, 8);
    });

    for (let i = aheadUsed; i < this.aheadTexts.length; i++) this.aheadTexts[i]!.setVisible(false);

    // 나 (스킨은 외형 전용)
    if (me.status === 'caught') {
      g.fillStyle(COLORS.watch, 1).fillCircle(TRACK_CX, PLAYER_Y, 11);
      g.lineStyle(2, 0x000000, 0.35).strokeCircle(TRACK_CX, PLAYER_Y, 11);
    } else {
      drawTrail(g, TRACK_CX, PLAYER_Y, me.vel / MAX_SPEED, this.skins.trail, this.scene.time.now);
      drawRunner(g, TRACK_CX, PLAYER_Y, 11, this.skins.character);
    }

    this.drawGuardian(g, cur);
    this.drawTimingBar(g, cur, o.releaseTicks);
    this.drawSpeedBar(g, me.vel);

    if (phase === 'watch') ov.lineStyle(10, COLORS.watch, 0.55).strokeRect(0, 0, GAME_W, GAME_H);
    if (o.dim) ov.fillStyle(0x000000, 0.55).fillRect(0, 0, GAME_W, GAME_H);
    if (o.lives) {
      for (let i = 0; i < o.lives.max; i++) ov.fillStyle(i < o.lives.left ? 0xfc8181 : 0x3a4150, 1).fillCircle(14 + i * 15, 66, 5);
    }

    // HUD
    this.scoreText.setText(String(me.score));
    const mult = comboMultiplier(me.combo);
    this.comboText.setText(mult > 1 ? `×${mult}` : '');
    this.distText.setText(`${Math.min(trackM, meM).toFixed(0)} / ${trackM.toFixed(0)} m`);
    this.phaseText.setText(t(this.lang, ({ chant: 'phase.run', turn: 'phase.turning', watch: 'phase.freeze', turnback: 'phase.run' } as const)[phase] as MsgKey));
    this.phaseText.setColor(phase === 'watch' ? '#fc8181' : phase === 'turn' ? '#ecc94b' : COLORS.dim);
    // 혼자 달릴 때는 순위·생존 표시가 의미 없으므로 숨긴다
    this.rankText.setVisible(cur.runners.length > 1);
    this.rankText.setText(`#${rankOf(cur, o.me)}/${cur.runners.length}\n${t(this.lang, 'hud.alive', { n: aliveCount(cur) })}`);
    this.hintText.setVisible(o.showHint === true);
    if (this.debugText && !this.debugText.text.startsWith('net')) {
      const g0 = cur.guardian;
      this.debugText.setText(
        `tick ${cur.tick}  ${g0.phase}#${g0.cycleIdx}\nvel ${toMps(me.vel).toFixed(2)} m/s  D=${g0.phaseStart + (g0.phase === 'turn' ? spec.turnTicks : 0) + SAFE_RELEASE_TICKS}\nassist +${spec.assistGraceTicks}t  turn ${spec.turnTicks}t  combo ${me.combo}`,
      );
    }
  }

  chantLen(cycleIdx: number): number {
    const arr = this.spec.chantTicks;
    return arr[cycleIdx % arr.length] ?? 1;
  }

  private drawFinish(g: Phaser.GameObjects.Graphics, y: number): void {
    if (y < -20 || y > GAME_H + 20) return;
    const cell = 12;
    const w = TRACK_RIGHT - TRACK_LEFT;
    for (let i = 0; i < w / cell; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle((i + j) % 2 === 0 ? 0xffffff : 0x222222, 1).fillRect(TRACK_LEFT + i * cell, y - 12 + j * cell, cell, cell);
      }
    }
  }

  private aheadText(i: number): Phaser.GameObjects.Text {
    let t = this.aheadTexts[i];
    if (!t) {
      t = this.scene.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: '#a0aec0' }).setOrigin(0.5, 0).setDepth(6);
      this.aheadTexts.push(t);
    }
    return t;
  }

  /** 상단 술래: 등(chant) / 회전(turn) / 정면(watch) */
  private drawGuardian(g: Phaser.GameObjects.Graphics, s: WorldState): void {
    const cx = GAME_W / 2;
    const cy = 64;
    const { phase, phaseStart, cycleIdx } = s.guardian;
    const color = phase === 'watch' ? COLORS.watch : phase === 'turn' || phase === 'turnback' ? COLORS.turn : COLORS.chant;
    const elapsed = s.tick - phaseStart;
    // 박자 펄스 (소리 없이도 템포 인지) — chant 를 5박으로 분할
    if (phase === 'chant') {
      const dur = this.chantLen(cycleIdx);
      const beat = Math.floor((elapsed * 5) / dur);
      const frac = ((elapsed * 5) % dur) / dur;
      g.lineStyle(3, COLORS.chant, 1 - frac).strokeCircle(cx, cy, 34 + frac * 22);
      for (let i = 0; i < 5; i++) g.fillStyle(i <= beat ? COLORS.chant : 0x2d3640, 1).fillCircle(cx - 40 + i * 20, 108, 4);
    }
    if (this.skins.guardian.style === 'jangseung') {
      let open = phase === 'watch' ? 1 : 0;
      if (phase === 'turn' || phase === 'turnback') {
        const k = Math.min(1, elapsed / this.spec.turnTicks);
        open = phase === 'turn' ? k : 1 - k;
      }
      drawJangseung(g, cx, cy, 34, open, color, phase === 'watch');
      return;
    }
    g.fillStyle(color, 1).fillCircle(cx, cy, 34);
    drawGuardianDeco(g, cx, cy, 34, this.skins.guardian);
    if (phase === 'watch') {
      g.fillStyle(0xffffff, 1).fillCircle(cx - 12, cy - 4, 8).fillCircle(cx + 12, cy - 4, 8);
      g.fillStyle(0x000000, 1).fillCircle(cx - 12, cy - 4, 4).fillCircle(cx + 12, cy - 4, 4);
    } else if (phase === 'turn' || phase === 'turnback') {
      const k = Math.min(1, elapsed / this.spec.turnTicks);
      const open = phase === 'turn' ? k : 1 - k;
      g.fillStyle(0xffffff, 1).fillEllipse(cx, cy - 4, 28 * open + 2, 12);
    }
  }

  /**
   * 릴리즈 타이밍 바: D−18 tick ~ D+12 tick. D 까지 Good → Great → Perfect, 이후는 빨간 영역(탈락).
   * 리플레이 중에는 플레이어가 실제로 손을 뗀 시점을 흰 삼각형으로 표시한다.
   */
  private drawTimingBar(g: Phaser.GameObjects.Graphics, s: WorldState, releaseTicks?: readonly number[]): void {
    const { phase, phaseStart } = s.guardian;
    if (phase !== 'turn' && phase !== 'watch') return;
    const ws = phase === 'turn' ? phaseStart + this.spec.turnTicks : phaseStart;
    const d = ws + SAFE_RELEASE_TICKS;
    const before = CC_GOOD_TICKS;
    const after = 12;
    const span = before + after;
    const startTick = d - before;
    const x0 = 80;
    const w = GAME_W - 160;
    const y = 140;
    const xOf = (tick: number): number => x0 + (Math.max(0, Math.min(span, tick - startTick)) / span) * w;
    const zone = (fromTick: number, toTick: number, c: number, a = 0.9): void => {
      g.fillStyle(c, a).fillRect(xOf(fromTick), y, xOf(toTick) - xOf(fromTick), 8);
    };
    zone(d - 18, d - 12, 0x2b6cb0);
    zone(d - 12, d - 6, 0x2f855a);
    zone(d - 6, d, 0xd69e2e);
    const assist = this.spec.assistGraceTicks;
    if (assist > 0) zone(d, d + assist, 0xd69e2e, 0.45);
    zone(d + assist, d + after, COLORS.watch);
    g.fillStyle(0xffffff, 0.8).fillRect(xOf(d + assist) - 1, y - 3, 2, 14);
    g.fillStyle(0xffffff, 1).fillRect(xOf(s.tick) - 1.5, y - 5, 3, 18);
    if (releaseTicks) {
      for (const tk of releaseTicks) {
        if (tk < startTick || tk > d + after) continue;
        const px = xOf(tk);
        g.fillStyle(0xffffff, 1).fillTriangle(px - 5, y + 28, px + 5, y + 28, px, y + 16);
      }
    }
  }

  private drawSpeedBar(g: Phaser.GameObjects.Graphics, vel: number): void {
    const x = 20;
    const top = 200;
    const h = 220;
    g.fillStyle(0x2d3640, 1).fillRect(x, top, 10, h);
    const fill = (vel / MAX_SPEED) * h;
    g.fillStyle(COLORS.player, 1).fillRect(x, top + h - fill, 10, fill);
    const tolY = top + h - (V_TOL / MAX_SPEED) * h;
    g.lineStyle(2, COLORS.watch, 1).lineBetween(x - 4, tolY, x + 14, tolY);
  }
}
