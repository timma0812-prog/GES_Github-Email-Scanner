const EMAIL_RE = /<([^<>\s]+@[^<>\s]+)>/gi;

function isNoreplyEmail(email) {
  const normalized = email.toLowerCase();
  return normalized.includes('noreply') || normalized.includes('no-reply');
}

export function extractFirstPublicEmail(patchText) {
  if (!patchText) return null;

  const lines = String(patchText).split(/\r?\n/);
  const candidates = [];

  for (const line of lines) {
    const isInteresting = /^from:/i.test(line) || /^co-authored-by:/i.test(line);
    if (!isInteresting) continue;

    EMAIL_RE.lastIndex = 0;
    let match = EMAIL_RE.exec(line);
    while (match) {
      candidates.push(match[1].trim());
      match = EMAIL_RE.exec(line);
    }
  }

  for (const email of candidates) {
    if (!isNoreplyEmail(email)) return email;
  }

  return null;
}
