import type { WorldState } from './types';

/**
 * 현재 순위(1부터). 도착자(도착 순) → 진행 중(거리 내림차순) → 탈락자(거리 내림차순).
 * 동률은 id 오름차순으로 결정한다 (결정론).
 */
export function rankOf(state: WorldState, id: number): number {
  const group = (s: string): number => (s === 'finished' ? 0 : s === 'running' ? 1 : 2);
  const order = [...state.runners].sort((a, b) => {
    const ga = group(a.status);
    const gb = group(b.status);
    if (ga !== gb) return ga - gb;
    if (a.status === 'finished') return a.place - b.place || a.id - b.id;
    return b.pos - a.pos || a.id - b.id;
  });
  return order.findIndex((r) => r.id === id) + 1;
}

/** 아직 탈락하지 않은 러너 수 (도착자 포함) */
export function aliveCount(state: WorldState): number {
  return state.runners.filter((r) => r.status !== 'caught').length;
}
