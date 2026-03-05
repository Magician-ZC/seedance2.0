// WebSocket 管理器 - 替代轮询，实时推送生成状态
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { WsMessage, TaskInfo } from './types.js';

class WsManager {
  private wss: WebSocketServer | null = null;
  // taskId -> Set<WebSocket>
  private subscribers = new Map<string, Set<WebSocket>>();
  // 消息缓冲：taskId -> 最近的消息列表（解决订阅竞态问题）
  private messageBuffer = new Map<string, string[]>();
  private static MAX_BUFFER_SIZE = 50;

  init(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribe' && msg.taskId) {
            this.subscribe(msg.taskId, ws);
          }
          if (msg.type === 'unsubscribe' && msg.taskId) {
            this.unsubscribe(msg.taskId, ws);
          }
        } catch { /* ignore invalid messages */ }
      });
      ws.on('close', () => {
        // 清理该连接的所有订阅
        for (const [taskId, subs] of this.subscribers) {
          subs.delete(ws);
          if (subs.size === 0) this.subscribers.delete(taskId);
        }
      });
    });
    console.log('[ws] WebSocket 服务已启动 (path: /ws)');
  }

  private subscribe(taskId: string, ws: WebSocket): void {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, new Set());
    }
    this.subscribers.get(taskId)!.add(ws);

    // 发送缓冲的历史消息，解决订阅竞态问题
    const buffered = this.messageBuffer.get(taskId);
    if (buffered && buffered.length > 0 && ws.readyState === WebSocket.OPEN) {
      for (const payload of buffered) {
        ws.send(payload);
      }
    }
  }

  private unsubscribe(taskId: string, ws: WebSocket): void {
    this.subscribers.get(taskId)?.delete(ws);
  }

  // 广播任务状态更新
  broadcast(taskId: string, task: TaskInfo): void {
    const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
    let msg: WsMessage;

    if (task.status === 'done') {
      msg = { type: 'task_done', taskId, data: { status: 'done', elapsed, result: task.result! } };
    } else if (task.status === 'error') {
      msg = { type: 'task_error', taskId, data: { status: 'error', elapsed, error: task.error! } };
    } else {
      msg = { type: 'task_progress', taskId, data: { status: 'processing', elapsed, progress: task.progress } };
    }

    const payload = JSON.stringify(msg);

    // 缓冲消息（即使还没有订阅者也要缓冲，解决竞态问题）
    if (!this.messageBuffer.has(taskId)) {
      this.messageBuffer.set(taskId, []);
    }
    const buffer = this.messageBuffer.get(taskId)!;
    buffer.push(payload);
    if (buffer.length > WsManager.MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - WsManager.MAX_BUFFER_SIZE);
    }

    // 广播给已订阅的客户端
    const subs = this.subscribers.get(taskId);
    if (subs && subs.size > 0) {
      for (const ws of subs) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    }

    // 任务完成后延迟清理订阅和缓冲
    if (task.status === 'done' || task.status === 'error') {
      setTimeout(() => {
        this.subscribers.delete(taskId);
        this.messageBuffer.delete(taskId);
      }, 10000);
    }
  }
}

export const wsManager = new WsManager();
