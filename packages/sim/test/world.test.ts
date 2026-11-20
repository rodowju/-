import { describe, expect, it } from 'vitest';
import {
  ACCEL_TICKS,
  BRAKE_TICKS,
  CLEAR_SCORE,
  MAX_SPEED,
  PLAYER_ID,
  SAFE_RELEASE_TICKS,
  createWorld,
  gradeRelease,
  guardianSchedule,
  isPlayerDone,
  makeStageSpec,
  step,
  type InputEvent,
  type StageSpec,
  type WorldState,
} from '../src';
import { deepFreeze, scriptedInputs } from './helpers';

/** 입력 목록을 tick별로 적용하며 until 직전까지 진행 */
function run(spec: StageSpec, inputs: InputEvent[], until: number): WorldState {
  let s = createWorld(spec);
  while (s.tick < until && !isPlayerDone(s)) {
    s = step(s, spec, inputs.filter((i) => i.tick === s.tick));
  }
  return s;
}

const noBots = (stage: number, seed: number): StageSpec => ({ ...makeStageSpec(stage, seed), botCount: 0 });

describe('물리', () => {
  it('홀드하면 가속하다 최대 속도에서 고정', () => {
    const spec = noBots(7, 1);
    const s = run(spec, [{ tick: 0, type: 'down' }], ACCEL_TICKS + 10);
    expect(s.runners[0]?.vel).toBe(MAX_SPEED);
  });
  it('릴리즈하면 BRAKE_TICKS 이내에 정지', () => {
    const spec = noBots(7, 1);
    const s = run(
      spec,
      [
        { tick: 0, type: 'down' },
        { tick: 80, type: 'up' },
      ],
      80 + BRAKE_TICKS,
    );
    expect(s.runners[0]?.vel).toBe(0);
  });
});

describe('판정', () => {
  const spec = noBots(7, 1); // Assist 0
  const sch = guardianSchedule(spec, 1)[0]!;
  const D = sch.watchStart + SAFE_RELEASE_TICKS;

  it('D 에 릴리즈하면 안전', () => {
    const s = run(spec, [{ tick: 0, type: 'down' }, { tick: D, type: 'up' }], sch.turnbackStart);
    expect(s.runners[0]?.status).toBe('running');
  });
  it('D+1 에 릴리즈하면 탈락', () => {
    const s = run(spec, [{ tick: 0, type: 'down' }, { tick: D + 1, type: 'up' }], sch.turnbackStart);
    expect(s.runners[0]?.status).toBe('caught');
  });
  it('Watch 중 계속 달리면 탈락 이벤트와 함께 정지', () => {
    let s = createWorld(spec);
    const evs: string[] = [];
    while (s.tick < sch.turnbackStart && !isPlayerDone(s)) {
      s = step(s, spec, s.tick === 0 ? [{ tick: 0, type: 'down' }] : []);
      for (const e of s.events) if (e.type === 'caught') evs.push(`${e.runner}@${e.tick}`);
    }
    expect(evs).toEqual([`${PLAYER_ID}@${sch.watchStart + 6}`]);
    expect(s.runners[0]?.vel).toBe(0);
  });
  it('Chant 중 정지하면 안전 (콤보 가산 없음)', () => {
    const s = run(
      spec,
      [
        { tick: 0, type: 'down' },
        { tick: 100, type: 'up' },
      ],
      sch.turnbackStart,
    );
    expect(s.runners[0]?.status).toBe('running');
    expect(s.comboPoints).toBe(0);
  });
  it('Assist 는 늦은 릴리즈를 허용한다', () => {
    const assisted = noBots(1, 1);
    const a = guardianSchedule(assisted, 1)[0]!;
    const late = a.watchStart + SAFE_RELEASE_TICKS + assisted.assistGraceTicks;
    const s = run(assisted, [{ tick: 0, type: 'down' }, { tick: late, type: 'up' }], a.turnbackStart);
    expect(s.runners[0]?.status).toBe('running');
  });
});

