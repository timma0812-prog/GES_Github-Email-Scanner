# GitHub Contributor Public Email Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome/Edge MV3 extension that scans a repository's first 50 contributors, extracts the first non-`noreply` public email from PR/commit `.patch` text using URL composition, and exports matched rows as CSV.

**Architecture:** A service-worker orchestrator runs a serial scan queue with jitter delay and pause/resume support. Candidate sources follow strict priority: repo PR search URL -> contributor activity fallback -> commit fallback. Content script injects a Start button on repo pages; popup provides start/pause/resume, progress, result table, and CSV export.

**Tech Stack:** JavaScript (ES modules), Chrome Extension Manifest V3, `chrome.storage.local`, Vitest + jsdom for unit/integration tests.

---

## Scope Check

This spec describes one bounded subsystem (a single browser extension with scanning + extraction + popup export). It does not require splitting into multiple independent plans.

## Planned File Structure

Create these files first so module boundaries are explicit:

- `package.json` - scripts and test dependencies.
- `vitest.config.js` - jsdom test environment.
- `extension/manifest.json` - MV3 manifest with required permissions.
- `extension/background.js` - service worker message router + orchestrator lifecycle.
- `extension/content.js` - repository page Start button injection.
- `extension/popup.html` - popup UI shell.
- `extension/popup.js` - popup interactions, progress rendering, CSV trigger.
- `extension/popup.css` - popup styles.
- `extension/shared/messages.js` - message/event constants.
- `extension/core/settings.js` - all runtime constants.
- `extension/core/repoContext.js` - parse and validate `owner/repo` from URL.
- `extension/core/patchExtractor.js` - parse `.patch` text and filter emails.
- `extension/core/sourceResolver.js` - build/parse PR+commit candidate URLs.
- `extension/core/githubClient.js` - fetch helpers, retries, pause detection, delay.
- `extension/core/storage.js` - typed wrapper around `chrome.storage.local`.
- `extension/core/csv.js` - CSV serialization.
- `extension/core/orchestrator.js` - serial scanning state machine.
- `tests/repoContext.test.js`
- `tests/patchExtractor.test.js`
- `tests/sourceResolver.test.js`
- `tests/githubClient.test.js`
- `tests/orchestrator.test.js`
- `tests/content.test.js`
- `tests/csv.test.js`
- `tests/popup.test.js`
- `tests/integration-flow.test.js`

---

