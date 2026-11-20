import Phaser from 'phaser';
import {
  CC_GOOD_TICKS,
  MAX_SPEED,
  PLAYER_ID,
  SAFE_RELEASE_TICKS,
  TICK_HZ,
  TURN_TICKS,
  V_TOL,
  createWorld,
  isPlayerDone,
  makeStageSpec,
  step,
  type InputEvent,
  type SimEvent,
  type StageSpec,
  type WorldState,
} from '@freeze/sim';
import { COLORS, GAME_H, GAME_W, PLAYER_Y, PPM, TRACK_CX, TRACK_LEFT, TRACK_RIGHT } from '../layout';

const STEP_MS = 1000 / TICK_HZ;
const UM_PER_M = 1_000_000;
const TICKS_TO_MS = (t: number): number => (t * 1000) / TICK_HZ;
/** µm/tick → m/s */
const toMps = (v: number): number => (v * TICK_HZ) / UM_PER_M;

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const BASE_SEED = Number(params.get('seed') ?? 20260101) >>> 0;

type Mode = 'play' | 'caught' | 'cleared';

interface SceneData {
  stage?: number;
}

export class PlayScene extends Phaser.Scene {
  private stage = 1;
  private spec!: StageSpec;
  private world!: WorldState;
  private prev!: WorldState;
  private acc = 0;
  private mode: Mode = 'play';
  private modeSince = 0;
  private pending: InputEvent[] = [];
  private inputLog: InputEvent[] = [];
  private holding = false;
  private started = false;
  private lastCaughtSpeed = 0;

  private gfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private scoreText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private stageText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private distText!: Phaser.GameObjects.Text;
  private bigText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private debugText?: Phaser.GameObjects.Text;

  constructor() {
    super('Play');
  }

  init(data: SceneData): void {
    this.stage = data.stage ?? Math.max(1, Number(params.get('stage') ?? 1) | 0);
  }

