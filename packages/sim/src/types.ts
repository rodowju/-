export type Tick = number;

export type InputEvent = { readonly tick: Tick; readonly type: 'down' | 'up' };

export type GuardianPhase = 'chant' | 'turn' | 'watch' | 'turnback';

export type CloseCallGrade = 'perfect' | 'great' | 'good';

export interface StageSpec {
  readonly stage: number;
  readonly seed: number;
  /** µm */
  readonly trackLength: number;
  /** 사이클별 길이(tick). 인덱스는 순환한다. */
  readonly chantTicks: readonly number[];
  readonly watchTicks: readonly number[];
  readonly botCount: number;
  /** 봇 실수 확률(‰) */
  readonly botMistakePermille: number;
  /** 플레이어 전용 추가 유예(tick) — Assist */
  readonly assistGraceTicks: number;
  /** 시간 보너스 기준(tick) */
  readonly parTicks: number;
  /** 술래 회전(경고) 길이(tick). 짧을수록 반응 시간이 줄어 어렵다. */
  readonly turnTicks: number;
}

export interface GuardianState {
  readonly phase: GuardianPhase;
  readonly phaseStart: Tick;
  readonly cycleIdx: number;
}

export type RunnerStatus = 'running' | 'caught' | 'finished';

export interface RunnerState {
  readonly id: number; // 0 = 플레이어
  readonly pos: number; // µm
  readonly vel: number; // µm/tick
  readonly holding: boolean;
  readonly status: RunnerStatus;
  /** 탈락/도착 tick, 진행 중이면 -1 */
  readonly endTick: Tick;
  /** 도착 순위(1부터), 미도착 0 */
  readonly place: number;
  /** 봇 입력 소비 포인터 */
  readonly nextInput: number;
}

export type SimEvent =
  | { readonly type: 'phase'; readonly tick: Tick; readonly phase: GuardianPhase; readonly cycleIdx: number }
  | {
      readonly type: 'closeCall';
      readonly tick: Tick;
      readonly runner: number;
      readonly grade: CloseCallGrade;
      readonly points: number;
      readonly multiplier: number;
    }
  | { readonly type: 'caught'; readonly tick: Tick; readonly runner: number; readonly speed: number }
  | { readonly type: 'finished'; readonly tick: Tick; readonly runner: number; readonly place: number };

export interface WorldState {
  /** 다음에 시뮬레이션할 tick (= 지금까지 진행한 tick 수) */
  readonly tick: Tick;
  readonly guardian: GuardianState;
  readonly runners: readonly RunnerState[];
  readonly comboPoints: number;
  readonly score: number;
  readonly finishedCount: number;
  /** 직전 step에서 발생한 이벤트 */
  readonly events: readonly SimEvent[];
}
