function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGitHubUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
  } catch {
    return false;
  }
}

function shouldUseDriver(url, init) {
  const method = String(init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return false;
  return isGitHubUrl(url);
}

function ensureIncludeCredentials(init = {}) {
  return init.credentials ? init : { ...init, credentials: 'include' };
}

export function createPageDriverFetch({
  chromeApi = globalThis.chrome,
  fallbackFetch = fetch,
  settleMs = 900,
  timeoutMs = 30000
} = {}) {
  const tabsApi = chromeApi?.tabs;
  const scriptingApi = chromeApi?.scripting;
  const canDrive = Boolean(
    tabsApi?.create
      && tabsApi?.update
      && tabsApi?.remove
      && tabsApi?.onUpdated?.addListener
      && tabsApi?.onUpdated?.removeListener
      && scriptingApi?.executeScript
  );

  let workerTabId = null;

  async function fallback(url, init) {
    return fallbackFetch(url, ensureIncludeCredentials(init));
  }

  async function ensureWorkerTab() {
    if (workerTabId != null && typeof tabsApi?.get === 'function') {
      try {
        await tabsApi.get(workerTabId);
        return workerTabId;
      } catch {
        workerTabId = null;
      }
    }

    if (workerTabId != null && typeof tabsApi?.get !== 'function') {
      return workerTabId;
    }

    const tab = await tabsApi.create({ url: 'about:blank', active: false });
    if (!Number.isInteger(tab?.id)) {
      throw new Error('worker_tab_create_failed');
    }
    workerTabId = tab.id;
    return workerTabId;
  }

  async function waitForLoadComplete(tabId, url) {
    return new Promise((resolve, reject) => {
      let done = false;

      const finish = (fn) => (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        tabsApi.onUpdated.removeListener(onUpdated);
        fn(value);
      };

      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);

      const onUpdated = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== tabId) return;
        const status = changeInfo?.status ?? tab?.status;
        if (status === 'complete') {
          resolveOnce(tab ?? { id: tabId, url, status: 'complete' });
        }
      };

      const timer = setTimeout(() => {
        rejectOnce(new Error('driver_tab_load_timeout'));
      }, timeoutMs);

      tabsApi.onUpdated.addListener(onUpdated);
      tabsApi.update(tabId, { url }).then((tab) => {
        if (tab?.status === 'complete') {
          resolveOnce(tab);
        }
      }).catch(rejectOnce);
    });
  }

  async function readDomHtml(tabId, targetUrl) {
    const result = await Promise.race([
      scriptingApi.executeScript({
        target: { tabId },
        args: [targetUrl],
        func: async (url) => {
          const href = location.href ?? '';
          const html = document.documentElement?.outerHTML ?? '';
          const normalizedTarget = String(url ?? '');
          const path = (() => {
            try {
              return new URL(normalizedTarget).pathname;
            } catch {
              return '';
            }
          })();
          const isContributorPage = /\/(graphs\/contributors|contributors)\b/.test(path);

          if (!isContributorPage) {
            return { html, href };
          }

          const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
          const ignoreFirstSegment = new Set(['apps', 'orgs', 'organizations', 'users', 'marketplace']);
          const extractLogin = (rawHref) => {
            if (!rawHref) return null;
            let parsed;
            try {
              parsed = new URL(rawHref, location.origin);
            } catch {
              return null;
            }
            if (parsed.origin !== location.origin) return null;
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length !== 1) return null;
            const login = parts[0];
            if (ignoreFirstSegment.has(login.toLowerCase())) return null;
            return loginPattern.test(login) ? login : null;
          };

          const collectLogins = () => {
            const set = new Set();
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            for (const anchor of anchors) {
              const anchorLogin = extractLogin(anchor.getAttribute('href') ?? '');
              if (anchorLogin) {
                const attrs = anchor.outerHTML ?? '';
                if (/data-hovercard-type=["']user["']/i.test(attrs) || /avatar/i.test(attrs)) {
                  set.add(anchorLogin);
                }
              }
            }

            const avatarImgs = Array.from(document.querySelectorAll('img[alt^="@"]'));
            for (const img of avatarImgs) {
              const anchor = img.closest('a[href]');
              const login = extractLogin(anchor?.getAttribute('href') ?? '');
              if (login) set.add(login);
            }
            return [...set];
          };

          let logins = collectLogins();
          for (let i = 0; i < 14 && logins.length < 70; i += 1) {
            window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 1.6)));
            await new Promise((resolve) => setTimeout(resolve, 260));
            logins = collectLogins();
          }

          return { html: document.documentElement?.outerHTML ?? html, href, contributorLogins: logins };
        }
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('driver_execute_timeout')), timeoutMs);
      })
    ]);

    const payload = result?.[0]?.result;
    if (Array.isArray(payload?.contributorLogins) && payload.contributorLogins.length > 0) {
      return payload.contributorLogins
        .map((login) => `<a data-hovercard-type="user" href="https://github.com/${login}">${login}</a>`)
        .join('');
    }
    if (typeof payload === 'string') return payload;
    return String(payload?.html ?? '');
  }

  async function fetchViaDriver(url) {
    const tabId = await ensureWorkerTab();
    await waitForLoadComplete(tabId, url);
    if (settleMs > 0) {
      await sleep(settleMs);
    }
    const html = await readDomHtml(tabId, url);
    return {
      ok: true,
      status: 200,
      text: async () => html
    };
  }

  async function fetchPage(url, init = {}) {
    if (!canDrive || !shouldUseDriver(url, init)) {
      return fallback(url, init);
    }

    try {
      return await fetchViaDriver(url);
    } catch {
      return fallback(url, init);
    }
  }

  fetchPage.close = async () => {
    if (workerTabId == null) return;
    const id = workerTabId;
    workerTabId = null;
    try {
      await tabsApi.remove(id);
    } catch {
      // ignore cleanup failures
    }
  };

  return fetchPage;
}
