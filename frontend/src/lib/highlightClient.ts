export interface HighlightRequest {
  id: number;
  code: string;
  language: string;
  start: number;
  end: number;
}
export interface HighlightResponse { id: number; html: string | null }
interface Job {
  request: HighlightRequest;
  resolve: (html: string | null) => void;
}

/** One shared worker, one posted job at a time. Unmounted previews leave no queued work. */
export class HighlightClient {
  private worker: Worker | null = null;
  private active: Job | null = null;
  private queue: Job[] = [];
  private nextId = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private workTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private createWorker: () => Worker) {}

  request(input: Omit<HighlightRequest, 'id'>) {
    let job: Job;
    const promise = new Promise<string | null>((resolve) => {
      job = { request: { ...input, id: ++this.nextId }, resolve };
      this.queue.push(job);
    });
    this.pump();
    return {
      promise,
      cancel: () => {
        this.queue = this.queue.filter((queued) => queued !== job);
        if (this.active === job) {
          this.stopWorker();
          this.active = null;
        }
        job.resolve(null);
        this.pump();
      },
    };
  }

  private stopWorker() {
    clearTimeout(this.idleTimer);
    clearTimeout(this.workTimer);
    this.worker?.terminate();
    this.worker = null;
  }

  private pump() {
    clearTimeout(this.idleTimer);
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) {
      if (this.worker) this.idleTimer = setTimeout(() => this.stopWorker(), 30_000);
      return;
    }
    this.active = job;
    try {
      if (!this.worker) {
        const worker = this.createWorker();
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
          if (this.worker !== worker || this.active?.request.id !== event.data.id) return;
          clearTimeout(this.workTimer);
          this.active.resolve(event.data.html);
          this.active = null;
          this.pump();
        };
        worker.onerror = () => {
          if (this.worker !== worker) return;
          this.active?.resolve(null);
          this.active = null;
          this.stopWorker();
          this.pump();
        };
      }
      this.worker.postMessage(job.request);
      // An unusually expensive grammar must not hold up every other visible code block.
      this.workTimer = setTimeout(() => {
        if (this.active !== job) return;
        job.resolve(null);
        this.active = null;
        this.stopWorker();
        this.pump();
      }, 5_000);
    } catch {
      job.resolve(null);
      this.active = null;
      this.stopWorker();
      this.pump();
    }
  }
}

export const highlightClient = new HighlightClient(
  () => new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' }),
);
