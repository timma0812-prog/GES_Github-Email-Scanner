import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  MSG_GET_STATE,
  MSG_PAUSE_SCAN,
  MSG_RESUME_SCAN,
  MSG_SET_COMPLIANCE_CONFIRM,
  MSG_SET_RISK_MODE,
  MSG_START_SCAN
} from '../extension/shared/messages.js';

function createPopupDom() {
  document.body.innerHTML = `
    <div>
      <button id="start-btn">Start</button>
      <button id="pause-btn">Pause</button>
      <button id="resume-btn">Resume</button>
      <button id="export-btn">Export CSV</button>
      <label><input id="risk-mode-toggle" type="checkbox" /></label>
      <label><input id="compliance-confirm-toggle" type="checkbox" checked /></label>
      <span id="risk-mode-text"></span>
      <p id="status-text"></p>
      <p id="progress-text"></p>
      <p id="reason-text"></p>
      <table>
        <tbody id="results-body"></tbody>
      </table>
    </div>
  `;
}

describe('popup', () => {
  beforeEach(() => {
    createPopupDom();
  });

  test('requests state on init, renders rows in new schema, and dispatches control messages', async () => {
    const sendMessage = vi.fn((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({
          ok: true,
          state: {
            status: 'paused',
            nextIndex: 2,
            totalTargets: 10,
            processed: 3,
            matched: 1,
            currentContributor: 'alice',
            riskMode: 'normal',
            complianceConfirmEnabled: true,
            rows: [
              {
                contributor_login: 'alice',
                email: 'alice@example.com',
                source_type: 'commit',
                source_url: 'https://github.com/o/r/commit/1',
                extracted_at: '2026-04-09T08:00:00.000Z'
              }
            ],
            repo: { owner: 'o', repo: 'r' }
          }
        });
        return;
      }
      callback({ ok: true });
    });

    const chromeApi = { runtime: { sendMessage } };
    const { createPopupController } = await import('../extension/popup.js');
    const popup = createPopupController({
      chromeApi,
      documentRef: document,
      windowRef: { confirm: vi.fn(() => true) }
    });

    await popup.init();

    expect(sendMessage).toHaveBeenCalledWith({ type: MSG_GET_STATE }, expect.any(Function));
    expect(document.querySelector('#status-text').textContent).toContain('暂停');
    expect(document.querySelector('#progress-text').textContent).toContain('目标总数：10');
    expect(document.querySelector('#progress-text').textContent).toContain('已处理：3');
    expect(document.querySelector('#progress-text').textContent).toContain('已匹配：1');
    expect(document.querySelector('#progress-text').textContent).toContain('当前：alice');
    expect(document.querySelector('#reason-text').textContent).toContain('原因：无');
    expect(document.querySelector('#risk-mode-text').textContent).toContain('标准');

    const rowCells = [...document.querySelectorAll('#results-body tr td')].map((cell) => cell.textContent);
    expect(rowCells).toEqual([
      'alice',
      'alice@example.com',
      'commit',
      'https://github.com/o/r/commit/1',
      '2026-04-09T08:00:00.000Z'
    ]);

    document.querySelector('#start-btn').click();
    document.querySelector('#pause-btn').click();
    document.querySelector('#resume-btn').click();
    document.querySelector('#risk-mode-toggle').checked = true;
    document.querySelector('#risk-mode-toggle').dispatchEvent(new Event('change'));
    document.querySelector('#compliance-confirm-toggle').checked = false;
    document.querySelector('#compliance-confirm-toggle').dispatchEvent(new Event('change'));

    expect(sendMessage).toHaveBeenCalledWith({ type: MSG_START_SCAN }, expect.any(Function));
    expect(sendMessage).toHaveBeenCalledWith({ type: MSG_PAUSE_SCAN }, expect.any(Function));
    expect(sendMessage).toHaveBeenCalledWith({ type: MSG_RESUME_SCAN }, expect.any(Function));
    expect(sendMessage).toHaveBeenCalledWith({ type: MSG_SET_RISK_MODE, mode: 'low' }, expect.any(Function));
    expect(sendMessage).toHaveBeenCalledWith({ type: MSG_SET_COMPLIANCE_CONFIRM, enabled: false }, expect.any(Function));
  });

  test('builds csv filename with fallback prefix when repo is unknown', async () => {
    const { buildCsvFilename } = await import('../extension/popup.js');
    const date = new Date('2026-04-09T16:07:08');

    expect(buildCsvFilename({ owner: 'octo', repo: 'tool' }, date)).toBe('octo_tool_emails_20260409_160708.csv');
    expect(buildCsvFilename(null, date)).toBe('github_repo_emails_20260409_160708.csv');
  });

  test('polls state while running and renders pause reason', async () => {
    vi.useFakeTimers();
    let stateIndex = 0;
    const states = [
      {
        status: 'running',
        reason: null,
        totalTargets: 10,
        processed: 3,
        matched: 1,
        currentContributor: 'alice',
        rows: [],
        nextIndex: 3
      },
      {
        status: 'paused',
        reason: 'manual_pause',
        totalTargets: 10,
        processed: 4,
        matched: 1,
        currentContributor: 'bob',
        rows: [],
        nextIndex: 4
      }
    ];
    const sendMessage = vi.fn((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({ ok: true, state: states[Math.min(stateIndex++, states.length - 1)] });
        return;
      }
      callback({ ok: true });
    });
    const chromeApi = { runtime: { sendMessage } };
    const { createPopupController, POLL_INTERVAL_MS } = await import('../extension/popup.js');
    const popup = createPopupController({
      chromeApi,
      documentRef: document,
      windowRef: { confirm: vi.fn(() => true) }
    });

    await popup.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 20);

    expect(sendMessage.mock.calls.filter((c) => c[0]?.type === MSG_GET_STATE).length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('#status-text').textContent).toContain('暂停');
    expect(document.querySelector('#reason-text').textContent).toContain('手动暂停');

    popup.destroy();
    vi.useRealTimers();
  });

  test('start action is non-blocking and renders running immediately', async () => {
    const callbacks = [];
    const sendMessage = vi.fn((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({
          ok: true,
          state: {
            status: 'idle',
            reason: null,
            rows: [],
            nextIndex: 0,
            totalTargets: 0,
            processed: 0,
            matched: 0,
            currentContributor: null,
            complianceConfirmEnabled: false
          }
        });
        return;
      }
      if (message.type === MSG_START_SCAN) {
        callbacks.push(callback);
        return;
      }
      callback({ ok: true });
    });
    const chromeApi = { runtime: { sendMessage } };
    const { createPopupController } = await import('../extension/popup.js');
    const popup = createPopupController({
      chromeApi,
      documentRef: document,
      windowRef: { confirm: vi.fn(() => true) }
    });
    await popup.init();

    document.querySelector('#start-btn').click();

    expect(document.querySelector('#status-text').textContent).toContain('扫描中');
    expect(callbacks.length).toBe(1);
    popup.destroy();
  });

  test('localizes additional pause reasons', async () => {
    const sendMessage = vi.fn((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({
          ok: true,
          state: { status: 'paused', reason: 'rate_limited', rows: [], nextIndex: 0, totalTargets: 0, processed: 0, matched: 0, currentContributor: null }
        });
      } else {
        callback({ ok: true });
      }
    });
    const chromeApi = { runtime: { sendMessage } };
    const { createPopupController } = await import('../extension/popup.js');
    const popup = createPopupController({
      chromeApi,
      documentRef: document,
      windowRef: { confirm: vi.fn(() => true) }
    });
    await popup.init();
    expect(document.querySelector('#reason-text').textContent).toContain('触发频率限制');

    popup.render({ status: 'paused', reason: 'human_verification', rows: [], nextIndex: 0, totalTargets: 0, processed: 0, matched: 0, currentContributor: null });
    expect(document.querySelector('#reason-text').textContent).toContain('触发人机验证');
    popup.destroy();
  });

  test('does not start scan when compliance confirmation is rejected', async () => {
    const sendMessage = vi.fn((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({
          ok: true,
          state: {
            status: 'idle',
            reason: null,
            rows: [],
            nextIndex: 0,
            totalTargets: 0,
            processed: 0,
            matched: 0,
            currentContributor: null,
            complianceConfirmEnabled: true
          }
        });
        return;
      }
      callback({ ok: true });
    });
    const chromeApi = { runtime: { sendMessage } };
    const { createPopupController } = await import('../extension/popup.js');
    const popup = createPopupController({
      chromeApi,
      documentRef: document,
      windowRef: { confirm: vi.fn(() => false) }
    });
    await popup.init();

    document.querySelector('#start-btn').click();

    expect(sendMessage).not.toHaveBeenCalledWith({ type: MSG_START_SCAN }, expect.any(Function));
    expect(document.querySelector('#reason-text').textContent).toContain('你取消了本次启动');
    popup.destroy();
  });
});
