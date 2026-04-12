(function () {
  const MSG_GET_STATE = 'get_state';
  const MSG_START_SCAN_FROM_PAGE = 'start_from_page';
  const BUTTON_ID = 'gh-email-scan-start-button';
  const COMPLIANCE_CONFIRM_TEXT = '请确认仅用于合规、合法、非骚扰场景，并遵守 GitHub 条款。是否继续启动扫描？';

  function parseRepoFromUrl(url) {
    if (!url) return null;

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    if (parsed.hostname !== 'github.com') return null;
    if (parsed.protocol !== 'https:') return null;

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1];
    const reservedRoots = new Set([
      'about',
      'account',
      'apps',
      'blog',
      'business',
      'collections',
      'contact',
      'dashboard',
      'enterprise',
      'events',
      'explore',
      'features',
      'gist',
      'globalcampus',
      'graphql',
      'issues',
      'join',
      'login',
      'logout',
      'marketplace',
      'new',
      'notifications',
      'orgs',
      'organizations',
      'pricing',
      'readme',
      'search',
      'security',
      'sessions',
      'settings',
      'signup',
      'site',
      'sponsors',
      'team',
      'teams',
      'topics',
      'trending',
      'users'
    ]);
    const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
    const repoPattern = /^[A-Za-z0-9._-]+$/;

    if (!owner || !repo) return null;
    if (reservedRoots.has(owner.toLowerCase())) return null;
    if (!ownerPattern.test(owner)) return null;
    if (!repoPattern.test(repo)) return null;
    if (repo.endsWith('.git')) return null;

    return { owner, repo, fullName: `${owner}/${repo}` };
  }

  function isGitHubRepoPage(locationRef) {
    const ref = locationRef ?? window.location;
    const url = ref?.href || `https://${ref?.hostname ?? ''}${ref?.pathname ?? ''}`;
    if (!parseRepoFromUrl(url)) return false;
    const segments = String(ref?.pathname ?? '').split('/').filter(Boolean);
    return segments.length === 2;
  }

  function findInjectionTarget(documentRef) {
    const doc = documentRef ?? document;
    const selectors = [
      '.Layout-sidebar .BorderGrid',
      '#repo-content-pjax-container .Layout-sidebar',
      '.Layout-sidebar',
      '#repository-container-header .pagehead-actions',
      '.pagehead-actions',
      '[data-pjax="#repo-content-pjax-container"] .pagehead-actions'
    ];

    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      if (node) return node;
    }

    return doc.querySelector('#repo-content-pjax-container') || doc.body;
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

  function createButton(documentRef, chromeApi, pageUrl) {
    const doc = documentRef ?? document;
    const button = doc.createElement('button');
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

  function injectStartButton(options) {
    const opts = options ?? {};
    const documentRef = opts.documentRef ?? document;
    const chromeApi = opts.chromeApi ?? globalThis.chrome;
    const locationRef = opts.locationRef ?? window.location;

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

  injectStartButton();
  document.addEventListener('pjax:end', () => injectStartButton());
  document.addEventListener('turbo:load', () => injectStartButton());
})();
