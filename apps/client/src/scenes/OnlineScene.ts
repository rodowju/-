import Phaser from 'phaser';
import { NetSession, parseS2C, encode, type C2S } from '@freeze/net';
import { PLAYER_ID, type SimEvent, type WorldState } from '@freeze/sim';
import { COLORS, GAME_H, GAME_W, PLAYER_Y, TRACK_CX } from '../layout';
import { t, type MsgKey } from '../logic/i18n';
import { DEFAULT_EQUIPPED, skinById, type Skin, type SkinCategory, guardianFromQuery, FIXED_GUARDIAN_ID } from '../logic/skins';
import { WorldView } from '../render/WorldView';
import { spawnStopFx } from '../render/skinDraw';
import { sfx } from '../audio/sfx';
import { track } from '../services/analytics';
import { wsUrl } from '../services/net';
import { getLang, getProgress } from '../services/storage';

interface OnlineData {
  stage?: number;
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

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';

/**
 * 실시간 대전 (서버 권위 + 롤백). 넷코드는 @freeze/net 의 NetSession 이 담당하고,
 * 이 씬은 연결·입력·표시만 한다. 싱글 전용 요소(목숨·리플레이·광고·코인)는 없다.
 */
export class OnlineScene extends Phaser.Scene {
  private stage = 1;
  private lang = getLang();
  private skins!: Record<SkinCategory, Skin>;
  private session?: NetSession;
  private ws?: WebSocket;
  private view?: WorldView;
  private prev?: WorldState;
  private status!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private btns: Btn[] = [];
  private pingTimer?: ReturnType<typeof setInterval>;
  private ended = false;
  private failed = false;
  private sentStart = false;
  /** 손가락(또는 Space)의 물리적 상태. 카운트다운 중 미리 누르고 있어도 시작과 동시에 달리게 한다 */
  private pointerDown = false;
  private lastReconcile = 0;

  constructor() {
    super('Online');
  }

