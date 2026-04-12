import { fetchTextWithRetry } from './core/githubClient.js';
import { createOrchestrator } from './core/orchestrator.js';
import { extractFirstPublicEmail } from './core/patchExtractor.js';
import { createPageDriverFetch } from './core/pageDriverFetch.js';
import { parseRepoFromUrl } from './core/repoContext.js';
import { createResolver, toPatchUrl } from './core/sourceResolver.js';
import { RISK_MODE_LOW, RISK_MODE_NORMAL } from './core/settings.js';
import { createStorage } from './core/storage.js';
import {
  MSG_GET_STATE,
  MSG_PAUSE_SCAN,
  MSG_RESUME_SCAN,
  MSG_SET_COMPLIANCE_CONFIRM,
  MSG_SET_RISK_MODE,
  MSG_START_SCAN,
  MSG_START_SCAN_FROM_PAGE
} from './shared/messages.js';

async function fetchPatchText(url) {
  const result = await fetchTextWithRetry(toPatchUrl(url), 2);
  if (result.pauseReason) return { pauseReason: result.pauseReason };
  return result.text;
}

async function queryActiveTab(chromeApi) {
  const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] ?? null;
}

export function createBackground({
  chromeApi = globalThis.chrome,
  resolver = null,
  storage = createStorage(),
  fetchPatch = fetchPatchText,
  extractEmail = extractFirstPublicEmail,
  pageFetchFactory = createPageDriverFetch,
  orchestratorFactory = createOrchestrator
} = {}) {
  const pageFetch = resolver ? null : pageFetchFactory({ chromeApi });
  const runtimeResolver = resolver ?? createResolver(pageFetch);

  const state = {
    status: 'idle',
    manualPause: false,
    nextIndex: 0,
    rows: [],
    repo: null,
    reason: null,
    totalTargets: 0,
    processed: 0,
    matched: 0,
    currentContributor: null,
    riskMode: RISK_MODE_NORMAL,
    complianceConfirmEnabled: true
  };

  const shouldPause = () => (state.manualPause ? 'manual_pause' : null);
  let activeScanPromise = null;

  async function persist() {
    await storage.saveState({ ...state });
  }

  async function runScan({ owner, repo, startIndex = 0, rows = [] }) {
    state.status = 'running';
    state.repo = { owner, repo };
    state.nextIndex = startIndex;
    state.rows = [...rows];
    state.reason = null;
    state.totalTargets = 0;
    state.processed = startIndex;
    state.matched = state.rows.length;
    state.currentContributor = null;
    state.riskMode = state.riskMode === RISK_MODE_LOW ? RISK_MODE_LOW : RISK_MODE_NORMAL;
    await persist();

    let progressChain = Promise.resolve();
    const onProgress = (slice) => {
      progressChain = progressChain.then(async () => {
        state.status = slice?.status ?? state.status;
        state.reason = slice?.reason ?? state.reason;
        state.nextIndex = slice?.nextIndex ?? state.nextIndex;
        state.rows = Array.isArray(slice?.rows) ? slice.rows : state.rows;
        state.totalTargets = Number.isInteger(slice?.totalTargets) ? slice.totalTargets : state.totalTargets;
        state.processed = Number.isInteger(slice?.processed) ? slice.processed : state.processed;
        state.matched = Number.isInteger(slice?.matched) ? slice.matched : state.rows.length;
        state.currentContributor = typeof slice?.currentContributor === 'string' ? slice.currentContributor : null;
        state.riskMode = slice?.riskMode === RISK_MODE_LOW ? RISK_MODE_LOW : state.riskMode;
        await persist();
      });
    };

    const run = orchestratorFactory({ resolver: runtimeResolver, fetchPatch, extractEmail, shouldPause, onProgress });
    let result;
    try {
      result = await run({
        owner,
        repo,
        startIndex,
        rows: [...rows],
        riskMode: state.riskMode
      });
      await progressChain;
    } catch (error) {
      await progressChain;
      state.status = 'error';
      state.reason = error?.message ?? 'scan_error';
      state.nextIndex = startIndex;
      await persist();
      throw error;
    } finally {
      await pageFetch?.close?.();
    }

    state.status = result.status;
    state.rows = Array.isArray(result.rows) ? result.rows : [];
    state.nextIndex = result.nextIndex ?? 0;
    state.reason = result.reason ?? null;
    state.totalTargets = Number.isInteger(result.totalTargets) ? result.totalTargets : state.totalTargets;
    state.processed = Number.isInteger(result.processed)
      ? result.processed
      : (state.status === 'done' ? state.totalTargets : state.nextIndex);
    state.matched = Number.isInteger(result.matched) ? result.matched : state.rows.length;
    state.currentContributor = typeof result.currentContributor === 'string' ? result.currentContributor : null;
    state.riskMode = result?.riskMode === RISK_MODE_LOW ? RISK_MODE_LOW : state.riskMode;
    await persist();
    return result;
  }

  async function runExclusive(task) {
    if (activeScanPromise) {
      throw new Error('Scan already running');
    }
    const running = Promise.resolve().then(task);
    activeScanPromise = running;
    try {
      return await running;
    } finally {
      if (activeScanPromise === running) {
        activeScanPromise = null;
      }
    }
  }

  async function startFromUrl(url) {
    const parsed = parseRepoFromUrl(url);
    if (!parsed) {
      throw new Error('Unable to detect repository from URL');
    }

    return runExclusive(async () => {
      state.manualPause = false;
      return runScan({ owner: parsed.owner, repo: parsed.repo, startIndex: 0, rows: [] });
    });
  }

  async function resumeFromSaved() {
    const saved = (await storage.getState()) ?? {};
    const repo = saved.repo;
    if (!repo?.owner || !repo?.repo) {
      throw new Error('No saved scan state to resume');
    }
    if (saved.status === 'done' || saved.nextIndex == null || saved.status !== 'paused') {
      throw new Error('No paused scan found');
    }

    return runExclusive(async () => {
      state.manualPause = false;
      state.riskMode = saved?.riskMode === RISK_MODE_LOW ? RISK_MODE_LOW : RISK_MODE_NORMAL;
      return runScan({
        owner: repo.owner,
        repo: repo.repo,
        startIndex: Number.isInteger(saved.nextIndex) ? saved.nextIndex : 0,
        rows: Array.isArray(saved.rows) ? saved.rows : []
      });
    });
  }

  function onMessage(message, _sender, sendResponse) {
    (async () => {
      if (!message?.type) {
        sendResponse({ ok: false, error: 'Missing message type' });
        return;
      }

      if (message.type === MSG_GET_STATE) {
        const saved = (await storage.getState()) ?? state;
        sendResponse({
          ok: true,
          state: {
            ...saved,
            complianceConfirmEnabled: saved?.complianceConfirmEnabled !== false,
            riskMode: saved?.riskMode === RISK_MODE_LOW ? RISK_MODE_LOW : RISK_MODE_NORMAL
          }
        });
        return;
      }

      if (message.type === MSG_SET_RISK_MODE) {
        const mode = message?.mode === RISK_MODE_LOW ? RISK_MODE_LOW : RISK_MODE_NORMAL;
        state.riskMode = mode;
        await persist();
        sendResponse({ ok: true, state: { ...state } });
        return;
      }

      if (message.type === MSG_SET_COMPLIANCE_CONFIRM) {
        state.complianceConfirmEnabled = message?.enabled !== false;
        await persist();
        sendResponse({ ok: true, state: { ...state } });
        return;
      }

      if (message.type === MSG_PAUSE_SCAN) {
        state.manualPause = true;
        state.status = 'paused';
        state.reason = 'manual_pause';
        await persist();
        sendResponse({ ok: true, state: { ...state } });
        return;
      }

      if (message.type === MSG_START_SCAN_FROM_PAGE) {
        try {
          const result = await startFromUrl(message.url);
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
        return;
      }

      if (message.type === MSG_START_SCAN) {
        try {
          const tab = await queryActiveTab(chromeApi);
          const result = await startFromUrl(tab?.url);
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
        return;
      }

      if (message.type === MSG_RESUME_SCAN) {
        try {
          const result = await resumeFromSaved();
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
        return;
      }

      sendResponse({ ok: false, error: `Unhandled message: ${message.type}` });
    })();

    return true;
  }

  if (chromeApi?.runtime?.onMessage?.addListener) {
    chromeApi.runtime.onMessage.addListener(onMessage);
  }

  return { onMessage, runScan, startFromUrl, resumeFromSaved, state };
}

createBackground();