describe('Close Call 등급', () => {
  const spec = noBots(7, 1);
  const sch = guardianSchedule(spec, 1)[0]!;
  const D = sch.watchStart + SAFE_RELEASE_TICKS;
  const g = (tick: number) => {
    // 해당 tick 의 술래 상태를 만들어 호출
    let s = createWorld(spec);
    while (s.tick <= tick) s = step(s, spec, []);
    return s.guardian;
  };

  it('D−6 이내는 Perfect', () => {
    expect(gradeRelease(g(D), D, 0, spec.turnTicks)).toBe('perfect');
    expect(gradeRelease(g(D - 6), D - 6, 0, spec.turnTicks)).toBe('perfect');
  });
  it('D−7 ~ D−12 는 Great, D−13 ~ D−18 는 Good', () => {
    expect(gradeRelease(g(D - 7), D - 7, 0, spec.turnTicks)).toBe('great');
    expect(gradeRelease(g(D - 12), D - 12, 0, spec.turnTicks)).toBe('great');
    expect(gradeRelease(g(D - 13), D - 13, 0, spec.turnTicks)).toBe('good');
    expect(gradeRelease(g(D - 18), D - 18, 0, spec.turnTicks)).toBe('good');
  });
  it('Chant 중 릴리즈는 등급 없음', () => {
    expect(gradeRelease(g(50), 50, 0, spec.turnTicks)).toBeUndefined();
  });
  it('이벤트·점수·콤보 반영 및 탈락 시 콤보 리셋', () => {
    // 첫 사이클 Perfect, 두 번째 사이클은 늦게 풀어 탈락
    const inputs = [...scriptedInputs(spec, 0, 2)];
    const second = guardianSchedule(spec, 2)[1]!;
    inputs[3] = { tick: second.watchStart + SAFE_RELEASE_TICKS + 1, type: 'up' };
    let s = createWorld(spec);
    const grades: string[] = [];
    while (!isPlayerDone(s) && s.tick < 5000) {
      s = step(s, spec, inputs.filter((i) => i.tick === s.tick));
      for (const e of s.events) if (e.type === 'closeCall') grades.push(e.grade);
      if (s.tick === sch.turnbackStart + 1) {
        expect(s.comboPoints).toBe(4);
        expect(s.score).toBe(100);
      }
    }
    expect(grades).toEqual(['perfect']);
    expect(s.runners[0]?.status).toBe('caught');
    expect(s.comboPoints).toBe(0);
  });
});

describe('완주', () => {
  it('Stage1 을 Perfect 로 완주하면 클리어 점수 이상', () => {
    const spec = makeStageSpec(1, 5);
    let s = createWorld(spec);
    const inputs = scriptedInputs(spec, 0);
    while (!isPlayerDone(s) && s.tick < 60 * 120) {
      s = step(s, spec, inputs.filter((i) => i.tick === s.tick));
    }
    expect(s.runners[0]?.status).toBe('finished');
    expect(s.runners[0]?.place).toBe(1);
    expect(s.score).toBeGreaterThanOrEqual(CLEAR_SCORE);
  });
});

describe('봇', () => {
  it('실수 확률 0 이면 봇은 탈락하지 않는다', () => {
    const spec: StageSpec = { ...makeStageSpec(7, 3), botMistakePermille: 0 };
    let s = createWorld(spec);
    while (s.tick < 60 * 90 && s.runners.some((r, i) => i > 0 && r.status === 'running')) {
      s = step(s, spec, []);
    }
    expect(s.runners.slice(1).every((r) => r.status === 'finished')).toBe(true);
  });
  it('실수 확률 1000‰ 이면 첫 사이클에서 전원 탈락', () => {
    const spec: StageSpec = { ...makeStageSpec(7, 3), botMistakePermille: 1000 };
    let s = createWorld(spec);
    while (s.tick < 60 * 30) s = step(s, spec, []);
    expect(s.runners.slice(1).every((r) => r.status === 'caught')).toBe(true);
  });
});

describe('순수성', () => {
  it('step 은 입력 상태를 변경하지 않는다', () => {
    const spec = makeStageSpec(7, 1);
    let s = deepFreeze(createWorld(spec));
    for (let i = 0; i < 400; i++) {
      s = deepFreeze(step(s, spec, i === 0 ? [{ tick: 0, type: 'down' }] : []));
    }
    expect(s.tick).toBe(400);
  });
});
