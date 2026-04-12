# GitHub Contributor Public Email Extractor Extension - Design Spec

Date: 2026-04-09
Status: Draft Approved in Conversation, Self-Reviewed
Target Platform: Chrome/Edge Extension (Manifest V3)
Language: Chinese-first UX

## 1. Background

Current manual workflow to get contributor emails is high-effort:
- Open repository page and locate contributors
- Enter contributor profile and find contribution activity
- Locate PR/commit, open details page
- Append `.patch` to URL
- Parse patch header for email

Goal: automate this workflow while only using publicly available GitHub web pages and patch text, without calling GitHub API.

## 2. Goals and Non-Goals

### 2.1 Goals
- Build a Chrome/Edge extension that automates extraction of contributor public emails.
- Default scan scope: first 50 contributors of a repository.
- For each contributor:
  - Try up to 3 PR candidates first.
  - If no valid email, fallback to up to 3 commit candidates.
  - Stop immediately after first non-`noreply` email is found.
- Output in popup table and one-click CSV export.
- Output fields fixed to:
  - `contributor_login`
  - `email`
  - `source_type` (`PR` or `commit`)
  - `source_url`
  - `extracted_at`
- Exclude contributors with no valid email (skip, do not show in results).

### 2.2 Non-Goals
- No private data collection.
- No GitHub API usage.
- No bypass of authentication/captcha/security mechanisms.
- No bulk scraping beyond configured scope in v1.

## 3. Explicit Constraints (User Confirmed)

- Data source: only public GitHub pages and `.patch` content.
- Filter all `noreply` addresses.
- Extension type: Chrome/Edge MV3.
- Trigger mode: both page-injected start button and popup start button.
- Contributor scope: first 50 from contributors list.
- PR attempts per contributor: max 3, early stop on first valid email.
- Fallback:
  - Primary path: repository URL search path.
  - Secondary path: manual-click-equivalent contributor activity path.
  - Then commit fallback: up to 3 commits in target repository for author.
- PR attempt budget is global per contributor:
  - total PR probes across primary + secondary paths must not exceed 3.
- Rate control: serial execution, random delay `800-1200ms`.
- On `429`/captcha/challenge: auto-pause and allow manual resume.
- If still no valid email: skip contributor.

## 4. High-Level Architecture

## 4.1 Modules

1. `content-script` (Page Injector)
- Inject `Start` button in repository page contributors area.
- Capture repository context (`owner/repo`) from current URL.
- Forward start command to service worker.

2. `popup` (UI + Export)
- Start/stop/resume controls.
- Real-time progress and status.
- Results table display.
- CSV export action.

3. `service-worker` (Orchestrator)
- Owns full scan state machine and task queue.
- Controls throttling, retries, pause/resume.
- Coordinates source resolution and patch extraction.

4. `source-resolver`
- Produces candidate PR/commit URLs via:
  - URL-search-first strategy
  - activity-path fallback strategy
  - commit fallback strategy

5. `patch-extractor`
- Fetch `.patch` text and extract valid email.
- Apply `noreply` filtering and email sanity checks.

6. `result-store`
- Persist task state and result rows in browser storage.
- Support recovery after popup close/reopen.

## 4.2 Design Principle
- Bounded responsibilities per module.
- Fail-local: one contributor failure does not break full run.
- Deterministic ordering with serial queue for stability.

## 5. Data Model

## 5.1 Result Row

```json
{
  "contributor_login": "string",
  "email": "string",
  "source_type": "PR|commit",
  "source_url": "string",
  "extracted_at": "ISO-8601 string"
}
```

## 5.2 Runtime Scan State

```json
{
  "repo": "owner/repo",
  "status": "idle|running|paused|done|error",
  "current_index": 0,
  "total_targets": 50,
  "processed": 0,
  "matched": 0,
  "started_at": "ISO-8601 string",
  "updated_at": "ISO-8601 string",
  "last_error": "string|null"
}
```

## 6. End-to-End Data Flow

1. User starts scan from injected button or popup.
2. Parse repo context from current tab URL.
3. Resolve contributors list page and collect first 50 contributor logins.
4. For each login (serial):
   - Delay random `800-1200ms`.
   - Resolve PR candidates using URL-search-first strategy.
   - Probe PR candidates with a global budget of 3 attempts for this contributor.
   - For each PR candidate attempt:
     - Build `.patch` URL and fetch patch text.
     - Extract and validate email; filter `noreply`.
     - On first valid match: save row and move to next contributor.
   - If no PR match:
     - Use activity-path fallback to find PR candidates.
     - Continue probing only within remaining PR budget.
   - If still no match:
     - Resolve up to 3 commit candidates in repo and test `.patch`.
   - If still none: skip contributor.
