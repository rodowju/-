import Phaser from 'phaser';
import {
  CC_GOOD_TICKS,
  MAX_SPEED,
  SnapshotBuffer,
  adjustAssist,
  aliveCount,
  analyzeCatch,
  comboMultiplier,
  hashState,
  resimulate,
  starsFor,
  type CatchAnalysis,
  PLAYER_ID,
  SAFE_RELEASE_TICKS,
  TICK_HZ,
  V_TOL,
  createWorld,
  isPlayerDone,
  makeStageSpec,
  rankOf,
  step,
  type InputEvent,
  type SimEvent,
  type StageSpec,
  type WorldState,
} from '@freeze/sim';
import { COLORS, GAME_H, GAME_W, PLAYER_Y, PPM, TRACK_CX, TRACK_LEFT, TRACK_RIGHT } from '../layout';
import { bestStars, loadAssist, nextStage, saveAssist, saveStars } from '../services/storage';

const STEP_MS = 1000 / TICK_HZ;
const UM_PER_M = 1_000_000;
const TICKS_TO_MS = (t: number): number => (t * 1000) / TICK_HZ;
/** µm/tick → m/s */
const toMps = (v: number): number => (v * TICK_HZ) / UM_PER_M;

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const BASE_SEED = Number(params.get('seed') ?? 20260101) >>> 0;

type Mode = 'play' | 'replay' | 'caught' | 'out' | 'cleared';

const MAX_LIVES = 3;
/** 탈락 리플레이: 탈락 전 3초 재생, 마지막 0.5초는 0.5배속 (GDD §5) */
const REPLAY_TICKS = 180;
const SLOWMO_TICKS = 30;
const REPLAY_HOLD_MS = 700;

interface SceneData {
  stage?: number;
  lives?: number;
  deaths?: number;
}

interface ReplayPlayback {
  states: WorldState[];
  pos: number;
  holdMs: number;
  startedAt: number;
  analysis: CatchAnalysis;
  releaseTicks: number[];
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
  private lastCatchTick = 0;
  private lives = MAX_LIVES;
  private deaths = 0;
  private maxMult = 1;
  private snapBuf!: SnapshotBuffer;
  private initialWorld!: WorldState;
  private replay?: ReplayPlayback;

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
  private tagText!: Phaser.GameObjects.Text;
  private rankText!: Phaser.GameObjects.Text;
  private debugText?: Phaser.GameObjects.Text;

  constructor() {
    super('Play');
  }

  init(data: SceneData): void {
    const urlStage = params.get('stage');
    this.stage = data.stage ?? (urlStage ? Math.max(1, Number(urlStage) | 0) : nextStage());
    this.lives = data.lives ?? MAX_LIVES;
    this.deaths = data.deaths ?? 0;
  }

