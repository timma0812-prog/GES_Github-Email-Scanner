import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MSG_GET_STATE,
  MSG_PAUSE_SCAN,
  MSG_RESUME_SCAN,
  MSG_SET_COMPLIANCE_CONFIRM,
  MSG_SET_RISK_MODE,
  MSG_START_SCAN,
  MSG_START_SCAN_FROM_PAGE
} from '../extension/shared/messages.js';

describe('bootstrap', () => {
  test('manifest includes required permissions and host permissions', () => {
    const raw = readFileSync(join(process.cwd(), 'extension/manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['storage', 'tabs', 'scripting']));
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        'https://github.com/*',
        'https://patch-diff.githubusercontent.com/*'
      ])
    );
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(manifest.content_scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matches: expect.arrayContaining(['https://github.com/*']),
          js: expect.arrayContaining(['content.runtime.js'])
        })
      ])
    );
  });

  test('message constants are exported', () => {
    expect(MSG_START_SCAN).toBe('start');
    expect(MSG_START_SCAN_FROM_PAGE).toBe('start_from_page');
    expect(MSG_PAUSE_SCAN).toBe('pause');
    expect(MSG_RESUME_SCAN).toBe('resume');
    expect(MSG_GET_STATE).toBe('get_state');
    expect(MSG_SET_RISK_MODE).toBe('set_risk_mode');
    expect(MSG_SET_COMPLIANCE_CONFIRM).toBe('set_compliance_confirm');
  });
});
