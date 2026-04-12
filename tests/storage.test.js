import { describe, expect, test, vi } from 'vitest';
import { createStorage } from '../extension/core/storage.js';

function createMockStorageApi(initial = {}) {
  const bucket = { ...initial };
  return {
    get: vi.fn((key, callback) => {
      callback({ [key]: bucket[key] });
    }),
    set: vi.fn((payload, callback) => {
      Object.assign(bucket, payload);
      callback();
    }),
    remove: vi.fn((key, callback) => {
      delete bucket[key];
      callback();
    }),
    bucket
  };
}

describe('storage', () => {
  test('saveState writes updatedAt timestamp', async () => {
    const storageApi = createMockStorageApi();
    const now = () => Date.parse('2026-04-11T10:00:00.000Z');
    const storage = createStorage(storageApi, { now });

    const saved = await storage.saveState({ status: 'running', rows: [] });

    expect(saved.updatedAt).toBe('2026-04-11T10:00:00.000Z');
    expect(storageApi.set).toHaveBeenCalledTimes(1);
  });

  test('getState clears and returns null when state is expired', async () => {
    const storageApi = createMockStorageApi({
      scan_state: {
        status: 'paused',
        rows: [],
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    });
    const now = () => Date.parse('2026-04-11T10:00:00.000Z');
    const storage = createStorage(storageApi, { now, retentionMs: 24 * 60 * 60 * 1000 });

    const state = await storage.getState();

    expect(state).toBeNull();
    expect(storageApi.remove).toHaveBeenCalledWith('scan_state', expect.any(Function));
  });

  test('getState keeps non-expired state', async () => {
    const storageApi = createMockStorageApi({
      scan_state: {
        status: 'paused',
        rows: [],
        updatedAt: '2026-04-11T09:30:00.000Z'
      }
    });
    const now = () => Date.parse('2026-04-11T10:00:00.000Z');
    const storage = createStorage(storageApi, { now, retentionMs: 24 * 60 * 60 * 1000 });

    const state = await storage.getState();

    expect(state).toEqual({
      status: 'paused',
      rows: [],
      updatedAt: '2026-04-11T09:30:00.000Z'
    });
    expect(storageApi.remove).not.toHaveBeenCalled();
  });
});