  create(): void {
    this.spec = makeStageSpec(this.stage, BASE_SEED + this.stage * 7919, loadAssist());
    this.world = createWorld(this.spec);
    this.prev = this.world;
    this.initialWorld = this.world;
    this.snapBuf = new SnapshotBuffer(14, 30);
    this.snapBuf.push(this.world);
    this.replay = undefined;
    this.maxMult = 1;
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
      .text(8, 38, `STAGE ${this.stage}`, { ...mono, fontSize: '11px', color: COLORS.dim })
      .setDepth(10);
    this.tagText = this.add
      .text(GAME_W / 2, GAME_H - 40, '', { ...mono, fontSize: '16px', color: '#f6e05e', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(25);
    this.comboText = this.add
      .text(GAME_W - 12, 10, '', { ...mono, fontSize: '22px', color: COLORS.perfect })
      .setOrigin(1, 0)
      .setDepth(10);
    this.rankText = this.add
      .text(GAME_W - 6, 52, '', { ...mono, fontSize: '11px', color: COLORS.dim, align: 'right' })
      .setOrigin(1, 0)
      .setDepth(10);
    this.phaseText = this.add
      .text(GAME_W / 2, 118, '', { ...mono, fontSize: '13px', color: COLORS.dim })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.distText = this.add
      .text(GAME_W - 6, 38, '', { ...mono, fontSize: '11px', color: COLORS.dim })
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
      lives: () => this.lives,
      deaths: () => this.deaths,
      replay: () => (this.replay ? { pos: this.replay.pos, n: this.replay.states.length, analysis: this.replay.analysis } : null),
    };
  }

  // ───────────────────────── 입력 ─────────────────────────
  private bindInput(): void {
    const down = (): void => this.onPress();
    const up = (): void => this.onRelease();
    // 입력은 캔버스가 아니라 문서 전체에서 받는다: FIT 스케일의 레터박스(상하/좌우 여백)를 눌러도 동작해야 한다.
    const onPointerDown = (e: PointerEvent): void => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      down();
    };
    const onPointerUp = (e: PointerEvent): void => {
      if (!e.isPrimary) return;
      up();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    this.events.once('shutdown', () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    });
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
    if (this.mode === 'replay') {
      // 리플레이 건너뛰기 (달리던 손가락에 의한 오입력 방지로 잠금)
      if (this.time.now - (this.replay?.startedAt ?? 0) > 350) this.showResult();
      return;
    }
    if (this.mode !== 'play') {
      // 결과 화면: 입력 잠금(실수 탭 방지) 후 다음으로
      if (this.time.now - this.modeSince < 500) return;
      if (this.mode === 'cleared') this.scene.restart({ stage: this.stage + 1, lives: MAX_LIVES, deaths: 0 });
      else if (this.mode === 'out') this.scene.restart({ stage: this.stage, lives: MAX_LIVES, deaths: 0 });
      else this.scene.restart({ stage: this.stage, lives: this.lives, deaths: this.deaths });
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
        this.snapBuf.push(this.world);
        this.maxMult = Math.max(this.maxMult, comboMultiplier(this.world.comboPoints));
        for (const e of this.world.events) this.onEvent(e);
        this.acc -= STEP_MS;
        if (isPlayerDone(this.world)) this.finishRun();
      }
      this.render(this.world, this.prev, this.acc / STEP_MS);
    } else if (this.mode === 'replay' && this.replay) {
      this.updateReplay(Math.min(delta, 100));
    } else {
      this.render(this.world, this.prev, 1, this.replay?.releaseTicks);
    }
  }

  private updateReplay(delta: number): void {
    const r = this.replay;
    if (!r) return;
    const last = r.states.length - 1;
    const slow = last - r.pos <= SLOWMO_TICKS;
    r.pos = Math.min(last, r.pos + (delta / STEP_MS) * (slow ? 0.5 : 1));
    if (r.pos >= last) {
      r.holdMs += delta;
      if (r.holdMs >= REPLAY_HOLD_MS) {
        this.showResult();
        return;
      }
    }
    const i = Math.floor(r.pos);
    const a = r.states[Math.min(i, last)] ?? this.world;
    const b = r.states[Math.min(i + 1, last)] ?? a;
    this.render(b, a, i >= last ? 1 : r.pos - i, r.releaseTicks);
    this.tagText.setText(slow ? '▶ REPLAY  (slow)' : '▶ REPLAY  · tap to skip');
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
          this.lastCatchTick = e.tick;
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
    this.holding = false;
    this.modeSince = this.time.now;
    if (p?.status === 'finished') {
      this.mode = 'cleared';
      const stars = starsFor(this.spec, p.endTick, this.maxMult);
      const best = bestStars(this.stage);
      const isNew = saveStars(this.stage, stars);
      // 동적 Assist: 무사고면 줄이고, 고전하면 늘린다 (유저에게는 알리지 않는다)
      saveAssist(adjustAssist(this.spec.assistGraceTicks, { cleared: true, deaths: this.deaths }));
      const star = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);
      this.bigText.setText('CLEAR').setColor('#f6e05e');
      this.subText.setText(
        `${star(stars)}${isNew && best > 0 ? '  (new best)' : ''}\n\nPlace ${p.place} / ${this.world.runners.length}\nScore ${this.world.score}\n\nTap for next stage`,
      );
      return;
    }
    this.beginReplay();
  }

  /** 탈락 직후: 최근 3초를 입력 로그로 결정론적으로 재현해 재생한다. */
  private beginReplay(): void {
    const catchTick = this.lastCatchTick;
    const start = this.snapBuf.latestAtOrBefore(Math.max(0, catchTick - REPLAY_TICKS)) ?? this.initialWorld;
    const states = resimulate(this.spec, this.inputLog, start, catchTick + 1);
    const finalState = states[states.length - 1];
    if (!finalState || hashState(finalState) !== hashState(this.world)) {
      // 결정론이 깨진 경우: 리플레이를 건너뛰고 결과만 표시 (조용히 틀린 재생을 보여주지 않는다)
      console.error('replay desync: resimulated state differs from live state');
      this.replay = undefined;
      this.lives -= 1;
      this.deaths += 1;
      this.showResult(analyzeCatch(this.spec, this.inputLog, catchTick, this.world.guardian.phaseStart));
      return;
    }
    const analysis = analyzeCatch(this.spec, this.inputLog, catchTick, this.world.guardian.phaseStart);
    this.lives -= 1;
    this.deaths += 1;
    this.replay = {
      states,
      pos: 0,
      holdMs: 0,
      startedAt: this.time.now,
      analysis,
      releaseTicks: this.inputLog.filter((e) => e.type === 'up').map((e) => e.tick),
    };
    this.mode = 'replay';
  }

  private showResult(analysis?: CatchAnalysis): void {
    const a = analysis ?? this.replay?.analysis;
    this.tagText.setText('');
    this.modeSince = this.time.now;
    this.mode = this.lives > 0 ? 'caught' : 'out';
    if (this.mode === 'out') saveAssist(adjustAssist(this.spec.assistGraceTicks, { cleared: false, deaths: this.deaths }));
    const mps = toMps(this.lastCaughtSpeed);
    let why = '';
    if (a?.kind === 'late-release') {
      why = `You released ${Math.round(TICKS_TO_MS(a.lateTicks ?? 0))} ms too late`;
    } else if (a?.kind === 'no-release') {
      why = 'You were still holding when FREEZE began';
    } else if (a?.kind === 'pressed-in-watch') {
      why = 'You started moving during FREEZE';
    }
    this.bigText.setText(this.mode === 'out' ? 'OUT OF LIVES' : 'CAUGHT').setColor('#fc8181');
    this.bigText.setFontSize(this.mode === 'out' ? 30 : 40);
    this.subText.setText(
      `${why}\n${mps.toFixed(2)} m/s  (limit ${toMps(V_TOL).toFixed(2)} m/s)\n\n${
        this.mode === 'out' ? 'Tap to restart the stage' : `Lives left: ${this.lives}\nTap to retry`
      }`,
    );
  }

  // ───────────────────────── 렌더 ─────────────────────────
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private render(cur: WorldState, pr: WorldState, alpha: number, releaseTicks?: number[]): void {
    const g = this.gfx;
    const o = this.overlay;
    g.clear();
    o.clear();

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
    this.drawTimingBar(g, cur, releaseTicks);
    this.drawSpeedBar(g, player.vel);

    // Watch 중 화면 가장자리 경고
    if (phase === 'watch') {
      o.lineStyle(10, COLORS.watch, 0.55).strokeRect(0, 0, GAME_W, GAME_H);
    }
    if (this.mode === 'caught' || this.mode === 'out' || this.mode === 'cleared') {
      o.fillStyle(0x000000, 0.55).fillRect(0, 0, GAME_W, GAME_H);
    }
    // 목숨
    for (let i = 0; i < MAX_LIVES; i++) {
      o.fillStyle(i < this.lives ? 0xfc8181 : 0x3a4150, 1).fillCircle(14 + i * 15, 66, 5);
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
    this.rankText.setText(`#${rankOf(cur, PLAYER_ID)}/${cur.runners.length}\n${aliveCount(cur)} alive`);
    this.hintText.setVisible(!this.started && this.mode === 'play');
    if (this.mode === 'play') this.tagText.setText('');
    if (this.debugText) {
      const g0 = cur.guardian;
      this.debugText.setText(
        `tick ${cur.tick}  ${g0.phase}#${g0.cycleIdx}\nvel ${toMps(player.vel).toFixed(2)} m/s  D=${g0.phaseStart + (g0.phase === 'turn' ? this.spec.turnTicks : 0) + SAFE_RELEASE_TICKS}\nassist +${this.spec.assistGraceTicks}t  turn ${this.spec.turnTicks}t  combo ${cur.comboPoints}`,
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
      const k = Math.min(1, elapsed / this.spec.turnTicks);
      const open = phase === 'turn' ? k : 1 - k;
      g.fillStyle(0xffffff, 1).fillEllipse(cx, cy - 4, 28 * open + 2, 12);
    }
  }

  private chantLen(cycleIdx: number): number {
    const arr = this.spec.chantTicks;
    return arr[cycleIdx % arr.length] ?? 1;
  }

  /**
   * 릴리즈 타이밍 바: D−18 tick ~ D+12 tick. D 까지 Good → Great → Perfect, 이후는 빨간 영역(탈락).
   * 리플레이 중에는 플레이어가 실제로 손을 뗀 시점을 흰 삼각형으로 표시한다.
   */
  private drawTimingBar(g: Phaser.GameObjects.Graphics, s: WorldState, releaseTicks?: number[]): void {
    const { phase, phaseStart } = s.guardian;
    if (phase !== 'turn' && phase !== 'watch') return;
    const ws = phase === 'turn' ? phaseStart + this.spec.turnTicks : phaseStart;
    const d = ws + SAFE_RELEASE_TICKS;
    const before = CC_GOOD_TICKS; // 18
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
    zone(d - 18, d - 12, 0x2b6cb0); // good
    zone(d - 12, d - 6, 0x2f855a); // great
    zone(d - 6, d, 0xd69e2e); // perfect
    const assist = this.spec.assistGraceTicks;
    if (assist > 0) zone(d, d + assist, 0xd69e2e, 0.45); // Assist 로 허용되는 늦은 구간
    zone(d + assist, d + after, COLORS.watch);
    g.fillStyle(0xffffff, 0.8).fillRect(xOf(d + assist) - 1, y - 3, 2, 14); // 마감선
    g.fillStyle(0xffffff, 1).fillRect(xOf(s.tick) - 1.5, y - 5, 3, 18);
    if (releaseTicks) {
      for (const t of releaseTicks) {
        if (t < startTick || t > d + after) continue;
        const px = xOf(t);
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
    // 허용 속도 눈금
    const tolY = top + h - (V_TOL / MAX_SPEED) * h;
    g.lineStyle(2, COLORS.watch, 1).lineBetween(x - 4, tolY, x + 14, tolY);
  }
}
