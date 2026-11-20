/**
 * 서버 시계 추정 (NTP 방식). ping 을 보낸 클라이언트 시각 c0, 받은 시각 c1, 서버가 응답에 담은 시각 s 로
 * offset = s + rtt/2 - c1 을 구한다. 최근 표본 중 RTT 가 가장 작은 표본이 가장 정확하다 (큐잉 지연이 적음).
 */
export interface ClockSample {
  readonly rtt: number;
  readonly offset: number;
}

export class ClockSync {
  private samples: ClockSample[] = [];
  constructor(private readonly keep = 12) {}

  add(c0: number, c1: number, s: number): void {
    const rtt = Math.max(0, c1 - c0);
    this.samples.push({ rtt, offset: s + rtt / 2 - c1 });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get ready(): boolean {
    return this.samples.length >= 3;
  }

  get count(): number {
    return this.samples.length;
  }

  /** 서버시각 - 클라이언트시각 */
  get offset(): number {
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt)[0];
    return best?.offset ?? 0;
  }

  /** 중앙값 RTT */
  get rtt(): number {
    const s = this.samples.map((x) => x.rtt).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  }

  /** 지터: RTT 상위(90%)와 최솟값의 차이의 절반 */
  get jitter(): number {
    const s = this.samples.map((x) => x.rtt).sort((a, b) => a - b);
    if (s.length < 2) return 0;
    const p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] ?? 0;
    return (p90 - (s[0] ?? 0)) / 2;
  }

  serverNow(clientNow: number): number {
    return clientNow + this.offset;
  }
}
