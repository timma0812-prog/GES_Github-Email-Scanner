import { SCAN_STATE_KEY, STATE_RETENTION_MS } from './settings.js';

function callStorage(api, method, ...args) {
  if (!api || typeof api[method] !== 'function') return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    try {
      api[method](...args, (result) => {
        const err = globalThis.chrome?.runtime?.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve(result);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function isExpired(state, nowMs, retentionMs) {
  if (!state || typeof state !== 'object') return false;
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) return false;
  const updatedAtMs = Date.parse(state.updatedAt ?? '');
  if (!Number.isFinite(updatedAtMs)) return false;
  return nowMs - updatedAtMs > retentionMs;
}

export function createStorage(
  storageApi = globalThis.chrome?.storage?.local,
  { now = () => Date.now(), retentionMs = STATE_RETENTION_MS } = {}
) {
  return {
    async getState() {
      const data = await callStorage(storageApi, 'get', SCAN_STATE_KEY);
      const state = data?.[SCAN_STATE_KEY] ?? null;
      if (isExpired(state, now(), retentionMs)) {
        await callStorage(storageApi, 'remove', SCAN_STATE_KEY);
        return null;
      }
      return state;
    },

    async saveState(state) {
      const stampedState = {
        ...(state ?? {}),
        updatedAt: new Date(now()).toISOString()
      };
      await callStorage(storageApi, 'set', { [SCAN_STATE_KEY]: stampedState });
      return stampedState;
    },

    async clearState() {
      await callStorage(storageApi, 'remove', SCAN_STATE_KEY);
    }
  };
}
