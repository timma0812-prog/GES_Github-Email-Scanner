import { describe, expect, test, vi } from 'vitest';
import { detectPauseReason, fetchTextWithRetry, jitterDelayMs, shouldRetry } from '../extension/core/githubClient.js';

describe('githubClient', () => {
  test('jitter delay is in range', () => {
    const value = jitterDelayMs(800, 1200);
    expect(value).toBeGreaterThanOrEqual(800);
    expect(value).toBeLessThanOrEqual(1200);
  });

  test('detects pause reasons', () => {
    expect(detectPauseReason(429, '')).toBe('rate_limited');
    expect(detectPauseReason(200, 'Please verify you are human')).toBe('human_verification');
    expect(detectPauseReason(200, 'ok')).toBeNull();
    expect(detectPauseReason(200, 'octocaptcha_origin_optimization')).toBeNull();
  });

  test('shouldRetry obeys attempts and pause', () => {
    expect(shouldRetry({ attempt: 0, retries: 2, status: 500, pauseReason: null })).toBe(true);
    expect(shouldRetry({ attempt: 2, retries: 2, status: 500, pauseReason: null })).toBe(false);
    expect(shouldRetry({ attempt: 0, retries: 2, status: 500, pauseReason: 'rate_limited' })).toBe(false);
  });

  test('fetchTextWithRetry retries and returns success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'bad' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'good' });

    const original = global.fetch;
    global.fetch = fetchMock;

    try {
      const result = await fetchTextWithRetry('https://x.test', 2);
      expect(result).toMatchObject({ ok: true, status: 200, text: 'good', pauseReason: null });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://x.test', { credentials: 'include' });
    } finally {
      global.fetch = original;
    }
  });

  test('fetchTextWithRetry pauses on challenge page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'captcha challenge'
    });

    const original = global.fetch;
    global.fetch = fetchMock;

    try {
      const result = await fetchTextWithRetry('https://x.test', 2);
      expect(result.pauseReason).toBe('human_verification');
    } finally {
      global.fetch = original;
    }
  });
});
