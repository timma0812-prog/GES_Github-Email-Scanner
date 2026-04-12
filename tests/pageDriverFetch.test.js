import { describe, expect, test, vi } from 'vitest';
import { createPageDriverFetch } from '../extension/core/pageDriverFetch.js';

function createDriverChrome() {
  const updateListeners = new Set();
  const tabUrls = new Map();
  let nextTabId = 100;

  const tabs = {
    create: vi.fn(async ({ url }) => {
      const id = nextTabId;
      nextTabId += 1;
      tabUrls.set(id, url ?? 'about:blank');
      return { id, url: tabUrls.get(id), status: 'complete' };
    }),
    update: vi.fn(async (tabId, { url }) => {
      tabUrls.set(tabId, url);
      const tab = { id: tabId, url, status: 'complete' };
      for (const listener of [...updateListeners]) {
        listener(tabId, { status: 'complete' }, tab);
      }
      return tab;
    }),
    get: vi.fn(async (tabId) => {
      if (!tabUrls.has(tabId)) {
        throw new Error('No tab');
      }
      return { id: tabId, url: tabUrls.get(tabId), status: 'complete' };
    }),
    remove: vi.fn(async (tabId) => {
      tabUrls.delete(tabId);
    }),
    onUpdated: {
      addListener: vi.fn((listener) => {
        updateListeners.add(listener);
      }),
      removeListener: vi.fn((listener) => {
        updateListeners.delete(listener);
      })
    }
  };

  const scripting = {
    executeScript: vi.fn(async ({ target }) => {
      const url = tabUrls.get(target.tabId) ?? '';
      return [{
        result: {
          html: `<html><body>${url}</body></html>`,
          href: url
        }
      }];
    })
  };

  return {
    tabs,
    scripting
  };
}

describe('pageDriverFetch', () => {
  test('loads github page via hidden tab and reads DOM html', async () => {
    const chromeApi = createDriverChrome();
    const fallbackFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'fallback'
    }));
    const fetchPage = createPageDriverFetch({
      chromeApi,
      fallbackFetch,
      settleMs: 0,
      timeoutMs: 2000
    });

    const response = await fetchPage('https://github.com/o/r/contributors_list?current_repository=r&deferred=true');
    const html = await response.text();

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(html).toContain('/contributors_list?current_repository=r&deferred=true');
    expect(chromeApi.tabs.create).toHaveBeenCalledWith({ url: 'about:blank', active: false });
    expect(chromeApi.tabs.update).toHaveBeenCalled();
    expect(chromeApi.scripting.executeScript).toHaveBeenCalled();
    const executeArgs = chromeApi.scripting.executeScript.mock.calls[0][0];
    expect(executeArgs.world).not.toBe('MAIN');
    expect(fallbackFetch).not.toHaveBeenCalled();

    await fetchPage.close();
    expect(chromeApi.tabs.remove).toHaveBeenCalled();
  });

  test('falls back to normal fetch for non-github urls', async () => {
    const chromeApi = createDriverChrome();
    const fallbackFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'patch-text'
    }));
    const fetchPage = createPageDriverFetch({
      chromeApi,
      fallbackFetch,
      settleMs: 0,
      timeoutMs: 2000
    });

    const response = await fetchPage('https://patch-diff.githubusercontent.com/raw/o/r/pull/1.patch');
    const text = await response.text();

    expect(text).toBe('patch-text');
    expect(fallbackFetch).toHaveBeenCalledTimes(1);
    expect(chromeApi.tabs.update).not.toHaveBeenCalled();
  });

  test('falls back to normal fetch when driver flow errors', async () => {
    const chromeApi = createDriverChrome();
    chromeApi.scripting.executeScript.mockRejectedValue(new Error('driver_failed'));

    const fallbackFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'fallback-html'
    }));

    const fetchPage = createPageDriverFetch({
      chromeApi,
      fallbackFetch,
      settleMs: 0,
      timeoutMs: 2000
    });

    const response = await fetchPage('https://github.com/o/r/pulls?q=is%3Apr%20author%3Aalice');
    const text = await response.text();

    expect(text).toBe('fallback-html');
    expect(fallbackFetch).toHaveBeenCalledWith(
      'https://github.com/o/r/pulls?q=is%3Apr%20author%3Aalice',
      expect.objectContaining({ credentials: 'include' })
    );
  });
});
