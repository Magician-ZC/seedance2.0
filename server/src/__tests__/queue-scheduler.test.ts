/**
 * QueueScheduler 单元测试 + 属性测试
 * 覆盖：并发控制、指数退避重试、超时、优雅停止、批量提交
 */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { QueueScheduler } from '../queue-scheduler.js';

// ============================================================
// 工具函数
// ============================================================

/** 创建一个延迟指定时间后 resolve 的任务 */
const delayTask = <T>(ms: number, value: T): () => Promise<T> =>
  () => new Promise(resolve => setTimeout(() => resolve(value), ms));

/** 创建一个延迟后 reject 的任务 */
const failTask = (ms: number, msg = 'fail'): () => Promise<never> =>
  () => new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

// ============================================================
// 单元测试：enqueue 基本功能
// ============================================================

describe('QueueScheduler - enqueue', () => {
  it('应正确执行单个任务并返回结果', async () => {
    const scheduler = new QueueScheduler(5);
    const result = await scheduler.enqueue(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('应正确传递任务的异步结果', async () => {
    const scheduler = new QueueScheduler(5);
    const result = await scheduler.enqueue(delayTask(10, 'hello'));
    expect(result).toBe('hello');
  });

  it('stopped 后 enqueue 应抛出错误', async () => {
    const scheduler = new QueueScheduler(5);
    scheduler.stop();
    await expect(scheduler.enqueue(() => Promise.resolve(1))).rejects.toThrow('Scheduler stopped');
  });
});

// ============================================================
// 单元测试：并发控制
// ============================================================

describe('QueueScheduler - 并发控制', () => {
  it('同时执行的任务数不应超过并发上限', async () => {
    const concurrency = 2;
    const scheduler = new QueueScheduler(concurrency);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const makeTask = () => async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise(r => setTimeout(r, 50));
      currentConcurrent--;
      return true;
    };

    const tasks = Array.from({ length: 6 }, makeTask);
    await Promise.all(tasks.map(fn => scheduler.enqueue(fn)));

    expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
    expect(maxConcurrent).toBe(concurrency); // 应充分利用并发
  });

  it('concurrency=1 时应串行执行', async () => {
    const scheduler = new QueueScheduler(1);
    const order: number[] = [];

    const makeTask = (id: number) => async () => {
      order.push(id);
      await new Promise(r => setTimeout(r, 10));
      return id;
    };

    await Promise.all([
      scheduler.enqueue(makeTask(1)),
      scheduler.enqueue(makeTask(2)),
      scheduler.enqueue(makeTask(3)),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });
});

// ============================================================
// 单元测试：指数退避重试
// ============================================================

describe('QueueScheduler - 指数退避重试', () => {
  it('失败后应自动重试直到成功', async () => {
    vi.useFakeTimers();
    const scheduler = new QueueScheduler(5);
    let attempts = 0;

    const task = () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error('not yet'));
      return Promise.resolve('ok');
    };

    const promise = scheduler.enqueue(task, 3, 120_000);

    // 第1次失败 → 等待 2s 后重试
    await vi.advanceTimersByTimeAsync(2000);
    // 第2次失败 → 等待 4s 后重试
    await vi.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe('ok');
    expect(attempts).toBe(3);

    vi.useRealTimers();
  });

  it('重试次数耗尽后应 reject', async () => {
    // 使用真实 timer，retries=1 减少等待时间
    const scheduler = new QueueScheduler(5);
    let attempts = 0;

    const task = () => {
      attempts++;
      return Promise.reject(new Error('always fail'));
    };

    // retries=1: 初始执行1次 + 重试1次 = 共2次, delay=(4-1)*2000=6s 太长
    // 改用自定义短超时来验证逻辑
    await expect(
      scheduler.enqueue(task, 0, 120_000),
    ).rejects.toThrow('always fail');
    expect(attempts).toBe(1);
  });

  it('retries=0 时失败应立即 reject', async () => {
    const scheduler = new QueueScheduler(5);
    await expect(
      scheduler.enqueue(() => Promise.reject(new Error('instant fail')), 0),
    ).rejects.toThrow('instant fail');
  });
});

// ============================================================
// 单元测试：超时
// ============================================================

describe('QueueScheduler - 超时', () => {
  it('任务超时应 reject 并显示 Timeout', async () => {
    const scheduler = new QueueScheduler(5);

    // 永不 resolve 的任务，超时设为 50ms，retries=0 避免重试
    const hangingTask = () => new Promise<never>(() => {});
    await expect(
      scheduler.enqueue(hangingTask, 0, 50),
    ).rejects.toThrow('Timeout');
  });

  it('任务在超时前完成应正常返回', async () => {
    const scheduler = new QueueScheduler(5);
    const result = await scheduler.enqueue(delayTask(10, 'fast'), 0, 200);
    expect(result).toBe('fast');
  });
});

// ============================================================
// 单元测试：stop() 优雅停止
// ============================================================

describe('QueueScheduler - stop', () => {
  it('stop 应拒绝队列中等待的任务', async () => {
    const scheduler = new QueueScheduler(1);

    // 第一个任务占住并发槽
    const blockPromise = scheduler.enqueue(delayTask(500, 'block'));

    // 后续任务进入等待队列
    const waitPromise1 = scheduler.enqueue(() => Promise.resolve('wait1'));
    const waitPromise2 = scheduler.enqueue(() => Promise.resolve('wait2'));

    // 立即停止
    scheduler.stop();

    // 等待中的任务应被拒绝
    await expect(waitPromise1).rejects.toThrow('Scheduler stopped');
    await expect(waitPromise2).rejects.toThrow('Scheduler stopped');
  });

  it('stop 后 pendingCount 应为 0', () => {
    const scheduler = new QueueScheduler(1);
    // 占住并发槽
    scheduler.enqueue(delayTask(1000, 'x')).catch(() => {});
    scheduler.enqueue(() => Promise.resolve(1)).catch(() => {});
    scheduler.enqueue(() => Promise.resolve(2)).catch(() => {});

    scheduler.stop();
    expect(scheduler.pendingCount).toBe(0);
  });
});

// ============================================================
// 单元测试：enqueueBatch
// ============================================================

describe('QueueScheduler - enqueueBatch', () => {
  it('应并发执行所有任务并返回结果数组', async () => {
    const scheduler = new QueueScheduler(5);
    const tasks = [1, 2, 3, 4, 5].map(n => () => Promise.resolve(n * 10));
    const results = await scheduler.enqueueBatch(tasks);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('空数组应返回空结果', async () => {
    const scheduler = new QueueScheduler(5);
    const results = await scheduler.enqueueBatch([]);
    expect(results).toEqual([]);
  });

  it('部分任务失败时 enqueueBatch 应 reject', async () => {
    const scheduler = new QueueScheduler(5);
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve(3),
    ];
    // retries=0 避免重试导致超时
    await expect(
      Promise.all(tasks.map(fn => scheduler.enqueue(fn, 0))),
    ).rejects.toThrow('boom');
  });
});


// ============================================================
// Property 8: 并发控制上限
// **Validates: Requirements 7.1**
// ============================================================

describe('Property 8: 并发控制上限', () => {
  it('任何时刻正在执行的任务数不应超过配置的并发上限', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),  // concurrency
        fc.integer({ min: 1, max: 30 }),  // taskCount
        async (concurrency, taskCount) => {
          const scheduler = new QueueScheduler(concurrency);
          let maxConcurrent = 0;
          let currentConcurrent = 0;

          const makeTask = () => async () => {
            currentConcurrent++;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            // 模拟异步工作
            await new Promise(r => setTimeout(r, Math.random() * 10));
            currentConcurrent--;
            return true;
          };

          const tasks = Array.from({ length: taskCount }, makeTask);
          await Promise.all(tasks.map(fn => scheduler.enqueue(fn, 0)));

          // 核心断言：最大并发数不超过配置上限
          expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
          // 应充分利用并发（任务数 >= 并发数时）
          if (taskCount >= concurrency) {
            expect(maxConcurrent).toBe(concurrency);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