### Task 1: Bootstrap Extension Workspace

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/content.js`
- Create: `extension/popup.html`
- Create: `extension/popup.js`
- Create: `extension/popup.css`
- Test: `tests/bootstrap.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "github-contributor-email-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest",
    "test:run": "vitest --run",
    "test:watch": "vitest",
    "check": "npm run test:run"
  },
  "devDependencies": {
    "jsdom": "^24.1.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.js"]
  }
});
```

- [ ] **Step 3: Create initial extension shell files**

```json
// extension/manifest.json
{
  "manifest_version": 3,
  "name": "GitHub Contributor Public Email Extractor",
  "version": "0.1.0",
  "description": "Extract first non-noreply public emails from GitHub patch pages.",
  "permissions": ["storage", "tabs", "scripting"],
  "host_permissions": ["https://github.com/*", "https://patch-diff.githubusercontent.com/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://github.com/*/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

```js
// extension/background.js
export {};
```

```js
// extension/content.js
export {};
```

```html
<!-- extension/popup.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>Email Extractor</title>
    <link rel="stylesheet" href="./popup.css" />
  </head>
  <body>
    <div id="app">
      <h1>Email Extractor</h1>
      <div id="status">Idle</div>
    </div>
    <script type="module" src="./popup.js"></script>
  </body>
</html>
```

```js
// extension/popup.js
export {};
```

```css
/* extension/popup.css */
body {
  font-family: Arial, sans-serif;
  min-width: 360px;
  margin: 0;
  padding: 12px;
}
```

- [ ] **Step 4: Add bootstrap smoke test**

```js
// tests/bootstrap.test.js
import { describe, expect, test } from "vitest";
import manifest from "../extension/manifest.json" with { type: "json" };

describe("bootstrap", () => {
  test("manifest is MV3", () => {
    expect(manifest.manifest_version).toBe(3);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm install && npm run test:run`  
Expected: PASS with `1 passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.js extension tests/bootstrap.test.js
git commit -m "chore: bootstrap mv3 extension workspace with vitest"
```

---

### Task 2: Repo Context Parser (TDD)

**Files:**
- Create: `extension/core/repoContext.js`
- Test: `tests/repoContext.test.js`

- [ ] **Step 1: Write failing tests for repo URL parsing**

```js
import { describe, expect, test } from "vitest";
import { parseRepoFromUrl } from "../extension/core/repoContext.js";

describe("parseRepoFromUrl", () => {
  test("parses standard repo URL", () => {
    expect(parseRepoFromUrl("https://github.com/bytedance/deer-flow")).toEqual({
      owner: "bytedance",
      repo: "deer-flow",
      fullName: "bytedance/deer-flow"
    });
  });

  test("parses repo subpage URL", () => {
    expect(parseRepoFromUrl("https://github.com/bytedance/deer-flow/pulls")).toEqual({
      owner: "bytedance",
      repo: "deer-flow",
      fullName: "bytedance/deer-flow"
    });
  });

  test("returns null for non-repo URL", () => {
    expect(parseRepoFromUrl("https://github.com/explore")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/repoContext.test.js`  
Expected: FAIL with "Cannot find module ../extension/core/repoContext.js".

- [ ] **Step 3: Write minimal implementation**

```js
// extension/core/repoContext.js
const REPO_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/?#]+)(?:[/?#]|$)/i;

export function parseRepoFromUrl(url) {
  const match = REPO_URL_RE.exec(url);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2];

  if (!owner || !repo || repo === "settings") return null;

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/repoContext.test.js`  
Expected: PASS with `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/core/repoContext.js tests/repoContext.test.js
git commit -m "feat: add repo URL context parser"
```

---

### Task 3: Patch Email Extraction (TDD)

**Files:**
- Create: `extension/core/patchExtractor.js`
- Test: `tests/patchExtractor.test.js`

- [ ] **Step 1: Write failing tests for extraction and noreply filtering**

```js
import { describe, expect, test } from "vitest";
import { extractFirstPublicEmail } from "../extension/core/patchExtractor.js";

describe("extractFirstPublicEmail", () => {
  test("extracts From email when public", () => {
    const patch = `From 123 Mon Sep 17 00:00:00 2001
From: Alice Example <alice@example.com>
Subject: [PATCH] feat: demo`;
    expect(extractFirstPublicEmail(patch)).toBe("alice@example.com");
  });

  test("filters github noreply and falls back to co-author", () => {
    const patch = `From 123 Mon Sep 17 00:00:00 2001
From: Bob <12345+bob@users.noreply.github.com>
Co-authored-by: Carol <carol@company.com>`;
    expect(extractFirstPublicEmail(patch)).toBe("carol@company.com");
  });

  test("returns null when all candidates are noreply", () => {
    const patch = `From: Bot <bot@noreply.github.com>
Co-authored-by: Dev <dev@users.noreply.github.com>`;
    expect(extractFirstPublicEmail(patch)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/patchExtractor.test.js`  
Expected: FAIL with missing module error.

- [ ] **Step 3: Implement extractor**

```js
// extension/core/patchExtractor.js
const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNoreply(email) {
  const lower = email.toLowerCase();
  return (
    lower.includes("noreply") ||
    lower.endsWith("@noreply.github.com") ||
    lower.endsWith("@users.noreply.github.com")
  );
}

function collectCandidates(patchText) {
  const lines = patchText.split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    if (line.startsWith("From:") || line.startsWith("Co-authored-by:")) {
      const match = /<([^>]+)>/.exec(line);
      if (match) out.push(match[1].trim().toLowerCase());
    }
  }

  return out;
}

export function extractFirstPublicEmail(patchText) {
  if (!patchText) return null;

  const candidates = collectCandidates(patchText);
  for (const email of candidates) {
    if (!SIMPLE_EMAIL_RE.test(email)) continue;
    if (isNoreply(email)) continue;
    return email;
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/patchExtractor.test.js`  
Expected: PASS with `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/core/patchExtractor.js tests/patchExtractor.test.js
git commit -m "feat: add patch email extraction with noreply filtering"
```

---

### Task 4: Source URL Resolver (TDD)

**Files:**
- Create: `extension/core/sourceResolver.js`
- Test: `tests/sourceResolver.test.js`

- [ ] **Step 1: Write failing tests for URL composition and link parsing**

```js
import { describe, expect, test } from "vitest";
import {
  buildPrSearchUrl,
  buildCommitSearchUrl,
  toPatchUrl,
  parsePrUrlsFromHtml,
  parseCommitUrlsFromHtml,
  parseActivityFallbackUrls
} from "../extension/core/sourceResolver.js";

describe("sourceResolver", () => {
  test("builds PR search URL", () => {
    expect(buildPrSearchUrl("bytedance", "deer-flow", "WillemJiang")).toBe(
      "https://github.com/bytedance/deer-flow/pulls?q=is%3Apr+author%3AWillemJiang"
    );
  });

  test("builds commit search URL", () => {
    expect(buildCommitSearchUrl("bytedance", "deer-flow", "WillemJiang")).toBe(
      "https://github.com/bytedance/deer-flow/commits?author=WillemJiang"
    );
  });

  test("adds .patch suffix", () => {
    expect(toPatchUrl("https://github.com/bytedance/deer-flow/pull/2027")).toBe(
      "https://github.com/bytedance/deer-flow/pull/2027.patch"
    );
  });

  test("parses PR links from repository html", () => {
    const html = '<a href="/bytedance/deer-flow/pull/2027">x</a><a href="/bytedance/deer-flow/pull/2019">y</a>';
    expect(parsePrUrlsFromHtml(html, "bytedance", "deer-flow")).toEqual([
      "https://github.com/bytedance/deer-flow/pull/2027",
      "https://github.com/bytedance/deer-flow/pull/2019"
    ]);
  });

  test("parses commit links from repository html", () => {
    const html = '<a href="/bytedance/deer-flow/commit/abcd1234">x</a>';
    expect(parseCommitUrlsFromHtml(html, "bytedance", "deer-flow")).toEqual([
      "https://github.com/bytedance/deer-flow/commit/abcd1234"
    ]);
  });

  test("parses activity fallback urls for target repo only", () => {
    const html = '<a href="/bytedance/deer-flow/pull/2000">a</a><a href="/other/repo/pull/1">b</a>';
    const data = parseActivityFallbackUrls(html, "bytedance", "deer-flow");
    expect(data.prs).toEqual(["https://github.com/bytedance/deer-flow/pull/2000"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/sourceResolver.test.js`  
Expected: FAIL with missing module error.

- [ ] **Step 3: Implement resolver module**

```js
// extension/core/sourceResolver.js
const DEFAULT_MAX_CONTRIBUTORS = 50;
const DEFAULT_MAX_PR_ATTEMPTS = 3;
const DEFAULT_MAX_COMMIT_ATTEMPTS = 3;

function uniq(values) {
  return [...new Set(values)];
}

export function buildPrSearchUrl(owner, repo, login) {
  return `https://github.com/${owner}/${repo}/pulls?q=is%3Apr+author%3A${encodeURIComponent(login)}`;
}

export function buildCommitSearchUrl(owner, repo, login) {
  return `https://github.com/${owner}/${repo}/commits?author=${encodeURIComponent(login)}`;
}

export function buildContributorProfileUrl(login) {
  return `https://github.com/${login}`;
}

export function toPatchUrl(url) {
  return url.endsWith(".patch") ? url : `${url}.patch`;
}

export function parseContributorLoginsFromHtml(html, limit = DEFAULT_MAX_CONTRIBUTORS) {
  const re = /href="\/([^/"?#]+)"[^>]*data-hovercard-type="user"/g;
  const out = [];
  let match = null;

  while ((match = re.exec(html)) !== null) {
    out.push(match[1]);
  }

  return uniq(out).slice(0, limit);
}

export function parsePrUrlsFromHtml(html, owner, repo) {
  const re = new RegExp(`/${owner}/${repo}/pull/\\d+`, "g");
  const matches = html.match(re) || [];
  return uniq(matches).map((m) => `https://github.com${m}`);
}

export function parseCommitUrlsFromHtml(html, owner, repo) {
  const re = new RegExp(`/${owner}/${repo}/commit/[0-9a-fA-F]{7,40}`, "g");
  const matches = html.match(re) || [];
  return uniq(matches).map((m) => `https://github.com${m}`);
}

export function parseActivityFallbackUrls(html, owner, repo) {
  return {
    prs: parsePrUrlsFromHtml(html, owner, repo),
    commits: parseCommitUrlsFromHtml(html, owner, repo)
  };
}

async function fetchHtml(fetchImpl, url) {
  const res = await fetchImpl(url, { credentials: "include" });
  return res.text();
}

export function createResolver(fetchImpl = fetch) {
  return {
    async getContributors(ctx) {
      const url = `https://github.com/${ctx.owner}/${ctx.repo}/graphs/contributors`;
      const html = await fetchHtml(fetchImpl, url);
      return parseContributorLoginsFromHtml(html, DEFAULT_MAX_CONTRIBUTORS);
    },
    async getPrCandidates(ctx, login) {
      const html = await fetchHtml(fetchImpl, buildPrSearchUrl(ctx.owner, ctx.repo, login));
      return parsePrUrlsFromHtml(html, ctx.owner, ctx.repo).slice(0, DEFAULT_MAX_PR_ATTEMPTS);
    },
    async getFallbackCandidates(ctx, login) {
      const profileUrl = `https://github.com/${login}?tab=overview`;
      const html = await fetchHtml(fetchImpl, profileUrl);
      const parsed = parseActivityFallbackUrls(html, ctx.owner, ctx.repo);
      return {
        prs: parsed.prs.slice(0, DEFAULT_MAX_PR_ATTEMPTS),
        commits: parsed.commits.slice(0, DEFAULT_MAX_COMMIT_ATTEMPTS)
      };
    },
    async getCommitCandidates(ctx, login) {
      const html = await fetchHtml(fetchImpl, buildCommitSearchUrl(ctx.owner, ctx.repo, login));
      return parseCommitUrlsFromHtml(html, ctx.owner, ctx.repo).slice(0, DEFAULT_MAX_COMMIT_ATTEMPTS);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/sourceResolver.test.js`  
Expected: PASS with `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/core/sourceResolver.js tests/sourceResolver.test.js
git commit -m "feat: add url composition and candidate link parsing"
```

---

### Task 5: GitHub Client for Delay, Retry, and Pause Detection (TDD)

**Files:**
- Create: `extension/core/settings.js`
- Create: `extension/core/githubClient.js`
- Test: `tests/githubClient.test.js`

- [ ] **Step 1: Write failing tests for pause detection and delay range**

```js
import { describe, expect, test } from "vitest";
import {
  detectPauseReason,
  jitterDelayMs,
  shouldRetry
} from "../extension/core/githubClient.js";

describe("githubClient helpers", () => {
  test("detects 429 pause", () => {
    expect(detectPauseReason(429, "Too Many Requests")).toContain("429");
  });

  test("detects captcha/challenge pause", () => {
    const reason = detectPauseReason(200, "Please verify you are human");
    expect(reason).toContain("verification");
  });

  test("jitter delay stays in range", () => {
    for (let i = 0; i < 20; i += 1) {
      const ms = jitterDelayMs(800, 1200);
      expect(ms).toBeGreaterThanOrEqual(800);
      expect(ms).toBeLessThanOrEqual(1200);
    }
  });

  test("retry only for transient errors", () => {
    expect(shouldRetry(500)).toBe(true);
    expect(shouldRetry(429)).toBe(false);
    expect(shouldRetry(404)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/githubClient.test.js`  
Expected: FAIL with missing module error.

- [ ] **Step 3: Implement `settings.js` and `githubClient.js`**

```js
// extension/core/settings.js
export const MAX_CONTRIBUTORS = 50;
export const MAX_PR_ATTEMPTS = 3;
export const MAX_COMMIT_ATTEMPTS = 3;
export const MIN_DELAY_MS = 800;
export const MAX_DELAY_MS = 1200;
export const RETRY_TIMES = 2;
```

```js
// extension/core/githubClient.js
export function jitterDelayMs(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function detectPauseReason(status, text) {
  if (status === 429) return "Paused: hit 429 rate limit.";
  const lower = (text || "").toLowerCase();
  if (lower.includes("verify you are human") || lower.includes("captcha") || lower.includes("challenge")) {
    return "Paused: verification required.";
  }
  return null;
}

export function shouldRetry(status) {
  return status >= 500 && status <= 599;
}

export async function fetchTextWithRetry(url, retries = 2) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, { credentials: "include" });
    const text = await res.text();

    const pauseReason = detectPauseReason(res.status, text);
    if (pauseReason) {
      return { ok: false, pauseReason, status: res.status, text };
    }

    if (res.ok) return { ok: true, status: res.status, text };

    if (!shouldRetry(res.status) || attempt >= retries) {
      return { ok: false, status: res.status, text };
    }

    attempt += 1;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/githubClient.test.js`  
Expected: PASS with `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/core/settings.js extension/core/githubClient.js tests/githubClient.test.js
git commit -m "feat: add github client helpers for delay retry and pause detection"
```

---

### Task 6: Orchestrator State Machine (TDD)

**Files:**
- Create: `extension/shared/messages.js`
- Create: `extension/core/storage.js`
- Create: `extension/core/orchestrator.js`
- Test: `tests/orchestrator.test.js`

- [ ] **Step 1: Write failing orchestrator tests for priority and early-stop behavior**

```js
import { describe, expect, test, vi } from "vitest";
import { createOrchestrator } from "../extension/core/orchestrator.js";

describe("orchestrator", () => {
  test("stops contributor probing on first valid email", async () => {
    const resolver = {
      getContributors: vi.fn().mockResolvedValue(["alice"]),
      getPrCandidates: vi.fn().mockResolvedValue(["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"]),
      getFallbackCandidates: vi.fn().mockResolvedValue({ prs: [], commits: [] }),
      getCommitCandidates: vi.fn().mockResolvedValue([])
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: "From: A <alice@corp.com>", status: 200 })
      .mockResolvedValueOnce({ ok: true, text: "From: A <second@corp.com>", status: 200 });
    const extractor = vi.fn().mockReturnValue("alice@corp.com");

    const orchestrator = createOrchestrator({ resolver, fetchPatch: fetcher, extractEmail: extractor });
    const result = await orchestrator.scan({ owner: "o", repo: "r" });

    expect(result.rows).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("keeps global PR budget = 3 across primary and fallback paths", async () => {
    const resolver = {
      getContributors: vi.fn().mockResolvedValue(["alice"]),
      getPrCandidates: vi.fn().mockResolvedValue(["u1", "u2"]),
      getFallbackCandidates: vi.fn().mockResolvedValue({ prs: ["u3", "u4"], commits: [] }),
      getCommitCandidates: vi.fn().mockResolvedValue([])
    };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: "From: A <a@users.noreply.github.com>", status: 200 });
    const extractor = vi.fn().mockReturnValue(null);

    const orchestrator = createOrchestrator({ resolver, fetchPatch: fetcher, extractEmail: extractor });
    await orchestrator.scan({ owner: "o", repo: "r" });

    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/orchestrator.test.js`  
Expected: FAIL with missing module error.

- [ ] **Step 3: Implement messages, storage wrapper, and orchestrator**

```js
// extension/shared/messages.js
export const MSG_START_SCAN = "START_SCAN";
export const MSG_START_SCAN_FROM_PAGE = "START_SCAN_FROM_PAGE";
export const MSG_PAUSE_SCAN = "PAUSE_SCAN";
export const MSG_RESUME_SCAN = "RESUME_SCAN";
export const MSG_GET_STATE = "GET_STATE";
```

```js
// extension/core/storage.js
const KEY = "scan_state_v1";

export async function saveScanState(state) {
  await chrome.storage.local.set({ [KEY]: state });
}

export async function loadScanState() {
  const data = await chrome.storage.local.get(KEY);
  return data[KEY] || null;
}
```

```js
// extension/core/orchestrator.js
import {
  MAX_DELAY_MS,
  MAX_COMMIT_ATTEMPTS,
  MAX_PR_ATTEMPTS,
  MIN_DELAY_MS
} from "./settings.js";
import { jitterDelayMs, sleep } from "./githubClient.js";
import { toPatchUrl } from "./sourceResolver.js";

export function createOrchestrator({ resolver, fetchPatch, extractEmail, shouldPause = () => null }) {
  async function probePatch(url) {
    const manualReasonBeforeDelay = shouldPause();
    if (manualReasonBeforeDelay) {
      return { ok: false, pauseReason: manualReasonBeforeDelay, status: 0, text: "" };
    }
    await sleep(jitterDelayMs(MIN_DELAY_MS, MAX_DELAY_MS));
    const manualReasonBeforeFetch = shouldPause();
    if (manualReasonBeforeFetch) {
      return { ok: false, pauseReason: manualReasonBeforeFetch, status: 0, text: "" };
    }
    return fetchPatch(toPatchUrl(url));
  }

  async function scanOneContributor(ctx, login) {
    let prBudget = MAX_PR_ATTEMPTS;

    const primaryPrs = await resolver.getPrCandidates(ctx, login);
    for (const prUrl of primaryPrs) {
      if (prBudget <= 0) break;
      prBudget -= 1;
      const patch = await probePatch(prUrl);
      if (!patch.ok) {
        if (patch.pauseReason) return { pauseReason: patch.pauseReason };
        continue;
      }
      const email = extractEmail(patch.text);
      if (email) {
        return {
          row: {
            contributor_login: login,
            email,
            source_type: "PR",
            source_url: prUrl,
            extracted_at: new Date().toISOString()
          }
        };
      }
    }

    if (prBudget > 0) {
      const fallback = await resolver.getFallbackCandidates(ctx, login);
      for (const prUrl of fallback.prs) {
        if (prBudget <= 0) break;
        prBudget -= 1;
        const patch = await probePatch(prUrl);
        if (!patch.ok) {
          if (patch.pauseReason) return { pauseReason: patch.pauseReason };
          continue;
        }
        const email = extractEmail(patch.text);
        if (email) {
          return {
            row: {
              contributor_login: login,
              email,
              source_type: "PR",
              source_url: prUrl,
              extracted_at: new Date().toISOString()
            }
          };
        }
      }

      const mergedCommits = [...fallback.commits, ...(await resolver.getCommitCandidates(ctx, login))];
      const uniqueCommits = [...new Set(mergedCommits)].slice(0, MAX_COMMIT_ATTEMPTS);
      for (const commitUrl of uniqueCommits) {
        const patch = await probePatch(commitUrl);
        if (!patch.ok) {
          if (patch.pauseReason) return { pauseReason: patch.pauseReason };
          continue;
        }
        const email = extractEmail(patch.text);
        if (email) {
          return {
            row: {
              contributor_login: login,
              email,
              source_type: "commit",
              source_url: commitUrl,
              extracted_at: new Date().toISOString()
            }
          };
        }
      }
    }

    return { row: null };
  }

  async function scan(ctx, previous = { nextIndex: 0, rows: [] }) {
    const contributors = await resolver.getContributors(ctx);
    const rows = [...(previous.rows || [])];
    const startIndex = previous.nextIndex || 0;

    for (let i = startIndex; i < contributors.length; i += 1) {
      const login = contributors[i];
      const one = await scanOneContributor(ctx, login);
      if (one.pauseReason) {
        return { status: "paused", rows, pauseReason: one.pauseReason, nextIndex: i };
      }
      if (one.row) rows.push(one.row);
    }

    return { status: "done", rows, pauseReason: null, nextIndex: contributors.length };
  }

  return { scan };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/orchestrator.test.js`  
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/shared/messages.js extension/core/storage.js extension/core/orchestrator.js tests/orchestrator.test.js
git commit -m "feat: add serial scan orchestrator with pr budget and commit fallback"
```

---

### Task 7: Content Script Injection + Start Trigger (TDD)

**Files:**
- Modify: `extension/content.js`
- Test: `tests/content.test.js`

- [ ] **Step 1: Write failing test for button injection**

```js
import { beforeEach, describe, expect, test, vi } from "vitest";
import { injectStartButton } from "../extension/content.js";

describe("content script", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="repo-content-pjax-container"><aside><h2>Contributors</h2><div class="Box"></div></aside></div>';
    global.chrome = {
      runtime: { sendMessage: vi.fn() }
    };
  });

  test("injects start button once", () => {
    injectStartButton();
    injectStartButton();
    expect(document.querySelectorAll("#gh-email-start-btn")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/content.test.js`  
Expected: FAIL because `injectStartButton` is not exported.

- [ ] **Step 3: Implement content injection**

```js
// extension/content.js
import { MSG_START_SCAN_FROM_PAGE } from "./shared/messages.js";

function findContributorsContainer() {
  return document.querySelector("aside");
}

export function injectStartButton() {
  const parent = findContributorsContainer();
  if (!parent) return false;
  if (document.getElementById("gh-email-start-btn")) return true;

  const btn = document.createElement("button");
  btn.id = "gh-email-start-btn";
  btn.textContent = "Start Email Scan";
  btn.style.marginTop = "8px";
  btn.style.padding = "6px 10px";
  btn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: MSG_START_SCAN_FROM_PAGE });
  });

  parent.appendChild(btn);
  return true;
}

if (window.location.pathname.split("/").length >= 3) {
  injectStartButton();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/content.test.js`  
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add extension/content.js tests/content.test.js
git commit -m "feat: inject start button on github repo pages"
```

---

### Task 8: Popup, CSV Export, and UI Rendering (TDD)

**Files:**
- Create: `extension/core/csv.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `extension/popup.css`
- Test: `tests/csv.test.js`
- Test: `tests/popup.test.js`

- [ ] **Step 1: Write failing CSV serializer tests**

```js
import { describe, expect, test } from "vitest";
import { toCsv } from "../extension/core/csv.js";

describe("toCsv", () => {
  test("serializes required headers and rows", () => {
    const csv = toCsv([
      {
        contributor_login: "alice",
        email: "alice@corp.com",
        source_type: "PR",
        source_url: "https://github.com/o/r/pull/1",
        extracted_at: "2026-04-09T00:00:00.000Z"
      }
    ]);
    expect(csv.split("\n")[0]).toBe("contributor_login,email,source_type,source_url,extracted_at");
    expect(csv).toContain("alice@corp.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/csv.test.js`  
Expected: FAIL with missing module error.

- [ ] **Step 3: Implement CSV serializer**

```js
// extension/core/csv.js
const HEADER = ["contributor_login", "email", "source_type", "source_url", "extracted_at"];

function esc(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

export function toCsv(rows) {
  const lines = [HEADER.join(",")];
  for (const row of rows) {
    lines.push(HEADER.map((k) => esc(row[k])).join(","));
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Write failing popup render test**

```js
import { beforeEach, describe, expect, test } from "vitest";
import { renderRows } from "../extension/popup.js";

describe("popup renderRows", () => {
  beforeEach(() => {
    document.body.innerHTML = '<table><tbody id="result-body"></tbody></table>';
  });

  test("renders one row", () => {
    renderRows([
      {
        contributor_login: "alice",
        email: "alice@corp.com",
        source_type: "PR",
        source_url: "https://github.com/o/r/pull/1",
        extracted_at: "2026-04-09T00:00:00.000Z"
      }
    ]);
    expect(document.querySelectorAll("#result-body tr")).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Implement popup UI and renderer**

```html
<!-- extension/popup.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>Email Extractor</title>
    <link rel="stylesheet" href="./popup.css" />
  </head>
  <body>
    <h1>GitHub Email Extractor</h1>
    <div class="controls">
      <button id="start-btn">Start</button>
      <button id="pause-btn">Pause</button>
      <button id="resume-btn">Resume</button>
      <button id="export-btn">Export CSV</button>
    </div>
    <div id="status">Idle</div>
    <table>
      <thead>
        <tr>
          <th>login</th>
          <th>email</th>
          <th>type</th>
          <th>url</th>
          <th>time</th>
        </tr>
      </thead>
      <tbody id="result-body"></tbody>
    </table>
    <script type="module" src="./popup.js"></script>
  </body>
</html>
```

```js
// extension/popup.js
import { toCsv } from "./core/csv.js";
import {
  MSG_GET_STATE,
  MSG_PAUSE_SCAN,
  MSG_RESUME_SCAN,
  MSG_START_SCAN
} from "./shared/messages.js";

export function renderRows(rows) {
  const tbody = document.getElementById("result-body");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.contributor_login}</td>
      <td>${row.email}</td>
      <td>${row.source_type}</td>
      <td><a href="${row.source_url}" target="_blank">open</a></td>
      <td>${row.extracted_at}</td>
    `;
    tbody.appendChild(tr);
  }
}

function downloadCsv(rows) {
  const csv = toCsv(rows);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stateRepo = (window.__lastScanState?.repo || "github_repo").replace("/", "_");
  const iso = new Date().toISOString();
  const stamp = iso.slice(0, 19).replaceAll("-", "").replace("T", "_").replaceAll(":", "");
  a.download = `${stateRepo}_emails_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function refreshState() {
  const state = await chrome.runtime.sendMessage({ type: MSG_GET_STATE });
  window.__lastScanState = state;
  document.getElementById("status").textContent = state.status || "idle";
  renderRows(state.rows || []);
}

if (typeof document !== "undefined") {
  const startBtn = document.getElementById("start-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const resumeBtn = document.getElementById("resume-btn");
  const exportBtn = document.getElementById("export-btn");

  startBtn?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: MSG_START_SCAN });
    await refreshState();
  });

  pauseBtn?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: MSG_PAUSE_SCAN });
    await refreshState();
  });

  resumeBtn?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: MSG_RESUME_SCAN });
    await refreshState();
  });

  if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
      const state = await chrome.runtime.sendMessage({ type: MSG_GET_STATE });
      downloadCsv(state.rows || []);
    });
  }

  refreshState();
}
```

```css
/* extension/popup.css */
body {
  font-family: Arial, sans-serif;
  min-width: 640px;
  padding: 10px;
}

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  border: 1px solid #d0d7de;
  padding: 4px 6px;
}
```

- [ ] **Step 6: Run popup/csv tests**

Run: `npm run test:run -- tests/csv.test.js tests/popup.test.js`  
Expected: PASS with `2 passed`.

- [ ] **Step 7: Commit**

```bash
git add extension/popup.html extension/popup.js extension/popup.css extension/core/csv.js tests/csv.test.js tests/popup.test.js
git commit -m "feat: add popup rendering and csv export"
```

---

### Task 9: Wire Background Service Worker and Full Integration Test (TDD)

**Files:**
- Modify: `extension/background.js`
- Test: `tests/integration-flow.test.js`

- [ ] **Step 1: Write failing integration-flow test for required behavior**

```js
import { describe, expect, test, vi } from "vitest";
import { createOrchestrator } from "../extension/core/orchestrator.js";

describe("integration flow", () => {
  test("returns only matched contributors and skips not found", async () => {
    const resolver = {
      getContributors: vi.fn().mockResolvedValue(["a", "b"]),
      getPrCandidates: vi.fn().mockImplementation(async (_, login) => (login === "a" ? ["pr1"] : [])),
      getFallbackCandidates: vi.fn().mockResolvedValue({ prs: [], commits: [] }),
      getCommitCandidates: vi.fn().mockResolvedValue([])
    };
    const fetchPatch = vi.fn().mockResolvedValue({ ok: true, text: "From: A <a@corp.com>", status: 200 });
    const extractEmail = vi.fn().mockImplementation((text) => (text.includes("a@corp.com") ? "a@corp.com" : null));
    const orchestrator = createOrchestrator({ resolver, fetchPatch, extractEmail });

    const result = await orchestrator.scan({ owner: "o", repo: "r" });
    expect(result.status).toBe("done");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].contributor_login).toBe("a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/integration-flow.test.js`  
Expected: FAIL until full background wiring is complete.

- [ ] **Step 3: Implement background message routing and state handoff**

```js
// extension/background.js
import {
  MSG_GET_STATE,
  MSG_PAUSE_SCAN,
  MSG_RESUME_SCAN,
  MSG_START_SCAN,
  MSG_START_SCAN_FROM_PAGE
} from "./shared/messages.js";
import { createOrchestrator } from "./core/orchestrator.js";
import { extractFirstPublicEmail } from "./core/patchExtractor.js";
import { fetchTextWithRetry } from "./core/githubClient.js";
import { createResolver } from "./core/sourceResolver.js";
import { parseRepoFromUrl } from "./core/repoContext.js";
import { loadScanState, saveScanState } from "./core/storage.js";

let latestState = { status: "idle", rows: [], progress: null, nextIndex: 0, repo: null };
let manualPauseRequested = false;

const orchestrator = createOrchestrator({
  resolver: createResolver(),
  fetchPatch: (url) => fetchTextWithRetry(url, 2),
  extractEmail: extractFirstPublicEmail,
  shouldPause: () => (manualPauseRequested ? "Paused: manually paused by user." : null)
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === MSG_GET_STATE) {
      sendResponse(latestState);
      return;
    }

    if (msg.type === MSG_PAUSE_SCAN) {
      manualPauseRequested = true;
      latestState = { ...latestState, status: "paused" };
      await saveScanState(latestState);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === MSG_RESUME_SCAN) {
      manualPauseRequested = false;
      latestState = (await loadScanState()) || latestState;
      if (!latestState.repo) {
        sendResponse({ ok: false, error: "No paused scan found." });
        return;
      }
      latestState = { ...latestState, status: "running" };
      const [owner, repo] = latestState.repo.split("/");
      const result = await orchestrator.scan({ owner, repo }, latestState);
      latestState = { ...latestState, ...result, repo: `${owner}/${repo}` };
      await saveScanState(latestState);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === MSG_START_SCAN || msg.type === MSG_START_SCAN_FROM_PAGE) {
      manualPauseRequested = false;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const ctx = parseRepoFromUrl(tab.url);
      if (!ctx) {
        sendResponse({ ok: false, error: "Not on repository page." });
        return;
      }
      latestState = { status: "running", rows: [], progress: null, nextIndex: 0, repo: ctx.fullName };
      await saveScanState(latestState);
      const result = await orchestrator.scan(ctx);
      latestState = {
        ...latestState,
        ...result,
        repo: ctx.fullName,
        pauseReason: result.pauseReason || null
      };
      await saveScanState(latestState);
      sendResponse({ ok: true, state: latestState });
    }
  })();

  return true;
});

export function _debugState() {
  return { latestState };
}
```

- [ ] **Step 4: Run full test suite**

Run: `npm run test:run`  
Expected: PASS with all module tests green.

- [ ] **Step 5: Manual validation in browser**

Run:
1. Open `chrome://extensions`
2. Load unpacked: `extension/`
3. Open `https://github.com/bytedance/deer-flow`
4. Click page `Start Email Scan` button
5. Verify popup table shows only matched contributors (skips not-found)
6. Export CSV and verify header:
   `contributor_login,email,source_type,source_url,extracted_at`
7. Verify CSV filename pattern:
   `{owner}_{repo}_emails_{YYYYMMDD_HHmmss}.csv`

Expected:
- Scan runs serially.
- Pause occurs on challenge/rate-limit pages.
- Resume continues from saved state.

- [ ] **Step 6: Commit**

```bash
git add extension/background.js tests/integration-flow.test.js
git commit -m "feat: wire background orchestrator and end-to-end scan flow"
```

---

## Final Verification Checklist

- [ ] `npm run test:run` passes.
- [ ] Extension loads as unpacked MV3 extension.
- [ ] Repo page Start button appears once.
- [ ] Popup Start/Pause/Resume works.
- [ ] PR-first + fallback + commit fallback behavior confirmed.
- [ ] `noreply` filtering confirmed.
- [ ] Not-found contributors are skipped from result table.
- [ ] CSV export fields and encoding verified.

## Requirement-to-Task Coverage Map

- Dual trigger (page button + popup): Tasks 7, 8, 9.
- Scan first 50 contributors: Task 5 (`settings`), Task 6 (`orchestrator`), Task 9 runtime wiring.
- URL search first, activity fallback, commit fallback: Task 4 + Task 6.
- PR global budget = 3, commit max = 3: Task 5 + Task 6.
- Filter `noreply`, first valid email stop: Task 3 + Task 6.
- 429/challenge auto pause and manual resume: Task 5 + Task 9.
- Popup table + CSV export fixed fields: Task 8 + Task 9.
