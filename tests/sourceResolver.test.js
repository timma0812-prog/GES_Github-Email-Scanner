import { describe, expect, test } from 'vitest';
import {
  buildCommitSearchUrl,
  buildPrSearchUrl,
  createResolver,
  parseActivityFallbackUrls,
  parseCommitUrlsFromHtml,
  parseContributorLoginsFromHtml,
  parsePrUrlsFromHtml,
  toPatchUrl
} from '../extension/core/sourceResolver.js';

describe('sourceResolver', () => {
  test('builds search URLs', () => {
    expect(buildPrSearchUrl('o', 'r', 'dev user')).toContain('is%3Apr');
    expect(buildPrSearchUrl('o', 'r', 'dev user')).toContain('author%3Adev%20user');
    expect(buildCommitSearchUrl('o', 'r', 'dev')).toBe('https://github.com/o/r/commits?author=dev');
  });

  test('converts github urls to patch urls', () => {
    expect(toPatchUrl('https://github.com/o/r/pull/12')).toBe('https://patch-diff.githubusercontent.com/raw/o/r/pull/12.patch');
    expect(toPatchUrl('https://github.com/o/r/commit/abc123')).toBe('https://patch-diff.githubusercontent.com/raw/o/r/commit/abc123.patch');
  });

  test('parses PR and commit urls', () => {
    const html = [
      '<a href="/o/r/pull/1">PR</a>',
      '<a href="https://github.com/o/r/pull/2">PR2</a>',
      '<a href="/o/r/commit/abc">C1</a>'
    ].join('');

    expect(parsePrUrlsFromHtml(html, 'o', 'r')).toEqual([
      'https://github.com/o/r/pull/1',
      'https://github.com/o/r/pull/2'
    ]);

    expect(parseCommitUrlsFromHtml(html, 'o', 'r')).toEqual([
      'https://github.com/o/r/commit/abc'
    ]);
  });

  test('parses activity fallback urls', () => {
    const html = '<a href="/o/r/pull/5">PR5</a><a href="/o/r/commit/xyz">CXYZ</a>';
    expect(parseActivityFallbackUrls(html, 'o', 'r')).toEqual({
      prs: ['https://github.com/o/r/pull/5'],
      commits: ['https://github.com/o/r/commit/xyz']
    });
  });

  test('parses contributor logins with limit', () => {
    const html = [
      '<a data-hovercard-type="user" href="/alice">A</a>',
      '<a data-hovercard-type="user" href="/bob">B</a>',
      '<a data-hovercard-type="user" href="/carol">C</a>'
    ].join('');

    expect(parseContributorLoginsFromHtml(html, 2)).toEqual(['alice', 'bob']);
  });

  test('parses contributor logins from absolute github profile links', () => {
    const html = [
      '<a href="https://github.com/alice" data-hovercard-type="user"><img alt="@alice" /></a>',
      '<a href="https://github.com/apps/copilot-pull-request-reviewer"><img alt="@Copilot" /></a>',
      '<a href="https://github.com/bob" data-hovercard-type="user"><img alt="@bob" /></a>'
    ].join('');

    expect(parseContributorLoginsFromHtml(html, 50)).toEqual(['alice', 'bob']);
  });

  test('ignores reserved github root paths that are not user logins', () => {
    const html = [
      '<a data-hovercard-type="user" href="/features">F</a>',
      '<a data-hovercard-type="user" href="/alice">A</a>',
      '<a data-hovercard-type="user" href="https://github.com/settings">S</a>'
    ].join('');

    expect(parseContributorLoginsFromHtml(html, 10)).toEqual(['alice']);
  });

  test('resolver fetches contributors and candidates', async () => {
    const currentYear = new Date().getFullYear();
    const calls = [];
    const pages = new Map([
      ['https://github.com/o/r/contributors_list?current_repository=r&deferred=true', '<a data-hovercard-type="user" href="https://github.com/alice">A</a>'],
      [buildPrSearchUrl('o', 'r', 'alice'), '<a href="/o/r/pull/1">P</a>'],
      [buildCommitSearchUrl('o', 'r', 'alice'), '<a href="/o/r/commit/abc">C</a>'],
      [`https://github.com/alice?tab=overview&from=${currentYear}-01-01&to=${currentYear}-12-31`, '<a href="/o/r/pull/3">P3</a><a href="/o/r/commit/fallback1">CF1</a>']
    ]);

    const fetchImpl = async (url) => {
      calls.push(url);
      return { text: async () => pages.get(url) ?? '' };
    };

    const resolver = createResolver(fetchImpl);

    expect(await resolver.getContributors('o', 'r', 10)).toEqual(['alice']);
    expect(await resolver.getPrCandidates('o', 'r', 'alice')).toEqual(['https://github.com/o/r/pull/1']);
    expect(await resolver.getCommitCandidates('o', 'r', 'alice')).toEqual([
      'https://github.com/o/r/commit/fallback1',
      'https://github.com/o/r/commit/abc'
    ]);
    expect(await resolver.getFallbackCandidates('o', 'r', 'alice')).toEqual([
      'https://github.com/o/r/pull/3'
    ]);
    expect(calls.some((url) => url.includes('/issues?q='))).toBe(false);
  });

  test('resolver surfaces pause reason when challenge page is detected', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('/pulls?')) {
        return {
          status: 200,
          text: async () => '<html><title>Verify you are human</title></html>'
        };
      }
      return { status: 200, text: async () => '' };
    };

    const resolver = createResolver(fetchImpl);
    const result = await resolver.getPrCandidates('o', 'r', 'alice');
    expect(result).toEqual({ pauseReason: 'challenge_detected' });
  });

  test('resolver does not flag octocaptcha feature flag as challenge', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('/contributors_list?')) {
        return {
          status: 200,
          text: async () => '<script>window.__flags=["octocaptcha_origin_optimization"];</script><a data-hovercard-type="user" href="/alice">A</a>'
        };
      }
      return { status: 200, text: async () => '' };
    };

    const resolver = createResolver(fetchImpl);
    const result = await resolver.getContributors('o', 'r', 10);
    expect(result).toEqual(['alice']);
  });

  test('getContributors merges multiple sources up to limit', async () => {
    const makeLinks = (prefix, count) => Array.from(
      { length: count },
      (_, i) => `<a data-hovercard-type="user" href="https://github.com/${prefix}${i + 1}">${prefix}${i + 1}</a>`
    ).join('');

    const pages = new Map([
      ['https://github.com/o/r/contributors_list?current_repository=r&deferred=true', makeLinks('f', 11)],
      ['https://github.com/o/r/graphs/contributors', makeLinks('g', 40)],
      ['https://github.com/o/r/contributors', makeLinks('c', 40)]
    ]);

    const fetchImpl = async (url) => ({
      status: 200,
      text: async () => pages.get(url) ?? ''
    });
    const resolver = createResolver(fetchImpl);
    const result = await resolver.getContributors('o', 'r', 50);

    expect(result).toHaveLength(50);
    expect(result[0]).toBe('f1');
    expect(result[10]).toBe('f11');
    expect(result[11]).toBe('g1');
  });

  test('commit candidate discovery fetches serially (no parallel network steps)', async () => {
    const currentYear = new Date().getFullYear();
    const activityUrl = `https://github.com/alice?tab=overview&from=${currentYear}-01-01&to=${currentYear}-12-31`;
    const searchUrl = buildCommitSearchUrl('o', 'r', 'alice');
    const pages = new Map([
      [activityUrl, '<a href="/o/r/commit/fallback1">CF1</a>'],
      [searchUrl, '<a href="/o/r/commit/search1">CS1</a>']
    ]);
    let inFlight = 0;
    let maxInFlight = 0;

    const fetchImpl = async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return { text: async () => pages.get(url) ?? '' };
    };

    const resolver = createResolver(fetchImpl);
    const result = await resolver.getCommitCandidates('o', 'r', 'alice');

    expect(result).toEqual(['https://github.com/o/r/commit/fallback1', 'https://github.com/o/r/commit/search1']);
    expect(maxInFlight).toBe(1);
  });
});
