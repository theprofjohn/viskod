/**
 * Phase 33A — filesystem activity instrumentation.
 *
 * Counts the expensive filesystem operations performed during source
 * resolution so tests (and the Phase 33A measurements) can PROVE warm-cache
 * behaviour with read/parse counters instead of timing alone.
 *
 * Kinds:
 * - `contentRead`   — a file's CONTENT was read (readFile).
 * - `contentParse`  — file content was parsed (import parsing / text matching).
 * - `stat`          — metadata stat (size/mtime) of a file or directory.
 * - `readdir`       — directory listing.
 * - `exists`        — existence probe (existsSync/access).
 *
 * Counters are engine-scoped (one `FsActivity` per `SourceHintEngine`), not
 * process-global, so tests never observe each other's scans.
 */
export class FsActivity {
  private contentReads = 0;
  private contentParses = 0;
  private statCalls = 0;
  private readdirCalls = 0;
  private existsCalls = 0;

  record(kind: 'contentRead' | 'contentParse' | 'stat' | 'readdir' | 'exists'): void {
    switch (kind) {
      case 'contentRead':
        this.contentReads++;
        break;
      case 'contentParse':
        this.contentParses++;
        break;
      case 'stat':
        this.statCalls++;
        break;
      case 'readdir':
        this.readdirCalls++;
        break;
      case 'exists':
        this.existsCalls++;
        break;
    }
  }

  snapshot(): {
    contentReads: number;
    contentParses: number;
    statCalls: number;
    readdirCalls: number;
    existsCalls: number;
    total: number;
  } {
    return {
      contentReads: this.contentReads,
      contentParses: this.contentParses,
      statCalls: this.statCalls,
      readdirCalls: this.readdirCalls,
      existsCalls: this.existsCalls,
      total:
        this.contentReads +
        this.contentParses +
        this.statCalls +
        this.readdirCalls +
        this.existsCalls,
    };
  }

  reset(): void {
    this.contentReads = 0;
    this.contentParses = 0;
    this.statCalls = 0;
    this.readdirCalls = 0;
    this.existsCalls = 0;
  }
}

export type FsActivitySnapshot = ReturnType<FsActivity['snapshot']>;
