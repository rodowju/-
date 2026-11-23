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
import { COLORS, GAME_W, PLAYER_Y, TRACK_CX } from '../layout';
import { addCoins, applyClear, nextStageOf } from '../logic/progress';
import { shouldShowInterstitial } from '../logic/adPolicy';
import { t, type MsgKey } from '../logic/i18n';
import { DEFAULT_EQUIPPED, skinById, type Skin, type SkinCategory, guardianFromQuery, FIXED_GUARDIAN_ID } from '../logic/skins';
import { spawnStopFx } from '../render/skinDraw';
import { WorldView } from '../render/WorldView';
import { fetchGhost, ghostTrack, onlineAvailable, submitGhost } from '../services/net';
import { isAnalyticsEnabled } from '../services/analytics';
import { ads } from '../services/ads';
import { sfx } from '../audio/sfx';
import { summarizeFrames } from '../logic/analytics';
import { track } from '../services/analytics';
import { getLang, getProgress, saveProgress } from '../services/storage';

const STEP_MS = 1000 / TICK_HZ;
const UM_PER_M = 1_000_000;
const TICKS_TO_MS = (t: number): number => (t * 1000) / TICK_HZ;
/** µm/tick → m/s */
const toMps = (v: number): number => (v * TICK_HZ) / UM_PER_M;

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const BASE_SEED = Number(params.get('seed') ?? 20260101) >>> 0;
/** ?online=1: 시작하자마자 온라인 대전으로 (테스트·공유 링크용) */
let onlineEntry = params.get('online') === '1';

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
  /** 이 스테이지에서 광고 이어하기를 이미 썼는가 */
  revived?: boolean;
}

interface Btn {
  x: number;
  y: number;
  w: number;
  h: number;
  rect: Phaser.GameObjects.Rectangle;
  txt: Phaser.GameObjects.Text;
  onClick: () => void;
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
  private lang = getLang();
  private revived = false;
  private busy = false;
  private coinsGained = 0;
  private doubled = false;
  private unlockedSkinName = '';
  private newBestStars = false;
  private resultStars = 1;
  private btns: Btn[] = [];
  private frameDeltas: number[] = [];
  private lastBeatKey = '';
  private skins!: Record<SkinCategory, Skin>;
  /** 고스트: tick 별 위치(m) */
  private ghostPos?: Float64Array;
  private ghostFinish = 0;
  private boardRank = 0;
  /** 비동기 응답이 재시작된 씬에 섞이지 않도록 하는 실행 번호 */
  private runId = 0;

  private view!: WorldView;

  constructor() {
    super('Play');
  }

  init(data: SceneData): void {
    const urlStage = params.get('stage');
    this.stage = data.stage ?? (urlStage ? Math.max(1, Number(urlStage) | 0) : nextStageOf(getProgress()));
    this.revived = data.revived ?? false;
    this.busy = false;
    this.btns = [];
    this.lives = data.lives ?? MAX_LIVES;
    this.deaths = data.deaths ?? 0;
  }

