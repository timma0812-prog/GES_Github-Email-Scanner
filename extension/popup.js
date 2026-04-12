import { serializeRows } from './core/csv.js';
import { RISK_MODE_LOW, RISK_MODE_NORMAL } from './core/settings.js';
import {
  MSG_GET_STATE,
  MSG_PAUSE_SCAN,
  MSG_RESUME_SCAN,
  MSG_SET_COMPLIANCE_CONFIRM,
  MSG_SET_RISK_MODE,
  MSG_START_SCAN
} from './shared/messages.js';

export const POLL_INTERVAL_MS = 1000;

function pad(num) {
  return String(num).padStart(2, '0');
}

export function formatTimestamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function buildCsvFilename(repo, date = new Date()) {
  const owner = repo?.owner?.trim();
  const name = repo?.repo?.trim();
  const prefix = owner && name ? `${owner}_${name}` : 'github_repo';
  return `${prefix}_emails_${formatTimestamp(date)}.csv`;
}

function sendMessage(chromeApi, message) {
  return new Promise((resolve) => {
    if (typeof chromeApi?.runtime?.sendMessage !== 'function') {
      resolve({ ok: false, error: 'runtime_unavailable' });
      return;
    }
    chromeApi.runtime.sendMessage(message, (response) => resolve(response ?? { ok: false }));
  });
}

function setText(documentRef, selector, text) {
  const element = documentRef.querySelector(selector);
  if (element) {
    element.textContent = text;
  }
}

