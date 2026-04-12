import { afterEach, describe, expect, test, vi } from 'vitest';
import { createOrchestrator } from '../extension/core/orchestrator.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('orchestrator', () => {
  test('continues scanning contributors after first matched contributor but stops probing that contributor', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice', 'bob'],
      getPrCandidates: async (_owner, _repo, login) => (login === 'alice' ? ['alice-pr-1', 'alice-pr-2'] : []),
      getFallbackCandidates: async () => [],
      getCommitCandidates: async (_owner, _repo, login) => (login === 'bob' ? ['bob-c1', 'bob-c2'] : [])
    };

    const fetchPatch = vi.fn(async (url) => {
      if (url === 'alice-pr-1') return 'From: Alice <alice@example.com>\\n';
      if (url === 'bob-c1') return 'From: Bob <bob@example.com>\\n';
      return 'From: No <noreply@github.com>\\n';
    });
    const extractEmail = vi.fn((text) => text.match(/<([^>]+)>/)?.[1] ?? null);

    const run = createOrchestrator({ resolver, fetchPatch, extractEmail });
    const result = await run({ owner: 'o', repo: 'r' });

    expect(result.status).toBe('done');
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.contributor_login)).toEqual(['alice', 'bob']);
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(['alice-pr-1', 'bob-c1']);
  });

  test('stops at first valid email and adds timestamp', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: async () => ['https://github.com/o/r/pull/1'],
      getFallbackCandidates: async () => ['https://github.com/o/r/pull/2'],
      getCommitCandidates: async () => ['https://github.com/o/r/commit/a']
    };

    const fetchPatch = vi.fn().mockResolvedValue('From: A <a@example.com>\\n');
    const extractEmail = vi.fn().mockReturnValue('a@example.com');

    const run = createOrchestrator({ resolver, fetchPatch, extractEmail });
    const result = await run({ owner: 'o', repo: 'r' });

    expect(result.status).toBe('done');
    expect(result.rows).toHaveLength(1);
    expect(result.totalTargets).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.currentContributor).toBeNull();
    expect(result.rows[0]).toMatchObject({
      contributor_login: 'alice',
      email: 'a@example.com',
      source_type: 'PR',
      source_url: 'https://github.com/o/r/pull/1'
    });
    expect(new Date(result.rows[0].extracted_at).toISOString()).toBe(result.rows[0].extracted_at);
  });

  test('respects PR and commit budgets while scanning all contributors', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice', 'bob'],
      getPrCandidates: async (_owner, _repo, login) => [`${login}-p1`, `${login}-p2`],
      getFallbackCandidates: async (_owner, _repo, login) => [`${login}-p3`, `${login}-p4`],
      getCommitCandidates: async (_owner, _repo, login) => [`${login}-c1`, `${login}-c2`, `${login}-c3`, `${login}-c4`]
    };

    const fetchPatch = vi.fn().mockResolvedValue('From: N <noreply@github.com>\\n');
    const extractEmail = vi.fn().mockReturnValue(null);
    const run = createOrchestrator({ resolver, fetchPatch, extractEmail });

    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.rows).toHaveLength(0);
    expect(fetchPatch).toHaveBeenCalledTimes(12);
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual([
      'alice-p1',
      'alice-p2',
      'alice-p3',
      'alice-c1',
      'alice-c2',
      'alice-c3',
      'bob-p1',
      'bob-p2',
      'bob-p3',
      'bob-c1',
      'bob-c2',
      'bob-c3'
    ]);
  });

  test('enforces pr budget of 3 and commit budget of 3', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: async () => ['p1', 'p2'],
      getFallbackCandidates: async () => ['p3', 'p4'],
      getCommitCandidates: async () => ['c1', 'c2', 'c3', 'c4']
    };

    const fetchPatch = vi.fn().mockResolvedValue('From: A <noreply@github.com>\\n');
    const extractEmail = vi.fn().mockReturnValue(null);
    const run = createOrchestrator({ resolver, fetchPatch, extractEmail });

    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.rows).toHaveLength(0);
    expect(fetchPatch).toHaveBeenCalledTimes(6);
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2', 'p3', 'c1', 'c2', 'c3']);
  });

  test('pauses with nextIndex when pause reason is present', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice', 'bob'],
      getPrCandidates: async () => ['p1'],
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const fetchPatch = vi.fn().mockResolvedValue('From: A <noreply@github.com>\\n');
    const extractEmail = vi.fn().mockReturnValue(null);
    const shouldPause = ({ login }) => (login === 'bob' ? 'manual_pause' : null);

    const run = createOrchestrator({ resolver, fetchPatch, extractEmail, shouldPause });
    const result = await run({ owner: 'o', repo: 'r' });

    expect(result.status).toBe('paused');
    expect(result.reason).toBe('manual_pause');
    expect(result.nextIndex).toBe(1);
    expect(result.totalTargets).toBe(2);
    expect(result.processed).toBe(1);
    expect(result.currentContributor).toBe('bob');
  });

  test('pauses mid-contributor before next delayed probe when manual pause triggers', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    let pause = false;
    let releaseFirstProbe;
    const firstProbeGate = new Promise((resolve) => {
      releaseFirstProbe = resolve;
    });
    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: async () => ['p1', 'p2'],
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const fetchPatch = vi
      .fn(async (url) => {
        if (url === 'p1') return firstProbeGate;
        return 'From: A <a@example.com>\\n';
      });
    const extractEmail = vi.fn((text) => (text.includes('a@example.com') ? 'a@example.com' : null));
    const shouldPause = () => (pause ? 'manual_pause' : null);

    const run = createOrchestrator({ resolver, fetchPatch, extractEmail, shouldPause });
    const pending = run({ owner: 'o', repo: 'r' });

    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();
    expect(fetchPatch).toHaveBeenCalledTimes(1);

    pause = true;
    releaseFirstProbe('From: A <noreply@github.com>\\n');
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.status).toBe('paused');
    expect(result.reason).toBe('manual_pause');
    expect(result.nextIndex).toBe(0);
    expect(fetchPatch).toHaveBeenCalledTimes(1);
  });

  test('waits 800-1200ms before each probe', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: async () => ['p1'],
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const fetchPatch = vi.fn().mockResolvedValue('From: A <a@example.com>\\n');
    const extractEmail = vi.fn().mockReturnValue('a@example.com');
    const run = createOrchestrator({ resolver, fetchPatch, extractEmail });

    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    await pending;

    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((v) => typeof v === 'number');
    expect(delays.some((ms) => ms >= 800 && ms <= 1200)).toBe(true);
  });

  test('applies jitter delay to discovery fetch phases', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: async () => [],
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };
    const run = createOrchestrator({
      resolver,
      fetchPatch: vi.fn(async () => ''),
      extractEmail: vi.fn(() => null)
    });

    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    await pending;

    const numericDelays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((v) => typeof v === 'number');
    expect(numericDelays.length).toBeGreaterThanOrEqual(3);
    expect(numericDelays.filter((ms) => ms >= 800 && ms <= 1200).length).toBeGreaterThanOrEqual(3);
  });

  test('requests first 50 contributors by default', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const resolver = {
      getContributors: vi.fn(async () => []),
      getPrCandidates: vi.fn(async () => []),
      getFallbackCandidates: vi.fn(async () => []),
      getCommitCandidates: vi.fn(async () => [])
    };

    const run = createOrchestrator({
      resolver,
      fetchPatch: vi.fn(async () => ''),
      extractEmail: vi.fn(() => null)
    });
    await run({ owner: 'o', repo: 'r' });

    expect(resolver.getContributors).toHaveBeenCalledWith('o', 'r', 50);
  });

  test('does not fetch fallback or commits when primary PR already matches', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: vi.fn(async () => ['p1']),
      getFallbackCandidates: vi.fn(async () => ['fp1']),
      getCommitCandidates: vi.fn(async () => ['c1'])
    };
    const run = createOrchestrator({
      resolver,
      fetchPatch: vi.fn(async () => 'From: A <a@example.com>\\n'),
      extractEmail: vi.fn(() => 'a@example.com')
    });

    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.status).toBe('done');
    expect(resolver.getFallbackCandidates).not.toHaveBeenCalled();
    expect(resolver.getCommitCandidates).not.toHaveBeenCalled();
  });

  test('fetches fallback only after primary probing completes with no match', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    let releasePrimaryProbe;
    const primaryProbeGate = new Promise((resolve) => {
      releasePrimaryProbe = resolve;
    });
    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: vi.fn(async () => ['p1']),
      getFallbackCandidates: vi.fn(async () => ['fp1']),
      getCommitCandidates: vi.fn(async () => [])
    };
    const fetchPatch = vi.fn(async (url) => {
      if (url === 'p1') return primaryProbeGate;
      return 'From: F <fallback@example.com>\\n';
    });
    const run = createOrchestrator({
      resolver,
      fetchPatch,
      extractEmail: vi.fn((text) => (text.includes('fallback@example.com') ? 'fallback@example.com' : null))
    });

    const pending = run({ owner: 'o', repo: 'r' });
    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();
    expect(fetchPatch).toHaveBeenCalledWith('p1');
    expect(resolver.getFallbackCandidates).not.toHaveBeenCalled();

    releasePrimaryProbe('From: A <noreply@github.com>\\n');
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(resolver.getFallbackCandidates).toHaveBeenCalledTimes(1);
    expect(result.rows[0]).toMatchObject({
      contributor_login: 'alice',
      source_type: 'PR',
      source_url: 'fp1'
    });
  });

  test('processes contributors serially and starts N+1 only after N completes', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    let releaseAliceProbe;
    const aliceProbeGate = new Promise((resolve) => {
      releaseAliceProbe = resolve;
    });
    const log = [];

    const resolver = {
      getContributors: async () => ['alice', 'bob'],
      getPrCandidates: async (_owner, _repo, login) => (login === 'alice' ? ['alice-p1'] : ['bob-p1']),
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const fetchPatch = vi.fn(async (url) => {
      log.push(`start:${url}`);
      if (url === 'alice-p1') {
        const result = await aliceProbeGate;
        log.push(`end:${url}`);
        return result;
      }
      log.push(`end:${url}`);
      return 'From: B <noreply@github.com>\\n';
    });
    const extractEmail = vi.fn(() => null);

    const run = createOrchestrator({ resolver, fetchPatch, extractEmail });
    const pending = run({ owner: 'o', repo: 'r' });
    await vi.advanceTimersByTimeAsync(1600);
    await Promise.resolve();

    expect(log).toEqual(['start:alice-p1']);

    releaseAliceProbe('From: A <noreply@github.com>\\n');
    await vi.runAllTimersAsync();
    await pending;

    expect(log).toEqual(['start:alice-p1', 'end:alice-p1', 'start:bob-p1', 'end:bob-p1']);
  });

  test('continues probing next candidate when patch fetch throws', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: async () => ['p1', 'p2'],
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const fetchPatch = vi.fn(async (url) => {
      if (url === 'p1') throw new Error('network');
      return 'From: A <a@example.com>\\n';
    });
    const extractEmail = vi.fn((text) => text.match(/<([^>]+)>/)?.[1] ?? null);
    const run = createOrchestrator({ resolver, fetchPatch, extractEmail });
    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2']);
    expect(result.rows).toEqual([
      expect.objectContaining({
        contributor_login: 'alice',
        email: 'a@example.com',
        source_type: 'PR',
        source_url: 'p2'
      })
    ]);
  });

  test('row schema matches contract keys', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice'],
      getPrCandidates: async () => ['https://github.com/o/r/pull/7'],
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const run = createOrchestrator({
      resolver,
      fetchPatch: vi.fn(async () => 'From: A <a@example.com>\\n'),
      extractEmail: vi.fn(() => 'a@example.com')
    });
    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(Object.keys(result.rows[0]).sort()).toEqual([
      'contributor_login',
      'email',
      'extracted_at',
      'source_type',
      'source_url'
    ]);
  });

  test('continues to next contributor when resolver throws for current contributor path', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const resolver = {
      getContributors: async () => ['alice', 'bob'],
      getPrCandidates: async (_owner, _repo, login) => {
        if (login === 'alice') throw new Error('resolver temporary failure');
        return ['https://github.com/o/r/pull/2'];
      },
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const run = createOrchestrator({
      resolver,
      fetchPatch: vi.fn(async () => 'From: B <bob@example.com>\\n'),
      extractEmail: vi.fn(() => 'bob@example.com')
    });

    const pending = run({ owner: 'o', repo: 'r' });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.status).toBe('done');
    expect(result.rows).toEqual([
      expect.objectContaining({ contributor_login: 'bob', email: 'bob@example.com' })
    ]);
  });

  test('uses low-risk mode delays and periodic long pause', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const resolver = {
      getContributors: async () => ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'],
      getPrCandidates: async () => [],
      getFallbackCandidates: async () => [],
      getCommitCandidates: async () => []
    };

    const run = createOrchestrator({
      resolver,
      fetchPatch: vi.fn(async () => ''),
      extractEmail: vi.fn(() => null)
    });

    const pending = run({ owner: 'o', repo: 'r', riskMode: 'low' });
    await vi.runAllTimersAsync();
    await pending;

    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((v) => typeof v === 'number');
    expect(delays.some((ms) => ms >= 2500 && ms <= 4500)).toBe(true);
    expect(delays.some((ms) => ms >= 20000 && ms <= 40000)).toBe(true);
  });
});