  create(): void {
    if (onlineEntry) {
      onlineEntry = false;
      this.scene.start('Online', { stage: this.stage });
      return;
    }
    this.lang = getLang();
    const eq = getProgress().equipped;
    const pick = (c: SkinCategory): Skin =>
      skinById(eq[c]) ?? (skinById(DEFAULT_EQUIPPED[c]) as Skin);
    this.skins = { character: pick('character'), trail: pick('trail'), stopfx: pick('stopfx'), guardian: guardianFromQuery(location.search) ?? (skinById(FIXED_GUARDIAN_ID) as Skin) };
    this.coinsGained = 0;
    this.doubled = false;
    // 혼자 하기는 로봇 없이 (대표 지시 11-20: 정신없음). 로봇은 대전의 빈자리에만 쓴다.
    this.spec = { ...makeStageSpec(this.stage, BASE_SEED + this.stage * 7919, getProgress().assist), botCount: 0 };
    this.world = createWorld(this.spec);
    this.prev = this.world;
    this.initialWorld = this.world;
    const run = ++this.runId;
    this.ghostPos = undefined;
    this.ghostFinish = 0;
    this.boardRank = 0;
    if (onlineAvailable() && !params.has('seed')) {
      void fetchGhost(this.stage, this.spec.parTicks).then((g) => {
        if (!g || run !== this.runId || g.stage !== this.stage) return;
        this.ghostPos = ghostTrack(g);
        this.ghostFinish = g.finishTick;
      });
    }
    this.frameDeltas = [];
    this.lastBeatKey = '';
    sfx.setMuted(getProgress().muted === true);
    track('stage_start', { stage: this.stage, attempt: this.deaths + 1, lives: this.lives, assist: this.spec.assistGraceTicks, revived: this.revived });
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

    this.view = new WorldView(this, this.spec, this.skins, this.lang, t(this.lang, 'hud.stage', { n: this.stage }), DEBUG);

    this.bindInput();
    (window as unknown as { __freeze: unknown }).__freeze = {
      state: () => this.world,
      spec: () => this.spec,
      inputLog: () => this.inputLog,
      mode: () => this.mode,
      lives: () => this.lives,
      buttons: () => this.btns.map((b) => b.txt.text),
      press: (i: number) => this.btns[i]?.onClick(),
      progress: () => getProgress(),
      lang: () => this.lang,
      ghost: () => (this.ghostPos ? { len: this.ghostPos.length, finish: this.ghostFinish } : null),
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
      sfx.unlock();
      if (this.mode !== 'play' && this.mode !== 'replay') {
        const b = this.hitButton(e);
        if (b) {
          if (this.canAct()) b.onClick();
          return;
        }
      }
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
      if (this.canAct(500)) void this.proceed();
      return;
    }
    if (this.holding) return;
    this.holding = true;
    this.started = true;
    this.queue({ tick: this.world.tick, type: 'down' });
  }

  private canAct(lockMs = 350): boolean {
    return !this.busy && this.time.now - this.modeSince >= lockMs;
  }

