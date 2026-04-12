import {
  COMMIT_ATTEMPT_BUDGET,
  DEFAULT_CONTRIBUTOR_LIMIT,
  LOW_RISK_BACKOFF_MAX_MULTIPLIER,
  LOW_RISK_BACKOFF_STEP,
  LOW_RISK_DELAY_MAX_MS,
  LOW_RISK_DELAY_MIN_MS,
  LOW_RISK_LONG_PAUSE_EVERY,
  LOW_RISK_LONG_PAUSE_MAX_MS,
  LOW_RISK_LONG_PAUSE_MIN_MS,
  PR_ATTEMPT_BUDGET,
  PROBE_DELAY_MAX_MS,
  PROBE_DELAY_MIN_MS,
  RISK_MODE_LOW,
  RISK_MODE_NORMAL
} from './settings.js';

function randomDelayMs(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRiskProfile(riskMode) {
  if (riskMode === RISK_MODE_LOW) {
    return {
      mode: RISK_MODE_LOW,
      discoveryDelayMinMs: LOW_RISK_DELAY_MIN_MS,
      discoveryDelayMaxMs: LOW_RISK_DELAY_MAX_MS,
      probeDelayMinMs: LOW_RISK_DELAY_MIN_MS,
      probeDelayMaxMs: LOW_RISK_DELAY_MAX_MS,
      longPauseEvery: LOW_RISK_LONG_PAUSE_EVERY,
      longPauseMinMs: LOW_RISK_LONG_PAUSE_MIN_MS,
      longPauseMaxMs: LOW_RISK_LONG_PAUSE_MAX_MS,
      adaptiveBackoff: true
    };
  }

  return {
    mode: RISK_MODE_NORMAL,
    discoveryDelayMinMs: PROBE_DELAY_MIN_MS,
    discoveryDelayMaxMs: PROBE_DELAY_MAX_MS,
    probeDelayMinMs: PROBE_DELAY_MIN_MS,
    probeDelayMaxMs: PROBE_DELAY_MAX_MS,
    longPauseEvery: 0,
    longPauseMinMs: 0,
    longPauseMaxMs: 0,
    adaptiveBackoff: false
  };
}

async function delayWithJitter(shouldPause, pauseContext, minMs, maxMs, multiplier = 1) {
  const beforePause = shouldPause(pauseContext);
  if (beforePause) return beforePause;
  const safeMin = Math.max(1, Math.floor(minMs * multiplier));
  const safeMax = Math.max(safeMin, Math.floor(maxMs * multiplier));
  await sleep(randomDelayMs(safeMin, safeMax));
  return shouldPause(pauseContext);
}

async function probeUrls({
  urls,
  fetchPatch,
  extractEmail,
  sourceType,
  shouldPause,
  pauseContext,
  minDelayMs,
  maxDelayMs,
  getBackoffMultiplier,
  onTransientRiskSignal
}) {
  for (const url of urls) {
    const pauseReason = shouldPause(pauseContext);
    if (pauseReason) {
      return { pauseReason };
    }

    await sleep(randomDelayMs(
      Math.max(1, Math.floor(minDelayMs * getBackoffMultiplier())),
      Math.max(Math.floor(minDelayMs * getBackoffMultiplier()), Math.floor(maxDelayMs * getBackoffMultiplier()))
    ));
    let patch;
    try {
      patch = await fetchPatch(url);
    } catch {
      onTransientRiskSignal();
      continue;
    }

    if (patch?.pauseReason) {
      return { pauseReason: patch.pauseReason };
    }

    const patchText = typeof patch === 'string' ? patch : patch?.text ?? '';
    const email = extractEmail(patchText);
    if (email) return { email, sourceType, sourceUrl: url };
  }

  return { email: null };
}

function appendRow(rows, login, result) {
  rows.push({
    contributor_login: login,
    email: result.email,
    source_type: result.sourceType,
    source_url: result.sourceUrl,
    extracted_at: new Date().toISOString()
  });
}

export function createOrchestrator({
  resolver,
  fetchPatch,
  extractEmail,
  shouldPause = () => null,
  onProgress = () => {}
}) {
  async function resolveCandidates(getter, owner, repo, login, onTransientRiskSignal) {
    try {
      return await getter(owner, repo, login);
    } catch {
      onTransientRiskSignal();
      return [];
    }
  }

  return async function run({ owner, repo, startIndex = 0, rows = [], riskMode = RISK_MODE_NORMAL }) {
    const riskProfile = getRiskProfile(riskMode);
    let backoffMultiplier = 1;
    const getBackoffMultiplier = () => backoffMultiplier;
    const onTransientRiskSignal = () => {
      if (!riskProfile.adaptiveBackoff) return;
      backoffMultiplier = Math.min(
        LOW_RISK_BACKOFF_MAX_MULTIPLIER,
        backoffMultiplier + LOW_RISK_BACKOFF_STEP
      );
    };
    const onSuccessfulContributor = () => {
      if (!riskProfile.adaptiveBackoff) return;
      backoffMultiplier = Math.max(1, backoffMultiplier - LOW_RISK_BACKOFF_STEP);
    };

    const contributorsResult = await resolver.getContributors(owner, repo, DEFAULT_CONTRIBUTOR_LIMIT);
    if (contributorsResult?.pauseReason) {
      return {
        status: 'paused',
        reason: contributorsResult.pauseReason,
        nextIndex: startIndex,
        rows,
        totalTargets: 0,
        processed: startIndex,
        matched: rows.length,
        currentContributor: null,
        riskMode: riskProfile.mode
      };
    }
    const contributors = Array.isArray(contributorsResult) ? contributorsResult : [];
    const totalTargets = contributors.length;

    function emitProgress(payload) {
      try {
        onProgress(payload);
      } catch {
        // ignore progress sink failures
      }
    }

    function withProgress(result, processed, currentContributor = null) {
      return {
        ...result,
        totalTargets,
        processed,
        matched: rows.length,
        currentContributor,
        riskMode: riskProfile.mode
      };
    }

    emitProgress(withProgress({ status: 'running', reason: null, nextIndex: startIndex, rows }, startIndex, contributors[startIndex] ?? null));

    for (let i = startIndex; i < contributors.length; i += 1) {
      const login = contributors[i];
      const pauseReason = shouldPause({ owner, repo, login, index: i, rows });
      if (pauseReason) {
        return withProgress({ status: 'paused', reason: pauseReason, nextIndex: i, rows }, i, login);
      }
      emitProgress(withProgress({ status: 'running', reason: null, nextIndex: i, rows }, i, login));

      const beforePrimaryDiscoveryPause = await delayWithJitter(
        shouldPause,
        { owner, repo, login, index: i, rows },
        riskProfile.discoveryDelayMinMs,
        riskProfile.discoveryDelayMaxMs,
        getBackoffMultiplier()
      );
      if (beforePrimaryDiscoveryPause) {
        return withProgress({ status: 'paused', reason: beforePrimaryDiscoveryPause, nextIndex: i, rows }, i, login);
      }

      const primaryPrsResult = await resolveCandidates(
        resolver.getPrCandidates,
        owner,
        repo,
        login,
        onTransientRiskSignal
      );
      if (primaryPrsResult?.pauseReason) {
        return withProgress({ status: 'paused', reason: primaryPrsResult.pauseReason, nextIndex: i, rows }, i, login);
      }
      const primaryPrs = Array.isArray(primaryPrsResult) ? primaryPrsResult : [];
      const pauseContext = { owner, repo, login, index: i, rows };
      const primaryPrResult = await probeUrls({
        urls: primaryPrs.slice(0, PR_ATTEMPT_BUDGET),
        fetchPatch,
        extractEmail,
        sourceType: 'PR',
        shouldPause,
        pauseContext,
        minDelayMs: riskProfile.probeDelayMinMs,
        maxDelayMs: riskProfile.probeDelayMaxMs,
        getBackoffMultiplier,
        onTransientRiskSignal
      });

      if (primaryPrResult.pauseReason) {
        return withProgress({ status: 'paused', reason: primaryPrResult.pauseReason, nextIndex: i, rows }, i, login);
      }

      if (primaryPrResult.email) {
        appendRow(rows, login, primaryPrResult);
        onSuccessfulContributor();
        const processedCount = i - startIndex + 1;
        if (riskProfile.longPauseEvery > 0 && i < contributors.length - 1 && processedCount % riskProfile.longPauseEvery === 0) {
          const longPauseReason = await delayWithJitter(
            shouldPause,
            pauseContext,
            riskProfile.longPauseMinMs,
            riskProfile.longPauseMaxMs,
            getBackoffMultiplier()
          );
          if (longPauseReason) {
            return withProgress({ status: 'paused', reason: longPauseReason, nextIndex: i + 1, rows }, i + 1, contributors[i + 1] ?? null);
          }
        }
        continue;
      }

      const beforeFallbackPauseReason = shouldPause(pauseContext);
      if (beforeFallbackPauseReason) {
        return withProgress({ status: 'paused', reason: beforeFallbackPauseReason, nextIndex: i, rows }, i, login);
      }

      const beforeFallbackDiscoveryPause = await delayWithJitter(
        shouldPause,
        { owner, repo, login, index: i, rows },
        riskProfile.discoveryDelayMinMs,
        riskProfile.discoveryDelayMaxMs,
        getBackoffMultiplier()
      );
      if (beforeFallbackDiscoveryPause) {
        return withProgress({ status: 'paused', reason: beforeFallbackDiscoveryPause, nextIndex: i, rows }, i, login);
      }

      const fallbackPrsResult = await resolveCandidates(
        resolver.getFallbackCandidates,
        owner,
        repo,
        login,
        onTransientRiskSignal
      );
      if (fallbackPrsResult?.pauseReason) {
        return withProgress({ status: 'paused', reason: fallbackPrsResult.pauseReason, nextIndex: i, rows }, i, login);
      }
      const fallbackPrs = Array.isArray(fallbackPrsResult) ? fallbackPrsResult : [];
      const fallbackBudget = Math.max(0, PR_ATTEMPT_BUDGET - primaryPrs.slice(0, PR_ATTEMPT_BUDGET).length);
      const fallbackPrResult = await probeUrls({
        urls: fallbackPrs.slice(0, fallbackBudget),
        fetchPatch,
        extractEmail,
        sourceType: 'PR',
        shouldPause,
        pauseContext,
        minDelayMs: riskProfile.probeDelayMinMs,
        maxDelayMs: riskProfile.probeDelayMaxMs,
        getBackoffMultiplier,
        onTransientRiskSignal
      });

      if (fallbackPrResult.pauseReason) {
        return withProgress({ status: 'paused', reason: fallbackPrResult.pauseReason, nextIndex: i, rows }, i, login);
      }

      if (fallbackPrResult.email) {
        appendRow(rows, login, fallbackPrResult);
        onSuccessfulContributor();
        const processedCount = i - startIndex + 1;
        if (riskProfile.longPauseEvery > 0 && i < contributors.length - 1 && processedCount % riskProfile.longPauseEvery === 0) {
          const longPauseReason = await delayWithJitter(
            shouldPause,
            pauseContext,
            riskProfile.longPauseMinMs,
            riskProfile.longPauseMaxMs,
            getBackoffMultiplier()
          );
          if (longPauseReason) {
            return withProgress({ status: 'paused', reason: longPauseReason, nextIndex: i + 1, rows }, i + 1, contributors[i + 1] ?? null);
          }
        }
        continue;
      }

      const beforeCommitPauseReason = shouldPause(pauseContext);
      if (beforeCommitPauseReason) {
        return withProgress({ status: 'paused', reason: beforeCommitPauseReason, nextIndex: i, rows }, i, login);
      }

      const beforeCommitDiscoveryPause = await delayWithJitter(
        shouldPause,
        { owner, repo, login, index: i, rows },
        riskProfile.discoveryDelayMinMs,
        riskProfile.discoveryDelayMaxMs,
        getBackoffMultiplier()
      );
      if (beforeCommitDiscoveryPause) {
        return withProgress({ status: 'paused', reason: beforeCommitDiscoveryPause, nextIndex: i, rows }, i, login);
      }

      const commitUrlsResult = await resolveCandidates(
        resolver.getCommitCandidates,
        owner,
        repo,
        login,
        onTransientRiskSignal
      );
      if (commitUrlsResult?.pauseReason) {
        return withProgress({ status: 'paused', reason: commitUrlsResult.pauseReason, nextIndex: i, rows }, i, login);
      }
      const commitUrls = (Array.isArray(commitUrlsResult) ? commitUrlsResult : []).slice(0, COMMIT_ATTEMPT_BUDGET);
      const commitResult = await probeUrls({
        urls: commitUrls,
        fetchPatch,
        extractEmail,
        sourceType: 'commit',
        shouldPause,
        pauseContext,
        minDelayMs: riskProfile.probeDelayMinMs,
        maxDelayMs: riskProfile.probeDelayMaxMs,
        getBackoffMultiplier,
        onTransientRiskSignal
      });

      if (commitResult.pauseReason) {
        return withProgress({ status: 'paused', reason: commitResult.pauseReason, nextIndex: i, rows }, i, login);
      }

      if (commitResult.email) {
        appendRow(rows, login, commitResult);
        onSuccessfulContributor();
        emitProgress(withProgress({ status: 'running', reason: null, nextIndex: i + 1, rows }, i + 1, contributors[i + 1] ?? null));
        const processedCount = i - startIndex + 1;
        if (riskProfile.longPauseEvery > 0 && i < contributors.length - 1 && processedCount % riskProfile.longPauseEvery === 0) {
          const longPauseReason = await delayWithJitter(
            shouldPause,
            pauseContext,
            riskProfile.longPauseMinMs,
            riskProfile.longPauseMaxMs,
            getBackoffMultiplier()
          );
          if (longPauseReason) {
            return withProgress({ status: 'paused', reason: longPauseReason, nextIndex: i + 1, rows }, i + 1, contributors[i + 1] ?? null);
          }
        }
        continue;
      }

      emitProgress(withProgress({ status: 'running', reason: null, nextIndex: i + 1, rows }, i + 1, contributors[i + 1] ?? null));
      const processedCount = i - startIndex + 1;
      if (riskProfile.longPauseEvery > 0 && i < contributors.length - 1 && processedCount % riskProfile.longPauseEvery === 0) {
        const longPauseReason = await delayWithJitter(
          shouldPause,
          pauseContext,
          riskProfile.longPauseMinMs,
          riskProfile.longPauseMaxMs,
          getBackoffMultiplier()
        );
        if (longPauseReason) {
          return withProgress({ status: 'paused', reason: longPauseReason, nextIndex: i + 1, rows }, i + 1, contributors[i + 1] ?? null);
        }
      }
    }

    return withProgress({ status: 'done', reason: null, nextIndex: null, rows }, totalTargets, null);
  };
}
