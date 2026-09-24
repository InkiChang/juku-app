export type NetworkPriority = 'background' | 'normal' | 'foreground' | 'playback';

type QueueOptions = {
  priority?: NetworkPriority;
  signal?: AbortSignal;
  label?: string;
  minIntervalMs?: number;
};

type QueueTask<T> = {
  id: number;
  priority: number;
  host: string;
  label: string;
  signal?: AbortSignal;
  minIntervalMs: number;
  background: boolean;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const priorityValue: Record<NetworkPriority, number> = {
  background: 10,
  normal: 40,
  foreground: 70,
  playback: 100,
};

function hostOf(label: string): string {
  try { return new URL(label, window.location.href).hostname || 'same-origin'; } catch { return 'same-origin'; }
}

function abortError(): DOMException {
  return new DOMException('请求已取消', 'AbortError');
}

class NetworkScheduler {
  private readonly maxConcurrent = 4;
  private readonly maxBackgroundConcurrent = 1;
  private active = 0;
  private activeBackground = 0;
  private sequence = 0;
  private queue: QueueTask<unknown>[] = [];
  private nextAllowed = new Map<string, number>();
  private wakeTimer: number | null = null;

  enqueue<T>(run: () => Promise<T>, options: QueueOptions = {}): Promise<T> {
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    const label = options.label || 'request';
    const task: QueueTask<T> = {
      id: ++this.sequence,
      priority: priorityValue[options.priority || 'normal'],
      host: hostOf(label),
      label,
      signal,
      minIntervalMs: Math.max(0, options.minIntervalMs ?? 120),
      background: (options.priority || 'normal') === 'background',
      run,
      resolve: () => {},
      reject: () => {},
    };
    const promise = new Promise<T>((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });
    this.queue.push(task as QueueTask<unknown>);
    this.pump();
    return promise;
  }

  private pump(): void {
    if (this.active >= this.maxConcurrent || !this.queue.length) return;
    const now = Date.now();
    let selected = -1;
    let earliest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.queue.length; index += 1) {
      const task = this.queue[index];
      if (task.signal?.aborted) {
        task.reject(abortError());
        this.queue.splice(index, 1);
        index -= 1;
        continue;
      }
      const allowedAt = this.nextAllowed.get(task.host) || 0;
      if (allowedAt > now) {
        earliest = Math.min(earliest, allowedAt);
        continue;
      }
      if (task.background && this.activeBackground >= this.maxBackgroundConcurrent) continue;
      if (!task.background && this.active >= this.maxConcurrent) continue;
      if (selected < 0 || task.priority > this.queue[selected].priority || task.priority === this.queue[selected].priority && task.id < this.queue[selected].id) {
        selected = index;
      }
    }
    if (selected < 0) {
      if (Number.isFinite(earliest)) this.scheduleWake(Math.max(1, earliest - now));
      return;
    }
    const task = this.queue.splice(selected, 1)[0];
    this.active += 1;
    if (task.background) this.activeBackground += 1;
    this.nextAllowed.set(task.host, Date.now() + task.minIntervalMs);
    void task.run().then(task.resolve, task.reject).finally(() => {
      this.active -= 1;
      if (task.background) this.activeBackground -= 1;
      this.pump();
    });
    this.pump();
  }

  private scheduleWake(delay: number): void {
    if (this.wakeTimer !== null) return;
    this.wakeTimer = window.setTimeout(() => {
      this.wakeTimer = null;
      this.pump();
    }, delay);
  }
}

export const networkScheduler = new NetworkScheduler();

export function priorityForApiPath(path: string): NetworkPriority {
  if (/\/playback\//i.test(path)) return 'playback';
  if (/\/account\//i.test(path) || /\/following(?:\?|$)/i.test(path) || /\/history(?:\?|$)/i.test(path)) return 'foreground';
  if (/\/search(?:\?|$)/i.test(path) || /\/download|\/tasks/i.test(path)) return 'foreground';
  if (/[?&](?:update|status)=/i.test(path) || /[?&]cached=false/i.test(path)) return 'foreground';
  // Rankings are part of the first-screen payload. Keep them ahead of the
  // catalog hydration/background cover work, especially on native Android
  // where a large catalog JSON response can occupy the single background
  // lane for a long time.
  if (/\/rankings/i.test(path)) return 'foreground';
  if (/\/cover\//i.test(path) || /\/dramas/i.test(path)) return 'background';
  return 'normal';
}
