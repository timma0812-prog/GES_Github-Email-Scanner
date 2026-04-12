import { describe, expect, test, vi } from 'vitest';
import { createBackground } from '../extension/background.js';
import {
  MSG_GET_STATE,
  MSG_PAUSE_SCAN,
  MSG_RESUME_SCAN,
  MSG_SET_COMPLIANCE_CONFIRM,
  MSG_SET_RISK_MODE,
  MSG_START_SCAN,
  MSG_START_SCAN_FROM_PAGE
} from '../extension/shared/messages.js';

function createChromeApi(activeUrl = 'https://github.com/o/r') {
  return {
    tabs: {
      query: vi.fn().mockResolvedValue([{ url: activeUrl }])
    },
    runtime: {
      onMessage: {
        addListener: vi.fn()
      }
    }
  };
}

function createDriverCapableChromeApi(activeUrl = 'https://github.com/o/r') {
  const listeners = new Set();
  const tabUrls = new Map([[1, activeUrl]]);
  let nextTabId = 100;

  return {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: activeUrl }]),
      create: vi.fn(async ({ url }) => {
        const id = nextTabId;
        nextTabId += 1;
        tabUrls.set(id, url ?? 'about:blank');
        return { id, url: tabUrls.get(id), status: 'complete' };
      }),
      update: vi.fn(async (tabId, { url }) => {
        tabUrls.set(tabId, url);
        const tab = { id: tabId, url, status: 'complete' };
        for (const listener of [...listeners]) {
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
        addListener: vi.fn((listener) => listeners.add(listener)),
        removeListener: vi.fn((listener) => listeners.delete(listener))
      }
    },
    scripting: {
      executeScript: vi.fn(async ({ target }) => {
        const url = tabUrls.get(target.tabId) ?? '';
        if (url.includes('/contributors_list?')) {
          return [{
            result: {
              html: '<a data-hovercard-type="user" href="https://github.com/alice"><img alt="@alice" /></a>'
            }
          }];
        }
        return [{
          result: {
            html: '<html><body>ok</body></html>'
          }
        }];
      })
    },
    runtime: {
      onMessage: {
        addListener: vi.fn()
      }
    }
  };
}

function sendMessage(bg, message) {
  return new Promise((resolve) => {
    bg.onMessage(message, {}, resolve);
  });
}

