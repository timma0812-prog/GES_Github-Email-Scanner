import { describe, expect, test, vi } from 'vitest';
import { createOrchestrator } from '../extension/core/orchestrator.js';
import { extractFirstPublicEmail } from '../extension/core/patchExtractor.js';
import { createResolver } from '../extension/core/sourceResolver.js';

describe('integration flow', () => {
  test('resolver + orchestrator finds first public email', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const pages = new Map([
      ['https://github.com/o/r/graphs/contributors', '<a data-hovercard-type="user" href="/alice">A</a>'],
      ['https://github.com/o/r/pulls?q=is%3Apr%20author%3Aalice', '<a href="/o/r/pull/1">PR</a>']
    ]);

    const fetchImpl = async (url) => ({ text: async () => pages.get(url) ?? '' });
    const resolver = createResolver(fetchImpl);

    const fetchPatch = async () => 'From: Alice <alice@example.com>\\n';
    const run = createOrchestrator({ resolver, fetchPatch, extractEmail: extractFirstPublicEmail });

    const result = await run({ owner: 'o', repo: 'r' });
    expect(result.status).toBe('done');
    expect(result.rows).toEqual([
      expect.objectContaining({
        contributor_login: 'alice',
        email: 'alice@example.com',
        source_type: 'PR',
        source_url: 'https://github.com/o/r/pull/1'
      })
    ]);
  });
});
