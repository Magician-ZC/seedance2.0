/**
 * 并发队列调度器
 * 基于 Promise 的并发控制队列，支持指数退避重试和任务超时
 */

interface QueueTask<T> {
  fn: () => Promise<T>;
  retries: number;    // 剩余重试次数
  timeout: number;    // 超时ms
}

interface QueueItem {
  task: QueueTask<any>;
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

class QueueScheduler {
  private concurrency: number;
  private running = 0;
  private queue: QueueItem[] = [];
  private stopped = false;

  constructor(concurrency = 5) {
    this.concurrency = concurrency;
  }

  /** 入队单个任务 */
  async enqueue<T>(fn: () => Promise<T>, retries = 3, timeout = 120_000): Promise<T> {
    if (this.stopped) throw new Error('Scheduler stopped');
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task: { fn, retries, timeout }, resolve, reject });
      this.drain();
    });
  }

  /** 批量入队，返回所有结果 */
  async enqueueBatch<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(tasks.map(fn => this.enqueue(fn)));
  }

  /** 优雅停止：拒绝队列中等待的任务，不中断正在执行的任务 */
  stop(): void {
    this.stopped = true;
    for (const { reject } of this.queue) {
      reject(new Error('Scheduler stopped'));
    }
    this.queue = [];
  }

  /** 当前正在执行的任务数 */
  get runningCount(): number {
    return this.running;
  }

  /** 队列中等待的任务数 */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** 从队列中取出任务执行，直到达到并发上限或队列为空 */
  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift()!;
      this.running++;
      this.executeWithRetry(item.task, item.resolve, item.reject)
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }

  /** 带超时的任务执行，完成后自动清除 timer */
  private runWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('Timeout')); }
      }, timeout);

      fn().then(
        (val) => { if (!settled) { settled = true; clearTimeout(timer); resolve(val); } },
        (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } },
      );
    });
  }

  /** 执行任务，支持超时和指数退避重试 */
  private async executeWithRetry<T>(
    task: QueueTask<T>,
    resolve: (v: T) => void,
    reject: (e: any) => void,
  ): Promise<void> {
    try {
      const result = await this.runWithTimeout(task.fn, task.timeout);
      resolve(result);
    } catch (err) {
      if (task.retries > 0) {
        // 指数退避: 第1次重试等2s, 第2次等4s, 第3次等6s
        const delay = (4 - task.retries) * 2000;
        await new Promise(r => setTimeout(r, delay));
        task.retries--;
        return this.executeWithRetry(task, resolve, reject);
      }
      reject(err);
    }
  }
}

export { QueueScheduler };
export type { QueueTask };
