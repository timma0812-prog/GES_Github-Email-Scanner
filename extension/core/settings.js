export const SCAN_STATE_KEY = 'scan_state';
export const DEFAULT_CONTRIBUTOR_LIMIT = 50;
export const PR_ATTEMPT_BUDGET = 3;
export const COMMIT_ATTEMPT_BUDGET = 3;
export const PROBE_DELAY_MIN_MS = 800;
export const PROBE_DELAY_MAX_MS = 1200;
export const STATE_RETENTION_DAYS = 7;
export const STATE_RETENTION_MS = STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const RISK_MODE_NORMAL = 'normal';
export const RISK_MODE_LOW = 'low';

export const LOW_RISK_DELAY_MIN_MS = 2500;
export const LOW_RISK_DELAY_MAX_MS = 4500;
export const LOW_RISK_LONG_PAUSE_EVERY = 5;
export const LOW_RISK_LONG_PAUSE_MIN_MS = 20000;
export const LOW_RISK_LONG_PAUSE_MAX_MS = 40000;
export const LOW_RISK_BACKOFF_STEP = 0.35;
export const LOW_RISK_BACKOFF_MAX_MULTIPLIER = 2.5;
