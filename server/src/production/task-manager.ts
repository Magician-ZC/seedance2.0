// 制片任务管理器 - 管理多项目并发后台任务
// 模式参考 agent-factory：内存 Map + WS 推送 + stopFlags

import { wsManager } from '../ws-manager.js';

export type ProductionStage = 'clean' | 'extract' | 'voice' | 'video' | 'full';

export interface ProductionTask {
  taskId: string;
  projectId: string;
  stage: ProductionStage;
  status: 'running' | 'done' | 'error' | 'stopped';
  progress: string;
  detail: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  error?: string;
}

class ProductionTaskManager {
  private tasks = new Map<string, ProductionTask>();
  private stopFlags = new Map<string, boolean>();
  private projectStageMap = new Map<string, string>();

  makeTaskId(projectId: string, stage: ProductionStage): string {
    return `production_${stage}_${projectId}`;
  }

  startTask(projectId: string, stage: ProductionStage, progress = ''): ProductionTask {
    const taskId = this.makeTaskId(projectId, stage);

    const existing = this.tasks.get(taskId);
    if (existing && existing.status === 'running') {
      existing.progress = progress || existing.progress;
      return existing;
    }

    const task: ProductionTask = {
      taskId,
      projectId,
      stage,
      status: 'running',
      progress: progress || `${stage} 任务已启动`,
      detail: {},
      startTime: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.stopFlags.set(taskId, false);
    this.projectStageMap.set(`${projectId}:${stage}`, taskId);
    this.broadcast(task);
    return task;
  }

  updateProgress(taskId: string, progress: string, detail?: Record<string, unknown>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.progress = progress;
    if (detail) Object.assign(task.detail, detail);
    this.broadcast(task);
  }

  completeTask(taskId: string, progress = '完成'): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'done';
    task.progress = progress;
    task.endTime = Date.now();
    this.broadcast(task);
    this.stopFlags.delete(taskId);
  }

  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'error';
    task.error = error;
    task.progress = `失败: ${error}`;
    task.endTime = Date.now();
    this.broadcast(task);
    this.stopFlags.delete(taskId);
  }

  requestStop(projectId: string, stage?: ProductionStage): void {
    if (stage) {
      const taskId = this.makeTaskId(projectId, stage);
      this.stopFlags.set(taskId, true);
    } else {
      for (const [tid, task] of this.tasks) {
        if (task.projectId === projectId && task.status === 'running') {
          this.stopFlags.set(tid, true);
        }
      }
    }
  }

  shouldStop(taskId: string): boolean {
    return this.stopFlags.get(taskId) === true;
  }

  getTask(taskId: string): ProductionTask | undefined {
    return this.tasks.get(taskId);
  }

  getProjectTask(projectId: string, stage: ProductionStage): ProductionTask | undefined {
    const taskId = this.projectStageMap.get(`${projectId}:${stage}`);
    return taskId ? this.tasks.get(taskId) : undefined;
  }

  getRunningTasks(): ProductionTask[] {
    return [...this.tasks.values()].filter(t => t.status === 'running');
  }

  getProjectTasks(projectId: string): ProductionTask[] {
    return [...this.tasks.values()].filter(t => t.projectId === projectId);
  }

  /** 服务重启时将 running 改为 stopped，避免误判 */
  resetStaleRunning(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.status = 'stopped';
        task.progress = '服务重启，任务中断';
        task.endTime = Date.now();
      }
    }
  }

  private broadcast(task: ProductionTask): void {
    wsManager.broadcastJSON(task.taskId, {
      type: 'production_task',
      taskId: task.taskId,
      projectId: task.projectId,
      stage: task.stage,
      status: task.status,
      progress: task.progress,
      detail: task.detail,
      elapsed: Math.floor((Date.now() - task.startTime) / 1000),
      error: task.error,
    });
  }
}

export const taskManager = new ProductionTaskManager();
