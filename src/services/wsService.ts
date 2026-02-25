// WebSocket 客户端服务 - 替代轮询
type WsCallback = (msg: WsMessage) => void;

export interface WsMessage {
  type: 'task_progress' | 'task_done' | 'task_error';
  taskId: string;
  data: {
    status: string;
    progress?: string;
    elapsed?: number;
    result?: { created: number; data: Array<{ url: string; revised_prompt: string }> };
    error?: string;
  };
}

class WsService {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<WsCallback>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${window.location.host}/ws`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          const callbacks = this.listeners.get(msg.taskId);
          if (callbacks) callbacks.forEach((cb) => cb(msg));
        } catch { /* ignore */ }
      };
      this.ws.onclose = () => {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };
      this.ws.onerror = () => { /* will trigger onclose */ };
    } catch { /* ignore */ }
  }

  subscribe(taskId: string, callback: WsCallback): () => void {
    this.connect();
    if (!this.listeners.has(taskId)) this.listeners.set(taskId, new Set());
    this.listeners.get(taskId)!.add(callback);

    // 发送订阅消息
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    } else {
      // 等连接建立后再发
      const checkInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'subscribe', taskId }));
          clearInterval(checkInterval);
        }
      }, 200);
      setTimeout(() => clearInterval(checkInterval), 10000);
    }

    return () => {
      this.listeners.get(taskId)?.delete(callback);
      if (this.listeners.get(taskId)?.size === 0) this.listeners.delete(taskId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'unsubscribe', taskId }));
      }
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export const wsService = new WsService();
