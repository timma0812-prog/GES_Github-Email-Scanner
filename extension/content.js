import { MSG_GET_STATE, MSG_START_SCAN_FROM_PAGE } from './shared/messages.js';
import { parseRepoFromUrl } from './core/repoContext.js';

export const BUTTON_ID = 'gh-email-scan-start-button';
const COMPLIANCE_CONFIRM_TEXT = '请确认仅用于合规、合法、非骚扰场景，并遵守 GitHub 条款。是否继续启动扫描？';

function isGitHubRepoPage(locationRef = window.location) {
  const url = locationRef?.href || `https://${locationRef?.hostname ?? ''}${locationRef?.pathname ?? ''}`;
  if (!parseRepoFromUrl(url)) return false;
  const segments = String(locationRef?.pathname ?? '').split('/').filter(Boolean);
  return segments.length === 2;
}

function findInjectionTarget(documentRef = document) {
  const selectors = [
    '.Layout-sidebar .BorderGrid',
    '#repo-content-pjax-container .Layout-sidebar',
    '.Layout-sidebar',
    '#repository-container-header .pagehead-actions',
    '.pagehead-actions',
    '[data-pjax="#repo-content-pjax-container"] .pagehead-actions'
  ];

  for (const selector of selectors) {
    const node = documentRef.querySelector(selector);
    if (node) return node;
  }

  return documentRef.querySelector('#repo-content-pjax-container') || documentRef.body;
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

function applyButtonScanState(button, running) {
  button.disabled = Boolean(running);
  button.textContent = running ? '扫描中…' : '开始邮箱扫描';
}

async function syncButtonScanState(button, chromeApi) {
  const response = await sendMessage(chromeApi, { type: MSG_GET_STATE });
  const running = response?.ok && response?.state?.status === 'running';
  applyButtonScanState(button, running);
}

function createButton(documentRef = document, chromeApi = globalThis.chrome, pageUrl = window.location.href) {
  const button = documentRef.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = '开始邮箱扫描';
  button.className = 'btn btn-sm';
  button.style.margin = '8px 0';
  button.addEventListener('click', () => {
    void (async () => {
      const stateResponse = await sendMessage(chromeApi, { type: MSG_GET_STATE });
      const shouldConfirm = stateResponse?.ok ? stateResponse?.state?.complianceConfirmEnabled !== false : true;
      const confirmed = !shouldConfirm || typeof globalThis.confirm !== 'function' || globalThis.confirm(COMPLIANCE_CONFIRM_TEXT);
      if (!confirmed) return;
      applyButtonScanState(button, true);
      chromeApi?.runtime?.sendMessage?.({
        type: MSG_START_SCAN_FROM_PAGE,
        url: pageUrl
      }, () => {
        void syncButtonScanState(button, chromeApi);
      });
    })();
  });
  void syncButtonScanState(button, chromeApi);
  return button;
}

export function injectStartButton({ documentRef = document, chromeApi = globalThis.chrome, locationRef = window.location } = {}) {
  if (!isGitHubRepoPage(locationRef)) return null;
  const existing = documentRef.getElementById(BUTTON_ID);
  if (existing) {
    void syncButtonScanState(existing, chromeApi);
    return existing;
  }

  const target = findInjectionTarget(documentRef);
  if (!target) return null;

  const button = createButton(documentRef, chromeApi, locationRef.href);
  target.prepend(button);
  return button;
}

function bootContentScript() {
  injectStartButton();
  document.addEventListener('pjax:end', () => injectStartButton());
  document.addEventListener('turbo:load', () => injectStartButton());
}

if (typeof document !== 'undefined') {
  bootContentScript();
}
