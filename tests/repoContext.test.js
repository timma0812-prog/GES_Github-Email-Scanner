import { describe, expect, test } from 'vitest';
import { parseRepoFromUrl } from '../extension/core/repoContext.js';

describe('parseRepoFromUrl', () => {
  test('parses repo root URL', () => {
    expect(parseRepoFromUrl('https://github.com/octocat/hello-world')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      fullName: 'octocat/hello-world'
    });
  });

  test('parses nested page URL', () => {
    expect(parseRepoFromUrl('https://github.com/octocat/hello-world/pulls')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
      fullName: 'octocat/hello-world'
    });
  });

  test('returns null for invalid GitHub URL', () => {
    expect(parseRepoFromUrl('https://example.com/octocat/hello-world')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/octocat')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/explore/topics')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/marketplace/actions')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/settings/profile')).toBeNull();
    expect(parseRepoFromUrl('http://github.com/octocat/hello-world')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/features/actions')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/topics/javascript')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/octocat/hello-world.git')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/login/device')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/apps/copilot')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/search/advanced')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/notifications/subscriptions')).toBeNull();
  });
});
