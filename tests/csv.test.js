import { describe, expect, test } from 'vitest';
import { serializeRows } from '../extension/core/csv.js';

describe('csv serializer', () => {
  test('writes exact header and escaped row content', () => {
    const csv = serializeRows([
      {
        contributor_login: 'alice,dev',
        email: 'alice"@example.com',
        source_type: 'commit',
        source_url: 'https://github.com/o/r/commit/1',
        extracted_at: '2026-04-09T08:00:00.000Z\nline2'
      }
    ]);

    expect(csv).toBe(
      'contributor_login,email,source_type,source_url,extracted_at\n"alice,dev","alice""@example.com",commit,https://github.com/o/r/commit/1,"2026-04-09T08:00:00.000Z\nline2"'
    );
  });

  test('neutralizes spreadsheet formula payloads', () => {
    const csv = serializeRows([
      {
        contributor_login: '=cmd',
        email: '+alice@example.com',
        source_type: '-PR',
        source_url: '@malicious',
        extracted_at: '2026-04-09T08:00:00.000Z'
      }
    ]);

    expect(csv).toBe(
      "contributor_login,email,source_type,source_url,extracted_at\n'=cmd,'+alice@example.com,'-PR,'@malicious,2026-04-09T08:00:00.000Z"
    );
  });
});
