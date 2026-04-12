function unique(items) {
  return [...new Set(items)];
}

const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_RESERVED_ROOTS = new Set([
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

function parseAnchors(html) {
  const text = String(html ?? '');
  const anchors = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match = re.exec(text);
  while (match) {
    anchors.push(match[1]);
    match = re.exec(text);
  }
  return anchors;
}

function normalizeGithubUrl(href) {
  if (!href) return null;
  if (href.startsWith('/')) return `https://github.com${href}`;
  if (href.startsWith('https://github.com/')) return href;
  return null;
}

function parseUrlsByKind(html, owner, repo, kind) {
  const prefix = `https://github.com/${owner}/${repo}/${kind}/`;
  return unique(
    parseAnchors(html)
      .map(normalizeGithubUrl)
      .filter(Boolean)
      .filter((url) => url.startsWith(prefix))
      .map((url) => url.replace(/[#?].*$/, ''))
  );
}

export function buildPrSearchUrl(owner, repo, login) {
  const q = encodeURIComponent(`is:pr author:${login}`);
  return `https://github.com/${owner}/${repo}/pulls?q=${q}`;
}

export function buildCommitSearchUrl(owner, repo, login) {
  return `https://github.com/${owner}/${repo}/commits?author=${encodeURIComponent(login)}`;
}

export function toPatchUrl(url) {
  if (!url) return url;
  if (url.startsWith('https://patch-diff.githubusercontent.com/')) return url;

  const commitMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([^/?#]+)/);
  if (commitMatch) {
    return `https://patch-diff.githubusercontent.com/raw/${commitMatch[1]}/${commitMatch[2]}/commit/${commitMatch[3]}.patch`;
  }

  const prMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([^/?#]+)/);
  if (prMatch) {
    return `https://patch-diff.githubusercontent.com/raw/${prMatch[1]}/${prMatch[2]}/pull/${prMatch[3]}.patch`;
  }

  return url;
}

export function parsePrUrlsFromHtml(html, owner, repo) {
  return parseUrlsByKind(html, owner, repo, 'pull');
}

export function parseCommitUrlsFromHtml(html, owner, repo) {
  return parseUrlsByKind(html, owner, repo, 'commit');
}

export function parseActivityFallbackUrls(html, owner, repo) {
  return {
    prs: parsePrUrlsFromHtml(html, owner, repo),
    commits: parseCommitUrlsFromHtml(html, owner, repo)
  };
}

export function parseContributorLoginsFromHtml(html, limit = 30) {
  const out = [];
  const seen = new Set();
  const text = String(html ?? '');
  const re = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match = re.exec(text);

  while (match && out.length < limit) {
    const attrs = `${match[1]} ${match[3]}`;
    const innerHtml = match[4] ?? '';
    const href = match[2] ?? '';
    const login = extractGithubProfileLogin(href);
    const isUser = /data-hovercard-type=["']user["']/i.test(attrs) || /alt=["']@[^"']+["']/i.test(innerHtml);

    if (login && isUser && !seen.has(login)) {
      seen.add(login);
      out.push(login);
    }

    match = re.exec(text);
  }

  return out;
}

function extractGithubProfileLogin(href) {
  const value = String(href ?? '').trim();
  const relative = value.match(/^\/([^/?#]+)\/?$/);
  if (relative) {
    const login = relative[1];
    if (GITHUB_RESERVED_ROOTS.has(login.toLowerCase())) return null;
    return GITHUB_LOGIN_RE.test(login) ? login : null;
  }

  const absolute = value.match(/^https:\/\/github\.com\/([^/?#]+)\/?$/i);
  if (absolute) {
    const login = absolute[1];
    if (GITHUB_RESERVED_ROOTS.has(login.toLowerCase())) return null;
    return GITHUB_LOGIN_RE.test(login) ? login : null;
  }

  return null;
}

export function createResolver(fetchImpl = fetch) {
  function detectPauseReason(status, html) {
    if (status === 429) return 'rate_limit_429';
    const text = String(html ?? '');
    const hasStrongChallengePhrase = /(please\s+verify\s+you\s+are\s+human|verify\s+you\s+are\s+human|are\s+you\s+a\s+human|human\s+verification|captcha\s+challenge|security\s+check)/i.test(text);
    const hasChallengeMarkers = /(g-recaptcha|hcaptcha|challenge-response|\/sessions\/verified-device|name=["']captcha["']|id=["']captcha["'])/i.test(text);
    if (hasStrongChallengePhrase || hasChallengeMarkers || (status === 403 && /(captcha|challenge|verify|human)/i.test(text))) {
      return 'challenge_detected';
    }
    return null;
  }

  function buildActivityOverviewUrl(login) {
    const year = new Date().getFullYear();
    return `https://github.com/${login}?tab=overview&from=${year}-01-01&to=${year}-12-31`;
  }

  async function fetchHtml(url) {
    const res = await fetchImpl(url, { credentials: 'include' });
    const html = await res.text();
    const pauseReason = detectPauseReason(res?.status, html);
    if (pauseReason) return { pauseReason };
    return { html };
  }

  return {
    async getContributors(owner, repo, limit = 30) {
      const logins = [];
      const seen = new Set();
      const append = (items) => {
        for (const login of items) {
          if (seen.has(login)) continue;
          seen.add(login);
          logins.push(login);
          if (logins.length >= limit) break;
        }
      };

      const sources = [
        `https://github.com/${owner}/${repo}/contributors_list?current_repository=${encodeURIComponent(repo)}&deferred=true`,
        `https://github.com/${owner}/${repo}/graphs/contributors`,
        `https://github.com/${owner}/${repo}/contributors`
      ];

      for (const sourceUrl of sources) {
        const result = await fetchHtml(sourceUrl);
        if (result.pauseReason) {
          if (logins.length === 0) return result;
          break;
        }
        append(parseContributorLoginsFromHtml(result.html, limit));
        if (logins.length >= limit) break;
      }

      return logins.slice(0, limit);
    },

    async getPrCandidates(owner, repo, login) {
      const result = await fetchHtml(buildPrSearchUrl(owner, repo, login));
      if (result.pauseReason) return result;
      return parsePrUrlsFromHtml(result.html, owner, repo);
    },

    async getFallbackCandidates(owner, repo, login) {
      const profileUrl = buildActivityOverviewUrl(login);

      const activityResult = await fetchHtml(profileUrl);
      if (activityResult.pauseReason) return activityResult;
      const activity = parseActivityFallbackUrls(activityResult.html, owner, repo);
      return unique(activity.prs);
    },

    async getCommitCandidates(owner, repo, login) {
      const activityResult = await fetchHtml(buildActivityOverviewUrl(login));
      if (activityResult.pauseReason) return activityResult;
      const searchResult = await fetchHtml(buildCommitSearchUrl(owner, repo, login));
      if (searchResult.pauseReason) return searchResult;
      const activityCommits = parseActivityFallbackUrls(activityResult.html, owner, repo).commits;
      const searchedCommits = parseCommitUrlsFromHtml(searchResult.html, owner, repo);
      return unique([...activityCommits, ...searchedCommits]);
    }
  };
}
