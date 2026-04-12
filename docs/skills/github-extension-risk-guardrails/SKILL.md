---
name: github-extension-risk-guardrails
description: Use when building or modifying Chrome/Edge extensions that scrape public web pages and export data, especially when you need anti-risk controls for compliance, abuse prevention, data safety, and stable MV3 behavior.
---

# GitHub Extension Risk Guardrails

## Overview
A practical checklist for browser extensions that collect public GitHub data via page scraping/URL stitching (no API). Goal: keep behavior compliant, low-risk, and regression-safe.

## When to Use
- Adding scanning/crawling behavior
- Adding export/storage features
- Changing content scripts or `chrome.scripting.executeScript`
- Addressing account verification/rate-limit issues

## Core Guardrails
1. Public-only collection: only parse publicly visible HTML/patch content.
2. Human-stop control: detect verification/challenge pages and pause immediately.
3. Request pacing: serial requests + jitter; add low-risk mode with slower intervals.
4. Scan mutual exclusion: block parallel scans in background worker.
5. CSV safety: neutralize formula payloads (`= + - @`) before export.
6. Data minimization: keep only needed fields; set local storage retention TTL.
7. Execution isolation: avoid `world: 'MAIN'` unless strictly necessary.
8. Parser precision: ignore reserved GitHub root paths (`/settings`, `/features`, etc.).
9. Safe fallback order: PR candidates first, then commit candidates with bounded budgets.

## Verification Checklist
- Unit tests for: concurrency lock, CSV injection defense, retention expiry, resolver filtering.
- Integration test for end-to-end scan + first non-noreply hit.
- Manual check on real repo:
  1. Contributors count reaches configured limit (e.g., 50)
  2. Verification page triggers pause state
  3. CSV opens safely in Excel/Sheets

## Common Mistakes
- Treating content script as ES module directly in MV3 `content_scripts`
- Over-aggressive parallel requests causing fast verification challenges
- Leaving extracted emails in storage forever
