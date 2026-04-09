// 通用 Hook：监听制片后台任务进度（通过 WebSocket）
import { useState, useEffect, useCallback, useRef } from 'react';

export interface TaskProgress {
  taskId: string;
  projectId: string;
  stage: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  progress: string;
  detail: Record<string, unknown>;
  elapsed: number;
  error?: string;
}

export function useProductionTask(taskId: string | null, onComplete?: () => void) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const reset = useCallback(() => {
    setProgress(null);
    setLogs([]);
  }, []);

  useEffect(() => {
    if (!taskId) { reset(); return; }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    let closed = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', channel: taskId }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type !== 'channel_message' || msg.channel !== taskId) return;
        const raw = msg.data as Record<string, unknown>;
        if (raw.type !== 'production_task') return;
        const d = raw as unknown as TaskProgress;
        setProgress(d);
        if (d.progress) {
          setLogs(prev => {
            if (prev[prev.length - 1] === d.progress) return prev;
            return [...prev.slice(-99), d.progress];
          });
        }
        if (d.status === 'done' || d.status === 'error' || d.status === 'stopped') {
          onCompleteRef.current?.();
          setTimeout(() => { if (!closed) ws.close(); }, 2000);
        }
      } catch { /* not json */ }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      closed = true;
      if (ws.readyState <= 1) ws.close();
    };
  }, [taskId, reset]);

  return { progress, logs, reset };
}
