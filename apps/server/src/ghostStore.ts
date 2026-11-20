import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { GhostRecord, GhostSubmission } from '@freeze/net';

const PER_STAGE = 100;

/**
 * 고스트 저장소. 스테이지별로 완주 시간이 빠른 순 상위 N개만 유지한다.
 * 개발용으로 메모리 + (선택) JSON 파일. 운영에서는 DB 로 교체한다 (docs/ARCHITECTURE.md §6).
 */
export class GhostStore {
  private readonly byStage = new Map<number, GhostRecord[]>();
  private readonly fingerprints = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly file?: string) {
    if (file) this.load(file);
  }

  /** @returns 추가되었으면 기록과 순위(1부터, Assist 0 기준 리더보드), 중복/순위 밖이면 undefined */
  add(sub: GhostSubmission, finishTick: number, score: number): { record: GhostRecord; rank: number } | undefined {
    const fp = createHash('sha256').update(JSON.stringify([sub.stage, sub.assist, sub.inputs])).digest('hex');
    if (this.fingerprints.has(fp)) return undefined;
    const list = this.byStage.get(sub.stage) ?? [];
    const record: GhostRecord = { ...sub, id: randomUUID(), finishTick, score, createdAt: Date.now() };
    list.push(record);
    list.sort((a, b) => a.finishTick - b.finishTick || a.createdAt - b.createdAt);
    const kept = list.slice(0, PER_STAGE);
    this.byStage.set(sub.stage, kept);
    if (!kept.includes(record)) return undefined;
    this.fingerprints.add(fp);
    this.scheduleSave();
    const rank = kept.filter((r) => r.assist === 0).findIndex((r) => r.id === record.id) + 1;
    return { record, rank };
  }

  list(stage: number): readonly GhostRecord[] {
    return this.byStage.get(stage) ?? [];
  }

  /** 공식 리더보드: Assist 0 기록만 (보조를 받은 기록과 섞지 않는다) */
  leaderboard(stage: number, n = 10): { rank: number; finishTick: number; score: number }[] {
    return this.list(stage)
      .filter((r) => r.assist === 0)
      .slice(0, n)
      .map((r, i) => ({ rank: i + 1, finishTick: r.finishTick, score: r.score }));
  }

  private load(file: string): void {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, GhostRecord[]>;
      for (const [k, v] of Object.entries(data)) {
        this.byStage.set(Number(k), v);
        for (const r of v) {
          this.fingerprints.add(createHash('sha256').update(JSON.stringify([r.stage, r.assist, r.inputs])).digest('hex'));
        }
      }
    } catch {
      /* 파일 없음: 빈 상태로 시작 */
    }
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, 1000);
  }

  /** 원자적 저장 (임시 파일 → rename) */
  flush(): void {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.byStage)));
    renameSync(tmp, this.file);
  }
}