describe('background message flow', () => {
  test('uses message values required by API contract', () => {
    expect(MSG_START_SCAN).toBe('start');
    expect(MSG_START_SCAN_FROM_PAGE).toBe('start_from_page');
    expect(MSG_PAUSE_SCAN).toBe('pause');
    expect(MSG_RESUME_SCAN).toBe('resume');
    expect(MSG_GET_STATE).toBe('get_state');
    expect(MSG_SET_RISK_MODE).toBe('set_risk_mode');
    expect(MSG_SET_COMPLIANCE_CONFIRM).toBe('set_compliance_confirm');
  });

  test('handles START_FROM_PAGE and saves running/completed state', async () => {
    const chromeApi = createChromeApi();
    const saveState = vi.fn(async () => undefined);
    const storage = {
      getState: vi.fn(async () => null),
      saveState
    };
    const run = vi.fn(async () => ({
      status: 'done',
      reason: null,
      nextIndex: null,
      rows: [],
      totalTargets: 5,
      processed: 5,
      matched: 0,
      currentContributor: null
    }));
    const orchestratorFactory = vi.fn(() => run);

    const bg = createBackground({ chromeApi, storage, orchestratorFactory });
    const response = await sendMessage(bg, { type: MSG_START_SCAN_FROM_PAGE, url: 'https://github.com/o/r/pulls' });

    expect(response.ok).toBe(true);
    expect(orchestratorFactory).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      startIndex: 0,
      rows: [],
      riskMode: 'normal'
    });
    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState.mock.calls[0][0]).toMatchObject({
      status: 'running',
      repo: { owner: 'o', repo: 'r' },
      nextIndex: 0,
      rows: [],
      totalTargets: 0,
      processed: 0,
      matched: 0,
      currentContributor: null
    });
    expect(saveState.mock.calls[1][0]).toMatchObject({
      status: 'done',
      repo: { owner: 'o', repo: 'r' },
      nextIndex: 0,
      rows: [],
      reason: null,
      totalTargets: 5,
      processed: 5,
      matched: 0,
      currentContributor: null
    });
  });

  test('handles START by scanning active tab URL', async () => {
    const chromeApi = createChromeApi('https://github.com/acme/tools/issues');
    const storage = {
      getState: vi.fn(async () => null),
      saveState: vi.fn(async () => undefined)
    };
    const run = vi.fn(async () => ({ status: 'done', reason: null, nextIndex: null, rows: [] }));
    const orchestratorFactory = vi.fn(() => run);

    const bg = createBackground({ chromeApi, storage, orchestratorFactory });
    const response = await sendMessage(bg, { type: MSG_START_SCAN });

    expect(response.ok).toBe(true);
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(run).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'tools',
      startIndex: 0,
      rows: [],
      riskMode: 'normal'
    });
  });

  test('handles GET_STATE from persisted storage', async () => {
    const saved = {
      status: 'paused',
      manualPause: true,
      nextIndex: 3,
      rows: [{ contributor_login: 'alice', email: 'alice@example.com' }],
      repo: { owner: 'o', repo: 'r' },
      reason: 'manual_pause'
    };
    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => saved),
        saveState: vi.fn(async () => undefined)
      },
      orchestratorFactory: vi.fn(() => vi.fn(async () => ({ status: 'done', rows: [] })))
    });

    const response = await sendMessage(bg, { type: MSG_GET_STATE });
    expect(response).toEqual({
      ok: true,
      state: { ...saved, riskMode: 'normal', complianceConfirmEnabled: true }
    });
  });

  test('handles PAUSE and RESUME using persisted state', async () => {
    const getState = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'paused',
        repo: { owner: 'o', repo: 'r' },
        nextIndex: 2,
        rows: [{ contributor_login: 'alice', email: 'alice@example.com' }]
      })
      .mockResolvedValue({
        status: 'paused',
        repo: { owner: 'o', repo: 'r' },
        nextIndex: 2,
        rows: [{ contributor_login: 'alice', email: 'alice@example.com' }]
      });
    const saveState = vi.fn(async () => undefined);
    const run = vi.fn(async ({ rows }) => ({ status: 'done', reason: null, nextIndex: null, rows }));

    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: { getState, saveState },
      orchestratorFactory: vi.fn(() => run)
    });

    const pauseResponse = await sendMessage(bg, { type: MSG_PAUSE_SCAN });
    expect(pauseResponse.ok).toBe(true);
    expect(pauseResponse.state.status).toBe('paused');
    expect(pauseResponse.state.reason).toBe('manual_pause');

    const resumeResponse = await sendMessage(bg, { type: MSG_RESUME_SCAN });
    expect(resumeResponse.ok).toBe(true);
    expect(run).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      startIndex: 2,
      rows: [{ contributor_login: 'alice', email: 'alice@example.com' }],
      riskMode: 'normal'
    });
    expect(saveState).toHaveBeenCalled();
  });

  test('resume after done returns error and does not rerun scan', async () => {
    const run = vi.fn(async () => ({ status: 'done', reason: null, nextIndex: null, rows: [] }));
    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => ({
          status: 'done',
          repo: { owner: 'o', repo: 'r' },
          nextIndex: null,
          rows: []
        })),
        saveState: vi.fn(async () => undefined)
      },
      orchestratorFactory: vi.fn(() => run)
    });

    const response = await sendMessage(bg, { type: MSG_RESUME_SCAN });
    expect(response.ok).toBe(false);
    expect(response.error).toBe('No paused scan found');
    expect(run).not.toHaveBeenCalled();
  });

  test('manual pause hook pauses an in-flight START_FROM_PAGE scan', async () => {
    let releaseRun;
    const gate = new Promise((resolve) => {
      releaseRun = resolve;
    });

    const run = vi.fn(async ({ owner, repo, startIndex, rows }) => {
      await gate;
      const pauseReason = orchestratorFactory.mock.calls[0][0].shouldPause({ owner, repo, login: 'alice', index: startIndex, rows });
      if (pauseReason) {
        return { status: 'paused', reason: pauseReason, nextIndex: startIndex, rows };
      }
      return { status: 'done', reason: null, nextIndex: null, rows };
    });
    const orchestratorFactory = vi.fn(() => run);

    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => null),
        saveState: vi.fn(async () => undefined)
      },
      orchestratorFactory
    });

    const startResponsePromise = sendMessage(bg, { type: MSG_START_SCAN_FROM_PAGE, url: 'https://github.com/o/r' });
    await Promise.resolve();
    const pauseResponse = await sendMessage(bg, { type: MSG_PAUSE_SCAN });
    releaseRun();
    const startResponse = await startResponsePromise;

    expect(pauseResponse.ok).toBe(true);
    expect(startResponse.ok).toBe(true);
    expect(startResponse.result.status).toBe('paused');
    expect(startResponse.result.reason).toBe('manual_pause');
  });

  test('rejects duplicate start requests while another scan is running', async () => {
    let releaseRun;
    const gate = new Promise((resolve) => {
      releaseRun = resolve;
    });
    const run = vi.fn(async () => {
      await gate;
      return { status: 'done', reason: null, nextIndex: null, rows: [] };
    });
    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => null),
        saveState: vi.fn(async () => undefined)
      },
      orchestratorFactory: vi.fn(() => run)
    });

    const firstStartPromise = sendMessage(bg, { type: MSG_START_SCAN_FROM_PAGE, url: 'https://github.com/o/r' });
    await Promise.resolve();
    const secondStart = await sendMessage(bg, { type: MSG_START_SCAN_FROM_PAGE, url: 'https://github.com/o/r' });
    releaseRun();
    const firstStart = await firstStartPromise;

    expect(secondStart.ok).toBe(false);
    expect(secondStart.error).toBe('Scan already running');
    expect(firstStart.ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('fatal orchestrator error persists error state instead of leaving running', async () => {
    const saveState = vi.fn(async () => undefined);
    const run = vi.fn(async () => {
      throw new Error('fatal_scan_error');
    });
    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => null),
        saveState
      },
      orchestratorFactory: vi.fn(() => run)
    });

    const response = await sendMessage(bg, { type: MSG_START_SCAN_FROM_PAGE, url: 'https://github.com/o/r' });
    expect(response.ok).toBe(false);
    expect(response.error).toBe('fatal_scan_error');
    expect(saveState.mock.calls.at(-1)[0]).toMatchObject({
      status: 'error',
      reason: 'fatal_scan_error',
      repo: { owner: 'o', repo: 'r' }
    });
  });

  test('persists onProgress updates while scan is running', async () => {
    const saveState = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ status: 'done', reason: null, nextIndex: null, rows: [], totalTargets: 2, processed: 2, matched: 1 }));
    const orchestratorFactory = vi.fn((args) => {
      args.onProgress({
        status: 'running',
        reason: null,
        nextIndex: 1,
        rows: [],
        totalTargets: 2,
        processed: 1,
        matched: 0,
        currentContributor: 'alice'
      });
      return run;
    });
    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => null),
        saveState
      },
      orchestratorFactory
    });

    const response = await sendMessage(bg, { type: MSG_START_SCAN_FROM_PAGE, url: 'https://github.com/o/r' });
    expect(response.ok).toBe(true);
    expect(saveState.mock.calls.some((c) => c[0]?.processed === 1 && c[0]?.currentContributor === 'alice')).toBe(true);
  });

  test('handles SET_RISK_MODE and persists preference', async () => {
    const saveState = vi.fn(async () => undefined);
    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => null),
        saveState
      },
      orchestratorFactory: vi.fn(() => vi.fn(async () => ({ status: 'done', rows: [] })))
    });

    const response = await sendMessage(bg, { type: MSG_SET_RISK_MODE, mode: 'low' });
    expect(response.ok).toBe(true);
    expect(response.state.riskMode).toBe('low');
    expect(saveState.mock.calls.at(-1)[0]).toMatchObject({ riskMode: 'low' });
  });

  test('handles SET_COMPLIANCE_CONFIRM and persists preference', async () => {
    const saveState = vi.fn(async () => undefined);
    const bg = createBackground({
      chromeApi: createChromeApi(),
      storage: {
        getState: vi.fn(async () => null),
        saveState
      },
      orchestratorFactory: vi.fn(() => vi.fn(async () => ({ status: 'done', rows: [] })))
    });

    const response = await sendMessage(bg, { type: MSG_SET_COMPLIANCE_CONFIRM, enabled: false });
    expect(response.ok).toBe(true);
    expect(response.state.complianceConfirmEnabled).toBe(false);
    expect(saveState.mock.calls.at(-1)[0]).toMatchObject({ complianceConfirmEnabled: false });
  });

  test('runs scan with low risk mode after preference is set', async () => {
    const run = vi.fn(async () => ({ status: 'done', reason: null, nextIndex: null, rows: [] }));
    const bg = createBackground({
      chromeApi: createChromeApi('https://github.com/o/r'),
      storage: {
        getState: vi.fn(async () => null),
        saveState: vi.fn(async () => undefined)
      },
      orchestratorFactory: vi.fn(() => run)
    });

    const setMode = await sendMessage(bg, { type: MSG_SET_RISK_MODE, mode: 'low' });
    expect(setMode.ok).toBe(true);

    const start = await sendMessage(bg, { type: MSG_START_SCAN });
    expect(start.ok).toBe(true);
    expect(run).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      startIndex: 0,
      rows: [],
      riskMode: 'low'
    });
  });

  test('default resolver uses browser-driven fetch when scripting API is available', async () => {
    const chromeApi = createDriverCapableChromeApi();
    const saveState = vi.fn(async () => undefined);
    let discoveredLogins = [];
    const run = vi.fn(async ({ owner, repo }) => {
      const resolver = orchestratorFactory.mock.calls[0][0].resolver;
      discoveredLogins = await resolver.getContributors(owner, repo, 10);
      return {
        status: 'done',
        reason: null,
        nextIndex: null,
        rows: [],
        totalTargets: discoveredLogins.length,
        processed: discoveredLogins.length,
        matched: 0,
        currentContributor: null
      };
    });
    const orchestratorFactory = vi.fn(() => run);

    const bg = createBackground({
      chromeApi,
      storage: {
        getState: vi.fn(async () => null),
        saveState
      },
      orchestratorFactory
    });

    const response = await sendMessage(bg, {
      type: MSG_START_SCAN_FROM_PAGE,
      url: 'https://github.com/o/r'
    });

    expect(response.ok).toBe(true);
    expect(discoveredLogins).toEqual(['alice']);
    expect(chromeApi.tabs.create).toHaveBeenCalled();
    expect(chromeApi.tabs.update).toHaveBeenCalled();
    expect(chromeApi.scripting.executeScript).toHaveBeenCalled();
    expect(chromeApi.tabs.remove).toHaveBeenCalled();
    expect(saveState).toHaveBeenCalled();
  });
});
