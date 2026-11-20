/**
 * 익명 사용 통계 (소프트런치 KPI 측정용, docs/SOFTLAUNCH.md).
 * 순수 로직만 둔다: 이벤트 스키마 검증, 큐, 페이로드 구성. 전송/저장은 services/analytics.ts.
 *
 * 원칙: 개인정보 없음(이름/이메일/자유 텍스트 금지), 무작위 설치 ID만 사용, 허용된 키와 원시 타입만 전송.
 */
export type EventName =
  | 'session_start'
  | 'stage_start'
  | 'stage_clear'
  | 'stage_fail'
  | 'stage_out'
  | 'ad_request'
  | 'ad_complete'
  | 'shop_open'
  | 'purchase'
  | 'equip'
  | 'perf'
  | 'error';

export type Prop = string | number | boolean;
export type Props = Readonly<Record<string, Prop>>;

/** 이벤트별 허용 키. 여기에 없는 키는 버린다 (실수로 민감 정보가 섞이는 것을 방지). */
export const SCHEMA: Readonly<Record<EventName, readonly string[]>> = {
  session_start: ['lang', 'dpr', 'vw', 'vh', 'touch', 'standalone', 'sessions'],
  stage_start: ['stage', 'attempt', 'lives', 'assist', 'revived'],
  stage_clear: ['stage', 'stars', 'ticks', 'par', 'place', 'total', 'score', 'maxMult', 'deaths', 'assist', 'coins'],
  stage_fail: ['stage', 'cause', 'lateMs', 'speedMps', 'tick', 'deaths', 'assist'],
  stage_out: ['stage', 'deaths', 'assist'],
  ad_request: ['kind', 'placement'],
  ad_complete: ['kind', 'placement', 'rewarded'],
  shop_open: ['from'],
  purchase: ['skin', 'price'],
  equip: ['skin'],
  perf: ['stage', 'frames', 'p50', 'p95', 'max'],
  error: ['msg', 'src'],
};

export const MAX_STRING = 80;

export interface AnalyticsEvent {
  readonly name: EventName;
  /** ms epoch */
  readonly ts: number;
  readonly props: Props;
}

/** 허용된 키/원시 타입만 남기고, 문자열은 길이 제한, 숫자는 유한값만. */
export function sanitize(name: EventName, props: Readonly<Record<string, unknown>>): Props {
  const allowed = new Set(SCHEMA[name]);
  const out: Record<string, Prop> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!allowed.has(k)) continue;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    } else if (typeof v === 'string') {
      out[k] = v.slice(0, MAX_STRING);
    }
  }
  return out;
}

/** 크기 상한이 있는 이벤트 큐 (오프라인/전송 실패 시 오래된 것부터 버림). */
export class EventQueue {
  private items: AnalyticsEvent[] = [];
  constructor(private readonly capacity = 200) {}

  push(e: AnalyticsEvent): void {
    this.items.push(e);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  get size(): number {
    return this.items.length;
  }

  peek(n: number): AnalyticsEvent[] {
    return this.items.slice(0, n);
  }

  /** 앞에서 n개를 확정 제거 (전송 성공 후 호출) */
  ack(n: number): void {
    this.items.splice(0, n);
  }

  all(): readonly AnalyticsEvent[] {
    return this.items;
  }
}

export interface Payload {
  readonly v: 1;
  readonly install: string;
  readonly session: string;
  readonly app: string;
  readonly events: readonly AnalyticsEvent[];
}

export function buildPayload(install: string, session: string, app: string, events: readonly AnalyticsEvent[]): Payload {
  return { v: 1, install, session, app, events };
}

/** 퍼센타일(0..1), 빈 배열이면 0 */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx] ?? 0;
}

/** 프레임 간격(ms) 표본 → perf 이벤트용 요약 */
export function summarizeFrames(deltas: readonly number[]): { frames: number; p50: number; p95: number; max: number } {
  const sorted = [...deltas].sort((a, b) => a - b);
  return {
    frames: sorted.length,
    p50: Math.round(percentile(sorted, 0.5) * 10) / 10,
    p95: Math.round(percentile(sorted, 0.95) * 10) / 10,
    max: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
  };
}