  create(): void {
    this.spec = makeStageSpec(this.stage, BASE_SEED + this.stage * 7919);
    this.world = createWorld(this.spec);
    this.prev = this.world;
    this.acc = 0;
    this.mode = 'play';
    this.pending = [];
    this.inputLog = [];
    this.holding = false;
    this.started = false;

    this.gfx = this.add.graphics();
    this.overlay = this.add.graphics().setDepth(20);
    const mono = { fontFamily: 'system-ui, sans-serif' };
    this.scoreText = this.add.text(12, 10, '0', { ...mono, fontSize: '22px', color: COLORS.text }).setDepth(10);
    this.stageText = this.add
      .text(12, 38, `STAGE ${this.stage}`, { ...mono, fontSize: '12px', color: COLORS.dim })
      .setDepth(10);
    this.comboText = this.add
      .text(GAME_W - 12, 10, '', { ...mono, fontSize: '22px', color: COLORS.perfect })
      .setOrigin(1, 0)
      .setDepth(10);
    this.phaseText = this.add
      .text(GAME_W / 2, 118, '', { ...mono, fontSize: '13px', color: COLORS.dim })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.distText = this.add
      .text(GAME_W - 12, 38, '', { ...mono, fontSize: '12px', color: COLORS.dim })
      .setOrigin(1, 0)
      .setDepth(10);
    this.hintText = this.add
      .text(GAME_W / 2, GAME_H - 70, 'HOLD  to run\nRELEASE  to stop', {
        ...mono,
        fontSize: '18px',
        color: COLORS.text,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.bigText = this.add
      .text(GAME_W / 2, GAME_H / 2 - 40, '', { ...mono, fontSize: '40px', color: COLORS.text, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(30);
    this.subText = this.add
      .text(GAME_W / 2, GAME_H / 2 + 10, '', { ...mono, fontSize: '15px', color: COLORS.text, align: 'center' })
      .setOrigin(0.5, 0)
      .setDepth(30);
    if (DEBUG) {
      this.debugText = this.add
        .text(8, GAME_H - 80, '', { fontFamily: 'monospace', fontSize: '10px', color: '#a0aec0' })
        .setDepth(40);
    }

    this.bindInput();
    (window as unknown as { __freeze: unknown }).__freeze = {
      state: () => this.world,
      spec: () => this.spec,
      inputLog: () => this.inputLog,
      mode: () => this.mode,
    };
  }

  // ───────────────────────── 입력 ─────────────────────────
  private bindInput(): void {
    const down = (): void => this.onPress();
    const up = (): void => this.onRelease();
    this.input.on('pointerdown', down);
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      if (!e.repeat) down();
    });
    this.input.keyboard?.on('keyup-SPACE', up);
    // 포커스를 잃으면 강제로 손을 뗀다 (홀드 고착 방지)
    const onHide = (): void => {
      if (document.hidden) this.onRelease();
    };
    document.addEventListener('visibilitychange', onHide);
    this.events.once('shutdown', () => document.removeEventListener('visibilitychange', onHide));
  }

  private onPress(): void {
    if (this.mode !== 'play') {
      // 결과 화면: 입력 잠금(실수 탭 방지) 후 다음으로
      if (this.time.now - this.modeSince < 500) return;
      this.scene.restart({ stage: this.mode === 'cleared' ? this.stage + 1 : this.stage });
      return;
    }
    if (this.holding) return;
    this.holding = true;
    this.started = true;
    this.queue({ tick: this.world.tick, type: 'down' });
  }

  private onRelease(): void {
    if (this.mode !== 'play' || !this.holding) return;
    this.holding = false;
    this.queue({ tick: this.world.tick, type: 'up' });
  }

  private queue(ev: InputEvent): void {
    this.pending.push(ev);
    this.inputLog.push(ev);
  }

  // ───────────────────────── 루프 ─────────────────────────
  override update(_time: number, delta: number): void {
    if (this.mode === 'play') {
      this.acc += Math.min(delta, 100);
      while (this.acc >= STEP_MS && this.mode === 'play') {
        this.prev = this.world;
        this.world = step(this.world, this.spec, this.pending);
        this.pending = this.pending.filter((e) => e.tick > this.world.tick - 1);
        for (const e of this.world.events) this.onEvent(e);
        this.acc -= STEP_MS;
        if (isPlayerDone(this.world)) this.finishRun();
      }
    }
    this.render(this.mode === 'play' ? this.acc / STEP_MS : 1);
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'phase':
        if (e.phase === 'turn') navigator.vibrate?.(12);
        break;
      case 'closeCall': {
        const color = { perfect: COLORS.perfect, great: COLORS.great, good: COLORS.good }[e.grade];
        this.popup(`${e.grade.toUpperCase()}  +${e.points}`, color, e.multiplier > 1 ? `×${e.multiplier}` : '');
        break;
      }
      case 'caught':
        if (e.runner === PLAYER_ID) {
          this.lastCaughtSpeed = e.speed;
          navigator.vibrate?.([40, 30, 80]);
        }
        break;
      case 'finished':
        break;
    }
  }

  private popup(text: string, color: string, sub: string): void {
    const t = this.add
      .text(TRACK_CX, PLAYER_Y - 60, sub ? `${text}  ${sub}` : text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '22px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(15);
    this.tweens.add({ targets: t, y: t.y - 50, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private finishRun(): void {
    const p = this.world.runners[PLAYER_ID];
    this.modeSince = this.time.now;
    if (p?.status === 'finished') {
      this.mode = 'cleared';
      this.bigText.setText('CLEAR').setColor('#f6e05e');
      this.subText.setText(`Place ${p.place} / ${this.world.runners.length}\nScore ${this.world.score}\n\nTap for next stage`);
    } else {
      this.mode = 'caught';
      const mps = toMps(this.lastCaughtSpeed);
      this.bigText.setText('CAUGHT').setColor('#fc8181');
      this.subText.setText(
        `You moved at ${mps.toFixed(2)} m/s\n(limit ${toMps(V_TOL).toFixed(2)} m/s)\n\nTap to retry`,
      );
    }
  }

  // ───────────────────────── 렌더 ─────────────────────────
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private render(alpha: number): void {
    const g = this.gfx;
    const o = this.overlay;
    g.clear();
    o.clear();

    const cur = this.world;
    const pr = this.prev;
    const phase = cur.guardian.phase;
    const player = cur.runners[PLAYER_ID];
    const prevPlayer = pr.runners[PLAYER_ID];
    if (!player || !prevPlayer) return;
    const playerM = this.lerp(prevPlayer.pos, player.pos, alpha) / UM_PER_M;
    const trackM = this.spec.trackLength / UM_PER_M;
    const sy = (posM: number): number => PLAYER_Y - (posM - playerM) * PPM;

    // 트랙
    g.fillStyle(COLORS.track, 1).fillRect(TRACK_LEFT, 0, TRACK_RIGHT - TRACK_LEFT, GAME_H);
    g.lineStyle(2, COLORS.line, 1);
    g.lineBetween(TRACK_LEFT, 0, TRACK_LEFT, GAME_H);
    g.lineBetween(TRACK_RIGHT, 0, TRACK_RIGHT, GAME_H);
    const first = Math.floor(playerM - (GAME_H - PLAYER_Y) / PPM);
    const last = Math.ceil(playerM + PLAYER_Y / PPM);
    for (let m = Math.max(0, first); m <= Math.min(trackM, last); m += 1) {
      if (m % 5 === 0) g.lineBetween(TRACK_LEFT, sy(m), TRACK_RIGHT, sy(m));
    }
    // 시작/결승선
    g.fillStyle(0x4a5563, 1).fillRect(TRACK_LEFT, sy(0) - 2, TRACK_RIGHT - TRACK_LEFT, 4);
    this.drawFinish(g, sy(trackM));

    // 봇
    const n = cur.runners.length - 1;
    for (let i = 1; i < cur.runners.length; i++) {
      const r = cur.runners[i];
      const rp = pr.runners[i];
      if (!r || !rp) continue;
      const x = n > 1 ? TRACK_LEFT + 22 + ((i - 1) * (TRACK_RIGHT - TRACK_LEFT - 44)) / (n - 1) : TRACK_LEFT + 30;
      const y = sy(this.lerp(rp.pos, r.pos, alpha) / UM_PER_M);
      if (y < -10 || y > GAME_H + 10) continue;
      g.fillStyle(r.status === 'caught' ? COLORS.botOut : COLORS.bot, r.status === 'caught' ? 0.6 : 1);
      g.fillCircle(x, y, 6);
    }

    // 플레이어
    g.fillStyle(player.status === 'caught' ? COLORS.watch : COLORS.player, 1);
    g.fillCircle(TRACK_CX, PLAYER_Y, 11);
    g.lineStyle(2, 0x000000, 0.35).strokeCircle(TRACK_CX, PLAYER_Y, 11);

    this.drawGuardian(g, cur);
    this.drawTimingBar(g, cur);
    this.drawSpeedBar(g, player.vel);

    // Watch 중 화면 가장자리 경고
    if (phase === 'watch') {
      o.lineStyle(10, COLORS.watch, 0.55).strokeRect(0, 0, GAME_W, GAME_H);
    }
    if (this.mode !== 'play') {
      o.fillStyle(0x000000, 0.55).fillRect(0, 0, GAME_W, GAME_H);
    }

    // HUD
    this.scoreText.setText(String(cur.score));
    const mult = Math.min(5, 1 + Math.floor(cur.comboPoints / 4));
    this.comboText.setText(mult > 1 ? `×${mult}` : '');
    this.distText.setText(`${Math.min(trackM, playerM).toFixed(0)} / ${trackM.toFixed(0)} m`);
    this.phaseText.setText(
      { chant: 'RUN', turn: 'TURNING…', watch: 'FREEZE!', turnback: 'RUN' }[phase],
    );
    this.phaseText.setColor(phase === 'watch' ? '#fc8181' : phase === 'turn' ? '#ecc94b' : COLORS.dim);
    this.hintText.setVisible(!this.started && this.mode === 'play');
    if (this.debugText) {
      const g0 = cur.guardian;
      this.debugText.setText(
        `tick ${cur.tick}  ${g0.phase}#${g0.cycleIdx}\nvel ${toMps(player.vel).toFixed(2)} m/s  D=${g0.phaseStart + (g0.phase === 'turn' ? TURN_TICKS : 0) + SAFE_RELEASE_TICKS}\nassist +${this.spec.assistGraceTicks}t  combo ${cur.comboPoints}`,
      );
    }
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

  /** 상단 술래: 등(chant) / 회전(turn) / 정면(watch) */
  private drawGuardian(g: Phaser.GameObjects.Graphics, s: WorldState): void {
    const cx = GAME_W / 2;
    const cy = 64;
    const { phase, phaseStart, cycleIdx } = s.guardian;
    const color = phase === 'watch' ? COLORS.watch : phase === 'turn' ? COLORS.turn : phase === 'turnback' ? COLORS.turn : COLORS.chant;
    const elapsed = s.tick - phaseStart;

    // 박자 펄스 (소리 없이도 템포 인지) — chant 를 5박으로 분할
    if (phase === 'chant') {
      const dur = this.chantLen(cycleIdx);
      const beat = Math.floor((elapsed * 5) / dur);
      const frac = ((elapsed * 5) % dur) / dur;
      g.lineStyle(3, COLORS.chant, 1 - frac).strokeCircle(cx, cy, 34 + frac * 22);
      for (let i = 0; i < 5; i++) {
        g.fillStyle(i <= beat ? COLORS.chant : 0x2d3640, 1).fillCircle(cx - 40 + i * 20, 108, 4);
      }
    }

    g.fillStyle(color, 1).fillCircle(cx, cy, 34);
    // 얼굴: 등을 보이면 눈 없음, 회전 중 반눈, 정면이면 큰 눈
    if (phase === 'watch') {
      g.fillStyle(0xffffff, 1).fillCircle(cx - 12, cy - 4, 8).fillCircle(cx + 12, cy - 4, 8);
      g.fillStyle(0x000000, 1).fillCircle(cx - 12, cy - 4, 4).fillCircle(cx + 12, cy - 4, 4);
    } else if (phase === 'turn' || phase === 'turnback') {
      const k = Math.min(1, elapsed / TURN_TICKS);
      const open = phase === 'turn' ? k : 1 - k;
      g.fillStyle(0xffffff, 1).fillEllipse(cx, cy - 4, 28 * open + 2, 12);
    }
  }

  private chantLen(cycleIdx: number): number {
    const arr = this.spec.chantTicks;
    return arr[cycleIdx % arr.length] ?? 1;
  }

  /**
   * 릴리즈 타이밍 바: Turn 시작부터 D 까지 커서가 이동. 오른쪽일수록 Perfect.
   * 플레이어가 "언제 놓아야 보너스인지" 시각적으로 학습하게 한다.
   */
  private drawTimingBar(g: Phaser.GameObjects.Graphics, s: WorldState): void {
    const { phase, phaseStart } = s.guardian;
    if (phase !== 'turn' && phase !== 'watch') return;
    const ws = phase === 'turn' ? phaseStart + TURN_TICKS : phaseStart;
    const d = ws + SAFE_RELEASE_TICKS;
    const span = CC_GOOD_TICKS + 2; // D-18 .. D 구간
    const startTick = d - span;
    const x0 = 80;
    const w = GAME_W - 160;
    const y = 140;
    const zone = (from: number, to: number, c: number): void => {
      g.fillStyle(c, 0.9).fillRect(x0 + (from / span) * w, y, ((to - from) / span) * w, 8);
    };
    zone(0, span - 12 - 0, 0x2b6cb0); // good
    zone(span - 12, span - 6, 0x2f855a); // great
    zone(span - 6, span, 0xd69e2e); // perfect
    const t = Math.max(0, Math.min(span + 6, s.tick - startTick));
    const cx = x0 + (t / span) * w;
    g.fillStyle(0xffffff, 1).fillRect(cx - 1.5, y - 5, 3, 18);
    // D 이후(너무 늦음)는 빨간 영역
    if (s.tick > d) g.fillStyle(COLORS.watch, 0.9).fillRect(x0 + w, y, 16, 8);
  }

  private drawSpeedBar(g: Phaser.GameObjects.Graphics, vel: number): void {
    const x = 20;
    const top = 200;
    const h = 220;
    g.fillStyle(0x2d3640, 1).fillRect(x, top, 10, h);
    const fill = (vel / MAX_SPEED) * h;
    g.fillStyle(COLORS.player, 1).fillRect(x, top + h - fill, 10, fill);
    // 허용 속도 눈금
    const tolY = top + h - (V_TOL / MAX_SPEED) * h;
    g.lineStyle(2, COLORS.watch, 1).lineBetween(x - 4, tolY, x + 14, tolY);
  }
}
