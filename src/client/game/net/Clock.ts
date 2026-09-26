/**
 * Estimates the server clock from ping/pong samples. The estimate is the median
 * of recent offsets so a single delayed packet does not skew it.
 */
export class ServerClock {
  offset = 0;
  rtt = 0;
  private samples: { offset: number; rtt: number }[] = [];
  private initialized = false;

  /** Seed the clock from the welcome message (server time at receive). */
  seed(serverTime: number, now: number): void {
    this.offset = serverTime - now;
    this.initialized = true;
  }

  onPong(clientSent: number, serverTime: number, now: number): void {
    const rtt = now - clientSent;
    const offset = serverTime + rtt / 2 - now;
    this.samples.push({ offset, rtt });
    if (this.samples.length > 8) this.samples.shift();
    // Prefer samples with low RTT (least queueing noise).
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)];
    if (!this.initialized) {
      this.offset = median;
      this.initialized = true;
    } else {
      // Ease toward the new estimate to avoid visible jumps in interpolation.
      const diff = median - this.offset;
      this.offset += Math.abs(diff) > 250 ? diff : diff * 0.25;
    }
    this.rtt = sorted[0].rtt;
  }

  serverNow(now: number): number {
    return now + this.offset;
  }
}