  init(data: OnlineData): void {
    this.stage = data.stage ?? 1;
    this.lang = getLang();
    this.view = undefined;
    this.prev = undefined;
    this.btns = [];
    this.ended = false;
    this.failed = false;
    this.sentStart = false;
    this.pointerDown = false;
    this.lastReconcile = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#111418');
    const eq = getProgress().equipped;
    const pick = (c: SkinCategory): Skin => skinById(eq[c]) ?? (skinById(DEFAULT_EQUIPPED[c]) as Skin);
    this.skins = { character: pick('character'), trail: pick('trail'), stopfx: pick('stopfx'), guardian: guardianFromQuery(location.search) ?? (skinById(FIXED_GUARDIAN_ID) as Skin) };
    sfx.setMuted(getProgress().muted === true);

    const mono = { fontFamily: 'system-ui, sans-serif' };
    this.title = this.add.text(GAME_W / 2, 200, 'ONLINE', { ...mono, fontSize: '34px', color: COLORS.text, fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);
    this.status = this.add.text(GAME_W / 2, 250, t(this.lang, 'online.connecting'), { ...mono, fontSize: '16px', color: COLORS.dim, align: 'center' }).setOrigin(0.5, 0).setDepth(30);
    this.addButton(GAME_H - 60, t(this.lang, 'online.back'), () => this.backToSolo());

    this.connect();
    this.bindInput();
    this.events.once('shutdown', () => this.cleanup());

    (window as unknown as { __online: unknown }).__online = {
      phase: () => this.session?.phase,
      me: () => this.session?.me,
      stats: () => this.session?.stats,
      results: () => this.session?.results,
      verified: () => this.session?.endVerified,
      state: () => this.session?.world?.state,
      spec: () => this.session?.spec,
      holding: () => this.session?.holding,
      buttons: () => this.btns.map((b) => b.txt.text),
      press: (i: number) => this.btns[i]?.onClick(),
      rtt: () => this.session?.clock.rtt,
    };
  }

  // ───────── 연결 ─────────
  private connect(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.fail();
      return;
    }
    this.ws = ws;
    const session = new NetSession((m: C2S) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encode(m));
    }, () => performance.now());
    this.session = session;
    ws.onopen = () => {
      session.hello();
      // 시계 표본을 빠르게 모은 뒤 대기열 참가
      let n = 0;
      const burst = setInterval(() => {
        session.ping();
        if (++n >= 6) {
          clearInterval(burst);
          session.queue(this.stage);
        }
      }, 60);
      this.pingTimer = setInterval(() => session.ping(), 500);
    };
    ws.onmessage = (e) => {
      const m = parseS2C(typeof e.data === 'string' ? e.data : '');
      if (m) session.handle(m);
    };
    ws.onerror = () => this.fail();
    ws.onclose = () => {
      if (!this.ended) this.fail();
    };
  }

  private fail(): void {
    if (this.ended || this.failed) return;
    this.failed = true;
    this.status.setText(t(this.lang, 'online.error')).setColor('#fc8181');
  }

  private cleanup(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ended = true;
    try {
      this.ws?.close();
    } catch {
      /* 무시 */
    }
  }

  private backToSolo(): void {
    this.scene.start('Play', { stage: this.stage });
  }

  // ───────── 입력 ─────────
  private bindInput(): void {
    const onDown = (e: PointerEvent): void => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      sfx.unlock();
      const b = this.hitButton(e);
      if (b) {
        b.onClick();
        return;
      }
      this.pointerDown = true;
      this.session?.press();
    };
    const onUp = (e: PointerEvent): void => {
      if (!e.isPrimary) return;
      this.pointerDown = false;
      this.session?.release();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return;
      this.pointerDown = e.type === 'keydown';
      if (this.pointerDown) this.session?.press();
      else this.session?.release();
    };
    const onHide = (): void => {
      if (document.hidden) {
        this.pointerDown = false;
        this.session?.release();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    document.addEventListener('visibilitychange', onHide);
    this.events.once('shutdown', () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
      document.removeEventListener('visibilitychange', onHide);
    });
  }

  // ───────── 루프 ─────────
  override update(): void {
    const s = this.session;
    if (!s || this.failed) return;

    if (s.phase === 'queued') this.status.setText(t(this.lang, 'online.searching', { n: s.waiting }));

    if (s.match && s.spec && !this.view) {
      // 매치 확정: 월드 렌더러 생성, 로비 버튼 제거
      this.clearButtons();
      this.view = new WorldView(this, s.spec, this.skins, this.lang, t(this.lang, 'online.stage', { n: s.match.stage }), DEBUG);
      this.title.setVisible(false);
      this.status.setVisible(false);
    }
    const view = this.view;
    const w = s.world;
    if (!view || !w) return;

    let events: SimEvent[] = [];
    if (s.phase === 'countdown' || s.phase === 'running') events = s.update();
    // 물리 입력 상태와 넷 입력 상태를 맞춘다 (카운트다운 중 미리 누름, 서버 거부 후 복구). 폭주 방지로 100ms 간격
    if (s.phase === 'running' && this.pointerDown !== s.holding && this.time.now - this.lastReconcile > 100) {
      this.lastReconcile = this.time.now;
      if (this.pointerDown) s.press();
      else s.release();
    }
    if (s.phase === 'running' && !this.sentStart) {
      this.sentStart = true;
      track('match_start', { stage: s.match?.stage ?? 0, humans: s.match?.humans ?? 0, rttMs: Math.round(s.clock.rtt) });
    }

    const cur = w.state;
    const me = cur.runners[s.me];
    for (const e of events) this.onEvent(e, s.me);

    view.draw(cur, this.prev ?? cur, { me: s.me, alpha: 1, dim: s.phase === 'ended', showHint: s.phase === 'countdown' });
    this.prev = cur;
    if (DEBUG) view.setDebug(`net tick ${cur.tick} lead ${s.lead()} rtt ${Math.round(s.clock.rtt)}ms\nlate ${s.stats.late} desync ${s.stats.desyncs} rb ${w.rolledBackTicks}`);

    if (s.phase === 'countdown') {
      view.big.setText(String(Math.ceil(s.countdownMs() / 1000))).setColor(COLORS.text);
      view.sub.setText(t(this.lang, 'online.starting', { s: Math.ceil(s.countdownMs() / 1000) }));
    } else if (s.phase === 'running') {
      view.big.setText('');
      view.sub.setText(me && me.status === 'caught' ? `${t(this.lang, 'online.caught')}\n${t(this.lang, 'online.spectating')}` : '');
    } else if (s.phase === 'ended' && this.btns.length === 0) {
      this.showResults();
    }
  }

  private onEvent(e: SimEvent, me: number): void {
    if (e.type === 'phase') {
      if (e.phase === 'turn') {
        navigator.vibrate?.(12);
        sfx.play('turn');
      } else if (e.phase === 'watch') sfx.play('watch');
    } else if (e.type === 'closeCall' && e.runner === me) {
      const color = { perfect: COLORS.perfect, great: COLORS.great, good: COLORS.good }[e.grade];
      this.view?.popup(`${t(this.lang, `grade.${e.grade}` as MsgKey)}  +${e.points}`, color, e.multiplier > 1 ? `×${e.multiplier}` : '');
      sfx.play(e.grade);
      if (e.grade === 'perfect') spawnStopFx(this, TRACK_CX, PLAYER_Y, this.skins.stopfx);
    } else if (e.type === 'caught' && e.runner === me) {
      navigator.vibrate?.([40, 30, 80]);
      sfx.play('caught');
    } else if (e.type === 'finished' && e.runner === me) {
      sfx.play('clear');
    }
  }

  private showResults(): void {
    const s = this.session;
    const view = this.view;
    if (!s || !view || !s.results) return;
    const lang = this.lang;
    const mine = s.results.find((r) => r.runner === s.me);
    const total = s.results.length;
    const finished = mine?.status === 'finished';
    view.big.setText(t(lang, finished ? 'result.clear' : 'result.caught')).setColor(finished ? '#f6e05e' : '#fc8181');
    const humans = s.results
      .filter((r) => r.human)
      .map((r) => {
        const who = r.runner === s.me ? t(lang, 'online.you') : `P${r.runner + 1}`;
        const st = r.status === 'finished' ? `#${r.place}` : t(lang, 'online.caught');
        return `${who} ${st}`;
      })
      .join(' · ');
    const lines = [
      finished ? t(lang, 'online.place', { p: mine?.place ?? 0, n: total }) : t(lang, 'online.caught'),
      t(lang, 'clear.score', { s: mine?.score ?? 0 }),
      t(lang, 'online.humans', { list: humans }),
    ];
    if (s.stats.late > 0) lines.push('', t(lang, 'online.late', { n: s.stats.late }));
    view.sub.setText(lines.join('\n'));
    this.addButton(548, t(lang, 'online.again'), () => this.scene.restart({ stage: this.stage }), 0x553c9a);
    this.addButton(596, t(lang, 'online.back'), () => this.backToSolo());
    track('match_end', {
      stage: s.match?.stage ?? 0,
      humans: s.match?.humans ?? 0,
      place: mine?.place ?? 0,
      status: mine?.status ?? 'running',
      late: s.stats.late,
      desyncs: s.stats.desyncs,
      resyncs: s.stats.resyncs,
      rttMs: Math.round(s.clock.rtt),
      verified: s.endVerified === true,
    });
  }

  // ───────── 버튼 ─────────
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
    const txt = this.add.text(cx, cy, label, { fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: COLORS.text }).setOrigin(0.5).setDepth(36);
    this.btns.push({ x: cx, y: cy, w, h, rect, txt, onClick });
  }

  private clearButtons(): void {
    for (const b of this.btns) {
      b.rect.destroy();
      b.txt.destroy();
    }
    this.btns = [];
  }
}

// 단일 플레이 기본 러너 번호 (참조용)
export const SOLO_RUNNER = PLAYER_ID;
