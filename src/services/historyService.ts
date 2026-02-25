// 本地历史记录服务 (localStorage)
export interface HistoryRecord {
  id: string;
  prompt: string;
  model: string;
  ratio: string;
  duration: number;
  videoUrl: string;
  thumbnailUrl?: string;
  createdAt: number;
  status: 'done' | 'error';
  error?: string;
}

const LS_KEY = 'seedance_history';
const MAX_RECORDS = 50;

export function getHistory(): HistoryRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addHistory(record: HistoryRecord): void {
  const records = getHistory();
  records.unshift(record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  localStorage.setItem(LS_KEY, JSON.stringify(records));
}

export function removeHistory(id: string): void {
  const records = getHistory().filter((r) => r.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(records));
}

export function clearHistory(): void {
  localStorage.removeItem(LS_KEY);
}
