import { describe, it, expect, beforeEach } from 'vitest';
import { getHistory, addHistory, removeHistory, clearHistory, type HistoryRecord } from './historyService';

const mockRecord: HistoryRecord = {
  id: 'test-1',
  prompt: 'test prompt',
  model: 'seedance-2.0',
  ratio: '16:9',
  duration: 5,
  videoUrl: 'https://example.com/video.mp4',
  createdAt: Date.now(),
  status: 'done',
};

describe('historyService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return empty array when no history', () => {
    expect(getHistory()).toEqual([]);
  });

  it('should add and retrieve history', () => {
    addHistory(mockRecord);
    const records = getHistory();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('test-1');
  });

  it('should prepend new records', () => {
    addHistory(mockRecord);
    addHistory({ ...mockRecord, id: 'test-2', prompt: 'second' });
    const records = getHistory();
    expect(records[0].id).toBe('test-2');
    expect(records[1].id).toBe('test-1');
  });

  it('should remove a record by id', () => {
    addHistory(mockRecord);
    addHistory({ ...mockRecord, id: 'test-2' });
    removeHistory('test-1');
    const records = getHistory();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('test-2');
  });

  it('should clear all history', () => {
    addHistory(mockRecord);
    addHistory({ ...mockRecord, id: 'test-2' });
    clearHistory();
    expect(getHistory()).toEqual([]);
  });

  it('should limit to 50 records', () => {
    for (let i = 0; i < 55; i++) {
      addHistory({ ...mockRecord, id: `test-${i}` });
    }
    expect(getHistory()).toHaveLength(50);
  });
});