function renderRows(documentRef, rows) {
  const tbody = documentRef.querySelector('#results-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const row of rows) {
    const tr = documentRef.createElement('tr');
    const cells = [
      row?.contributor_login ?? '',
      row?.email ?? '',
      row?.source_type ?? '',
      row?.source_url ?? '',
      row?.extracted_at ?? ''
    ];
    for (const value of cells) {
      const td = documentRef.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    tbody.append(tr);
  }
}

const COMPLIANCE_CONFIRM_TEXT = '请确认仅用于合规、合法、非骚扰场景，并遵守 GitHub 条款。是否继续启动扫描？';

function shouldRequireComplianceConfirm(state) {
  return state?.complianceConfirmEnabled !== false;
}

function askComplianceConfirm(windowRef = globalThis) {
  if (typeof windowRef?.confirm !== 'function') return true;
  return windowRef.confirm(COMPLIANCE_CONFIRM_TEXT);
}

export function createPopupController({
  chromeApi = globalThis.chrome,
  documentRef = document,
  now = () => new Date(),
  urlApi = URL,
  windowRef = globalThis
} = {}) {
  let currentState = {
    status: 'idle',
    nextIndex: 0,
    rows: [],
    repo: null,
    totalTargets: 0,
    processed: 0,
    matched: 0,
    currentContributor: null,
    riskMode: RISK_MODE_NORMAL,
    complianceConfirmEnabled: true
  };
  let pollTimer = null;

  function toZhStatus(status) {
    const map = {
      idle: '空闲',
      running: '扫描中',
      paused: '暂停',
      done: '已完成',
      error: '错误'
    };
    return map[status] ?? String(status ?? '空闲');
  }

  function toZhReason(reason) {
    const map = {
      manual_pause: '手动暂停',
      rate_limited: '触发频率限制',
      rate_limit_429: '触发频率限制（429）',
      human_verification: '触发人机验证',
      challenge_detected: '触发人机验证',
      no_paused_scan_found: '没有可继续的暂停任务',
      cancelled_by_user: '你取消了本次启动'
    };
    if (!reason) return '无';
    return map[reason] ?? reason;
  }

  function toZhRiskMode(mode) {
    return mode === RISK_MODE_LOW ? '低风控' : '标准';
  }

  function syncPolling(status) {
    const running = status === 'running';
    if (running && !pollTimer) {
      pollTimer = setInterval(() => {
        void refreshState();
      }, POLL_INTERVAL_MS);
    }
    if (!running && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function render(state) {
    const rows = Array.isArray(state?.rows) ? state.rows : [];
    const totalTargets = Number.isInteger(state?.totalTargets) ? state.totalTargets : 0;
    const processed = Number.isInteger(state?.processed) ? state.processed : (state?.nextIndex ?? 0);
    const matched = Number.isInteger(state?.matched) ? state.matched : rows.length;
    const currentContributor = state?.currentContributor ?? '无';
    const riskMode = state?.riskMode === RISK_MODE_LOW ? RISK_MODE_LOW : RISK_MODE_NORMAL;
    const complianceConfirmEnabled = state?.complianceConfirmEnabled !== false;
    setText(documentRef, '#status-text', `状态：${toZhStatus(state?.status ?? 'idle')}`);
    setText(documentRef, '#risk-mode-text', `模式：${toZhRiskMode(riskMode)}`);
    setText(
      documentRef,
      '#progress-text',
      `目标总数：${totalTargets}｜已处理：${processed}｜已匹配：${matched}｜当前：${currentContributor}`
    );
    setText(documentRef, '#reason-text', `原因：${toZhReason(state?.reason)}`);
    const toggle = documentRef.querySelector('#risk-mode-toggle');
    if (toggle) {
      toggle.checked = riskMode === RISK_MODE_LOW;
    }
    const complianceToggle = documentRef.querySelector('#compliance-confirm-toggle');
    if (complianceToggle) {
      complianceToggle.checked = complianceConfirmEnabled;
    }
    syncPolling(state?.status);
    renderRows(documentRef, rows);
  }

  async function refreshState() {
    const response = await sendMessage(chromeApi, { type: MSG_GET_STATE });
    if (response?.ok && response.state) {
      currentState = response.state;
      render(currentState);
    }
    return response;
  }

  async function trigger(type) {
    if (type === MSG_START_SCAN) {
      if (shouldRequireComplianceConfirm(currentState) && !askComplianceConfirm(windowRef)) {
        currentState = {
          ...currentState,
          reason: 'cancelled_by_user'
        };
        render(currentState);
        return;
      }
      // Optimistic running state: don't block UI on long background response.
      currentState = {
        ...currentState,
        status: 'running',
        reason: null
      };
      render(currentState);
      void sendMessage(chromeApi, { type });
      void refreshState();
      return;
    }

    await sendMessage(chromeApi, { type });
    await refreshState();
  }

  async function setComplianceConfirm(enabled) {
    currentState = {
      ...currentState,
      complianceConfirmEnabled: enabled !== false
    };
    render(currentState);
    const response = await sendMessage(chromeApi, {
      type: MSG_SET_COMPLIANCE_CONFIRM,
      enabled: enabled !== false
    });
    if (response?.ok && response.state) {
      currentState = response.state;
      render(currentState);
    } else {
      await refreshState();
    }
  }

  async function setRiskMode(enabled) {
    const mode = enabled ? RISK_MODE_LOW : RISK_MODE_NORMAL;
    currentState = {
      ...currentState,
      riskMode: mode
    };
    render(currentState);
    const response = await sendMessage(chromeApi, {
      type: MSG_SET_RISK_MODE,
      mode
    });
    if (response?.ok && response.state) {
      currentState = response.state;
      render(currentState);
    } else {
      await refreshState();
    }
  }

  function downloadCsv() {
    const rows = Array.isArray(currentState?.rows) ? currentState.rows : [];
    const csv = serializeRows(rows);
    const csvWithBom = `\uFEFF${csv}`;
    const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8' });
    const href = urlApi.createObjectURL(blob);

    const link = documentRef.createElement('a');
    link.href = href;
    link.download = buildCsvFilename(currentState?.repo, now());
    link.style.display = 'none';
    documentRef.body.append(link);
    link.click();
    link.remove();
    urlApi.revokeObjectURL(href);
  }

  function bindControls() {
    documentRef.querySelector('#start-btn')?.addEventListener('click', () => trigger(MSG_START_SCAN));
    documentRef.querySelector('#pause-btn')?.addEventListener('click', () => trigger(MSG_PAUSE_SCAN));
    documentRef.querySelector('#resume-btn')?.addEventListener('click', () => trigger(MSG_RESUME_SCAN));
    documentRef.querySelector('#export-btn')?.addEventListener('click', downloadCsv);
    documentRef.querySelector('#risk-mode-toggle')?.addEventListener('change', (event) => {
      const checked = Boolean(event?.target?.checked);
      void setRiskMode(checked);
    });
    documentRef.querySelector('#compliance-confirm-toggle')?.addEventListener('change', (event) => {
      const checked = Boolean(event?.target?.checked);
      void setComplianceConfirm(checked);
    });
  }

  async function init() {
    bindControls();
    await refreshState();
  }

  function destroy() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    init,
    render,
    refreshState,
    downloadCsv,
    destroy
  };
}

if (typeof document !== 'undefined' && document.querySelector('#start-btn')) {
  const popup = createPopupController();
  popup.init();
}
