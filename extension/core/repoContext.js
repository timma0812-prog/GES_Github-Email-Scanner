export function parseRepoFromUrl(url) {
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname !== 'github.com') return null;
  if (parsed.protocol !== 'https:') return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repo] = parts;
  const reservedRoots = new Set([
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
  const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  const repoPattern = /^[A-Za-z0-9._-]+$/;

  if (!owner || !repo) return null;
  if (reservedRoots.has(owner.toLowerCase())) return null;
  if (!ownerPattern.test(owner)) return null;
  if (!repoPattern.test(repo)) return null;
  if (repo.endsWith('.git')) return null;

  return { owner, repo, fullName: `${owner}/${repo}` };
}