5. If `429`/captcha/challenge encountered:
   - Set state to `paused` with reason.
   - Notify user in popup.
   - Resume only when user clicks continue.
6. On completion:
   - Set status `done`.
   - Render table in popup.
   - Allow CSV export.

## 7. URL Composition Strategy

## 7.1 Primary PR Discovery (URL Search First)

Repository PR search URL pattern:
- `https://github.com/{owner}/{repo}/pulls?q=is%3Apr+author%3A{login}`

Candidate PR detail URL:
- `https://github.com/{owner}/{repo}/pull/{number}`

Patch URL:
- `{pr_url}.patch`

## 7.2 Secondary Activity-Path Fallback

Fallback simulates manual behavior:
- Contributor profile activity area
- Find activity entries tied to target repository
- Locate PR or commit links
- Build `.patch` URLs from discovered links

## 7.3 Commit Fallback

Repository commit list filtered by author:
- `https://github.com/{owner}/{repo}/commits?author={login}`

Commit detail URL:
- `https://github.com/{owner}/{repo}/commit/{sha}`

Patch URL:
- `{commit_url}.patch`

## 8. Email Extraction and Filtering Rules

## 8.1 Extraction Sources in Patch Text
- Header `From:` line
- `Co-authored-by:` lines

## 8.2 Regex Candidates
- `^From:\s.*<([^>]+)>`
- `^Co-authored-by:\s.*<([^>]+)>`

Run in multiline mode and collect candidate emails in order.

## 8.3 Validation and Filtering
- Basic email format check.
- Normalize to lowercase for comparison.
- Reject all GitHub noreply patterns, including:
  - domain ends with `noreply.github.com`
  - domain ends with `users.noreply.github.com`
  - or local/domain text contains `noreply` as a safeguard rule
- First valid non-`noreply` email wins for that contributor.

## 9. Error Handling and Resilience

- Network timeout/5xx:
  - retry candidate request up to 2 times
  - if still failing, move to next candidate
- DOM structure drift:
  - dual-selector strategy + URL pattern validation
  - fallback path activation when primary extraction fails
- Pause conditions:
  - HTTP 429
  - challenge/captcha page markers
- Resume behavior:
  - continue from saved contributor index
  - do not restart whole scan by default

## 10. Rate Limiting Strategy

- Global mode: strict serial queue.
- Delay per contributor action: random integer in `[800, 1200]` milliseconds.
- No parallel contributor processing in v1.

## 11. UI and UX Requirements

## 11.1 Page Injection
- Add `Start` button near contributors area on repository page.
- Visual state while running: disabled button + "Scanning..." label.

## 11.2 Popup
- Start / pause / resume controls.
- Progress:
  - total targets
  - processed
  - matched
  - current contributor
- Status banners:
  - running
  - paused (with reason)
  - done
- Results table with fixed columns.
- CSV export button.

## 12. CSV Export Specification

- Filename pattern:
  - `{owner}_{repo}_emails_{YYYYMMDD_HHmmss}.csv`
- Encoding:
  - UTF-8 with BOM for spreadsheet compatibility
- Header exactly:
  - `contributor_login,email,source_type,source_url,extracted_at`
- Rows:
  - one row per matched contributor only

## 13. Security, Compliance, and Risk Boundaries

- Collect only already public data.
- Do not attempt to access private repositories or hidden emails.
- Respect manual verification gates (no bypass).
- User responsibility:
  - use data in compliance with applicable laws, platform terms, and anti-spam policies.

## 14. Test and Acceptance Criteria

## 14.1 Functional Acceptance
- On a public repository, extension scans 50 contributors and outputs only valid non-`noreply` matches.
- CSV export works and matches popup rows.

## 14.2 Path Priority Acceptance
- Case A: URL-search path succeeds.
- Case B: URL-search fails and activity fallback succeeds.
- Case C: PR attempts fail and commit fallback succeeds.

## 14.3 Rule Acceptance
- `noreply` addresses are always excluded.
- Early stop works after first valid email per contributor.

## 14.4 Resilience Acceptance
- Simulated timeout/5xx triggers retry and continuation.
- Simulated 429/challenge pauses and resumes correctly.
- Closing/reopening popup does not lose scan state.

## 15. Implementation Readiness Checklist

- Scope is bounded to v1 requirements.
- Data fields and export format are fixed.
- Fallback hierarchy is explicit.
- Pause/resume behavior is explicit.
- Success criteria are testable.