  /** 결과 화면에서 다음 단계로: 클리어 시 전면 광고 정책을 확인한다 (플레이 중에는 호출되지 않는다). */
  private async proceed(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.mode === 'cleared') {
        const p = getProgress();
        const now = Date.now();
        if (shouldShowInterstitial({ sessions: p.sessions, highestStage: p.highestStage, lastInterstitialAt: p.lastInterstitialAt, now })) {
          track('ad_request', { kind: 'interstitial', placement: 'stage_end' });
          await ads.showInterstitial();
          track('ad_complete', { kind: 'interstitial', placement: 'stage_end', rewarded: false });
          saveProgress({ ...getProgress(), lastInterstitialAt: Date.now() });
        }
      }
      this.scene.restart(this.nextSceneData());
    } finally {
      this.busy = false;
    }
  }

  /** 결과 화면에서 이어질 플레이 씬 데이터 */
  private nextSceneData(): SceneData {
    if (this.mode === 'cleared') return { stage: this.stage + 1, lives: MAX_LIVES, deaths: 0 };
    if (this.mode === 'out') return { stage: this.stage, lives: MAX_LIVES, deaths: 0 };
    return { stage: this.stage, lives: this.lives, deaths: this.deaths, revived: this.revived };
  }

  private async watchRevive(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    track('ad_request', { kind: 'rewarded', placement: 'revive' });
    const ok = await ads.showRewarded();
    track('ad_complete', { kind: 'rewarded', placement: 'revive', rewarded: ok });
    this.busy = false;
    if (ok) this.scene.restart({ stage: this.stage, lives: 1, deaths: this.deaths, revived: true });
  }

  private async watchDouble(): Promise<void> {
    if (this.busy || this.doubled) return;
    this.busy = true;
    track('ad_request', { kind: 'rewarded', placement: 'double_coins' });
    const ok = await ads.showRewarded();
    track('ad_complete', { kind: 'rewarded', placement: 'double_coins', rewarded: ok });
    this.busy = false;
    if (!ok) return;
    saveProgress(addCoins(getProgress(), this.coinsGained));
    this.doubled = true;
    this.buildResultText();
    this.addResultButtons();
  }

  // ───────────────────────── 결과 화면 버튼 ─────────────────────────
  private hitButton(e: PointerEvent): Btn | undefined {
    const gx = this.scale.transformX(e.pageX);
    const gy = this.scale.transformY(e.pageY);
    return this.btns.find((b) => Math.abs(gx - b.x) <= b.w / 2 && Math.abs(gy - b.y) <= b.h / 2);
  }

  private addButton(cy: number, label: string, onClick: () => void, fill = 0x2d3640): void {
    const cx = GAME_W / 2;
    const w = 250;
    const h = 40;
    const rect = this.add.rectangle(cx, cy, w, h, fill).setStrokeStyle(1, 0x6b7686).setDepth(35);
    const txt = this.add
      .text(cx, cy, label, { fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: COLORS.text })
      .setOrigin(0.5)
      .setDepth(36);
    this.btns.push({ x: cx, y: cy, w, h, rect, txt, onClick });
  }

  private clearButtons(): void {
    for (const b of this.btns) {
      b.rect.destroy();
      b.txt.destroy();
    }
    this.btns = [];
  }

  private addResultButtons(): void {
    this.clearButtons();
    const lang = this.lang;
    if (this.mode === 'cleared' && !this.doubled) this.addButton(548, t(lang, 'ad.double'), () => void this.watchDouble(), 0x2b6cb0);
    if (this.mode === 'out' && !this.revived) this.addButton(548, t(lang, 'ad.revive'), () => void this.watchRevive(), 0x2b6cb0);
    this.addButton(596, t(lang, 'shop.open'), () => this.scene.start('Shop', { back: this.nextSceneData() }));
    if (onlineAvailable()) this.addButton(500, t(lang, 'online.start'), () => this.scene.start('Online', { stage: this.stage }), 0x553c9a);
  }

  private onRelease(): void {
    if (this.mode !== 'play' || !this.holding) return;
    this.holding = false;
    this.queue({ tick: this.world.tick, type: 'up' });
  }

  private queue(raw: InputEvent): void {
    // 같은 tick 에 down/up 이 겹치지 않도록 tick 을 엄격 증가시킨다 (고스트 서버 검증·멀티플레이와 같은 규칙)
    const last = this.inputLog[this.inputLog.length - 1];
    const ev: InputEvent = last && raw.tick <= last.tick ? { ...raw, tick: last.tick + 1 } : raw;
    this.pending.push(ev);
    this.inputLog.push(ev);
  }

  private ghostAt(tick: number): number | undefined {
    const g = this.ghostPos;
    if (!g || g.length === 0) return undefined;
    return g[Math.min(tick, g.length - 1)];
  }

  // ───────────────────────── 루프 ─────────────────────────
  override update(_time: number, delta: number): void {
    if (this.mode === 'play') {
      if (this.started && this.frameDeltas.length < 1500) this.frameDeltas.push(delta);
      this.acc += Math.min(delta, 100);
      while (this.acc >= STEP_MS && this.mode === 'play') {
        this.prev = this.world;
        this.world = step(this.world, this.spec, this.pending);
        this.pending = this.pending.filter((e) => e.tick > this.world.tick - 1);
        this.snapBuf.push(this.world);
        this.maxMult = Math.max(this.maxMult, comboMultiplier(this.world.runners[PLAYER_ID]?.combo ?? 0));
        for (const e of this.world.events) this.onEvent(e);
        this.acc -= STEP_MS;
        if (isPlayerDone(this.world)) this.finishRun();
      }
      this.beatSfx();
      this.render(this.world, this.prev, this.acc / STEP_MS);
      this.view.tag.setText('');
    } else if (this.mode === 'replay' && this.replay) {
      this.updateReplay(Math.min(delta, 100));
    } else {
      this.render(this.world, this.prev, 1, this.replay?.releaseTicks);
    }
  }

  private render(cur: WorldState, pr: WorldState, alpha: number, releaseTicks?: readonly number[]): void {
    this.view.draw(cur, pr, {
      me: PLAYER_ID,
      alpha,
      dim: this.mode === 'caught' || this.mode === 'out' || this.mode === 'cleared',
      lives: { left: this.lives, max: MAX_LIVES },
      showHint: !this.started && this.mode === 'play',
      ...(releaseTicks ? { releaseTicks } : {}),
      ...(this.ghostAt(cur.tick) !== undefined ? { ghostM: this.ghostAt(cur.tick) } : {}),
    });
  }

  /** 노래(Chant)를 5박으로 나눈 박자음. 박자는 항상 시각 펄스와 함께 제공된다. */
  private beatSfx(): void {
    const g = this.world.guardian;
    if (g.phase !== 'chant') return;
    const dur = this.view.chantLen(g.cycleIdx);
    const beat = Math.floor(((this.world.tick - g.phaseStart) * 5) / dur);
    const key = `${g.cycleIdx}:${beat}`;
    if (key !== this.lastBeatKey) {
      this.lastBeatKey = key;
      sfx.play('beat');
    }
  }

  private flushPerf(): void {
    if (this.frameDeltas.length < 30) return;
    track('perf', { stage: this.stage, ...summarizeFrames(this.frameDeltas) });
    this.frameDeltas = [];
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
    this.view.tag.setText(t(this.lang, slow ? 'replay.slow' : 'replay.playing'));
  }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'phase':
        if (e.phase === 'turn') {
          navigator.vibrate?.(12);
          sfx.play('turn');
        } else if (e.phase === 'watch') {
          sfx.play('watch');
        }
        break;
      case 'closeCall': {
        const color = { perfect: COLORS.perfect, great: COLORS.great, good: COLORS.good }[e.grade];
        this.popup(`${t(this.lang, `grade.${e.grade}` as MsgKey)}  +${e.points}`, color, e.multiplier > 1 ? `×${e.multiplier}` : '');
        sfx.play(e.grade);
        if (e.grade === 'perfect') spawnStopFx(this, TRACK_CX, PLAYER_Y, this.skins.stopfx);
        break;
      }
      case 'caught':
        if (e.runner === PLAYER_ID) {
          this.lastCaughtSpeed = e.speed;
          this.lastCatchTick = e.tick;
          navigator.vibrate?.([40, 30, 80]);
          sfx.play('caught');
        }
        break;
      case 'finished':
        if (e.runner === PLAYER_ID) sfx.play('clear');
        break;
    }
  }

  private popup(text: string, color: string, sub: string): void {
    this.view.popup(text, color, sub);
  }

  private finishRun(): void {
    const p = this.world.runners[PLAYER_ID];
    this.holding = false;
    this.modeSince = this.time.now;
    if (p?.status === 'finished') {
      this.mode = 'cleared';
      const stars = starsFor(this.spec, p.endTick, this.maxMult);
      const before = getProgress();
      const prevBest = before.stars[String(this.stage)] ?? 0;
      const res = applyClear(before, this.stage, stars);
      // 동적 Assist: 무사고면 줄이고, 고전하면 늘린다 (유저에게는 알리지 않는다)
      saveProgress({ ...res.next, assist: adjustAssist(this.spec.assistGraceTicks, { cleared: true, deaths: this.deaths }) });
      this.coinsGained = res.coins;
      track('stage_clear', {
        stage: this.stage,
        stars,
        ticks: p.endTick,
        par: this.spec.parTicks,
        place: p.place,
        total: this.world.runners.length,
        score: p.score,
        maxMult: this.maxMult,
        deaths: this.deaths,
        assist: this.spec.assistGraceTicks,
        coins: res.coins,
      });
      this.flushPerf();
      if (this.ghostFinish > 0) track('ghost', { stage: this.stage, action: 'race', diffMs: Math.round(TICKS_TO_MS(p.endTick - this.ghostFinish)) });
      if (onlineAvailable() && isAnalyticsEnabled() && !params.has('seed')) {
        const run = this.runId;
        void submitGhost(this.stage, this.spec.assistGraceTicks, this.inputLog).then((r) => {
          if (!r || run !== this.runId || this.mode !== 'cleared') return;
          if (r.stored && r.rank > 0 && this.spec.assistGraceTicks === 0) {
            this.boardRank = r.rank;
            track('ghost', { stage: this.stage, action: 'stored', rank: r.rank });
            this.buildResultText();
          }
        });
      }
      this.newBestStars = res.newBest && prevBest > 0;
      this.unlockedSkinName = res.freeSkin ? t(this.lang, (skinById(res.freeSkin)?.nameKey ?? 'skin.character.ember') as MsgKey) : '';
      this.resultStars = stars;
      this.view.big.setText(t(this.lang, 'result.clear')).setColor('#f6e05e');
      this.buildResultText();
      this.addResultButtons();
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
      const fallback = analyzeCatch(this.spec, this.inputLog, catchTick, this.world.guardian.phaseStart);
      this.trackFail(fallback, catchTick);
      this.showResult(fallback);
      return;
    }
    const analysis = analyzeCatch(this.spec, this.inputLog, catchTick, this.world.guardian.phaseStart);
    this.lives -= 1;
    this.deaths += 1;
    this.trackFail(analysis, catchTick);
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

  private trackFail(a: CatchAnalysis, catchTick: number): void {
    track('stage_fail', {
      stage: this.stage,
      cause: a.kind,
      lateMs: a.lateTicks !== undefined ? Math.round(TICKS_TO_MS(a.lateTicks)) : undefined,
      speedMps: toMps(this.lastCaughtSpeed),
      tick: catchTick,
      deaths: this.deaths,
      assist: this.spec.assistGraceTicks,
    });
    this.flushPerf();
  }

  private showResult(analysis?: CatchAnalysis): void {
    const a = analysis ?? this.replay?.analysis;
    this.view.tag.setText('');
    this.modeSince = this.time.now;
    this.mode = this.lives > 0 ? 'caught' : 'out';
    if (this.mode === 'out') {
      saveProgress({ ...getProgress(), assist: adjustAssist(this.spec.assistGraceTicks, { cleared: false, deaths: this.deaths }) });
      track('stage_out', { stage: this.stage, deaths: this.deaths, assist: this.spec.assistGraceTicks });
    }
    const lang = this.lang;
    const mps = toMps(this.lastCaughtSpeed);
    let why = '';
    if (a?.kind === 'late-release') why = t(lang, 'why.late', { ms: Math.round(TICKS_TO_MS(a.lateTicks ?? 0)) });
    else if (a?.kind === 'no-release') why = t(lang, 'why.noRelease');
    else if (a?.kind === 'pressed-in-watch') why = t(lang, 'why.pressedWatch');
    this.view.big.setText(t(lang, this.mode === 'out' ? 'result.out' : 'result.caught')).setColor('#fc8181');
    this.view.big.setFontSize(this.mode === 'out' ? 30 : 40);
    this.view.sub.setText(
      `${why}\n${t(lang, 'speed.line', { mps: mps.toFixed(2), limit: toMps(V_TOL).toFixed(2) })}\n\n${
        this.mode === 'out' ? t(lang, 'tap.restart') : `${t(lang, 'lives.left', { n: this.lives })}\n${t(lang, 'tap.retry')}`
      }`,
    );
    this.addResultButtons();
  }

  /** 클리어 화면 텍스트 (코인 2배 후에도 다시 호출) */
  private buildResultText(): void {
    const lang = this.lang;
    const stars = this.resultStars;
    const star = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    const p = this.world.runners[PLAYER_ID];
    const coins = this.doubled ? this.coinsGained * 2 : this.coinsGained;
    const lines = [
      `${star}${this.newBestStars ? `  ${t(lang, 'clear.newBest')}` : ''}`,
      '',
      t(lang, 'clear.place', { p: p?.place ?? 0, n: this.world.runners.length }),
      t(lang, 'clear.score', { s: p?.score ?? 0 }),
      t(lang, 'coins.gained', { n: coins }),
    ];
    if (this.ghostFinish > 0 && p) {
      const d = TICKS_TO_MS(p.endTick - this.ghostFinish) / 1000;
      lines.push(t(lang, 'ghost.diff', { d: `${d > 0 ? '+' : ''}${d.toFixed(2)}` }));
    }
    if (this.boardRank > 0) lines.push(t(lang, 'board.rank', { n: this.boardRank }));
    if (this.unlockedSkinName) lines.push('', t(lang, 'skin.unlocked', { name: this.unlockedSkinName }));
    lines.push('', t(lang, 'tap.next'));
    this.view.sub.setText(lines.join('\n'));
  }

}
