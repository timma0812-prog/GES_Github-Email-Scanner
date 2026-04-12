export function jitterDelayMs(min = 800, max = 1200) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function detectPauseReason(status, text = '') {
  if (status === 429) return 'rate_limited';

  const body = String(text);
  const hasStrongChallengePhrase = /(please\s+verify\s+you\s+are\s+human|verify\s+you\s+are\s+human|are\s+you\s+a\s+human|human\s+verification)/i.test(body);
  const hasChallengeMarkers = /(captcha\s+(challenge|verification|required)|g-recaptcha|hcaptcha|challenge-response|\/sessions\/verified-device)/i.test(body);
  if (hasStrongChallengePhrase || hasChallengeMarkers) {
    return 'human_verification';
  }

  return null;
}

export function shouldRetry({ attempt, retries, status, pauseReason, error }) {
  if (pauseReason) return false;
  if (attempt >= retries) return false;
  if (error) return true;
  return typeof status === 'number' && status >= 500;
}

export async function fetchTextWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      const text = await response.text();
      const pauseReason = detectPauseReason(response.status, text);

      if (pauseReason) {
        return { ok: false, status: response.status, text, pauseReason };
      }

      if (response.ok) {
        return { ok: true, status: response.status, text, pauseReason: null };
      }

      if (!shouldRetry({ attempt, retries, status: response.status, pauseReason: null })) {
        return { ok: false, status: response.status, text, pauseReason: null };
      }
    } catch (error) {
      if (!shouldRetry({ attempt, retries, error, pauseReason: null })) {
        throw error;
      }
    }

    await sleep(jitterDelayMs(200, 500));
  }

  return { ok: false, status: 0, text: '', pauseReason: null };
}
