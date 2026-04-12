import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MSG_GET_STATE, MSG_START_SCAN_FROM_PAGE } from '../extension/shared/messages.js';

function setupChrome(sendMessageImpl = (_message, callback) => callback?.({ ok: true, state: { status: 'idle', complianceConfirmEnabled: true } })) {
  globalThis.chrome = {
    runtime: {
      sendMessage: vi.fn(sendMessageImpl)
    }
  };
}

describe('content script', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setupChrome();
    globalThis.confirm = vi.fn(() => true);
  });

  test('injects start button once and sends start_from_page message', async () => {
    document.body.innerHTML = '<div class="Layout-sidebar"><div id="sidebar-anchor"></div></div>';
    const locationRef = {
      hostname: 'github.com',
      pathname: '/octo/repo',
      href: 'https://github.com/octo/repo'
    };

    const { injectStartButton, BUTTON_ID } = await import('../extension/content.js');

    injectStartButton({ locationRef });
    injectStartButton({ locationRef });

    const buttons = document.querySelectorAll(`#${BUTTON_ID}`);
    expect(buttons).toHaveLength(1);

    buttons[0].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: MSG_START_SCAN_FROM_PAGE,
        url: locationRef.href
      },
      expect.any(Function)
    );
  });

  test('injects on repo root with trailing slash', async () => {
    document.body.innerHTML = '<div class="Layout-sidebar"></div>';
    const locationRef = {
      hostname: 'github.com',
      pathname: '/octo/repo/',
      href: 'https://github.com/octo/repo/'
    };

    const { injectStartButton, BUTTON_ID } = await import('../extension/content.js');
    const button = injectStartButton({ locationRef });

    expect(button).not.toBeNull();
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  test('does not inject start button on non-repo github pages', async () => {
    document.body.innerHTML = '<div class="Layout-sidebar"></div>';
    const locationRef = {
      hostname: 'github.com',
      pathname: '/login/device',
      href: 'https://github.com/login/device'
    };

    const { injectStartButton, BUTTON_ID } = await import('../extension/content.js');
    const button = injectStartButton({ locationRef });

    expect(button).toBeNull();
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(0);
  });

  test('does not inject on nested repo subpages', async () => {
    document.body.innerHTML = '<div class="Layout-sidebar"></div>';
    const locationRef = {
      hostname: 'github.com',
      pathname: '/octo/repo/issues',
      href: 'https://github.com/octo/repo/issues'
    };

    const { injectStartButton, BUTTON_ID } = await import('../extension/content.js');
    const button = injectStartButton({ locationRef });

    expect(button).toBeNull();
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(0);
  });

  test('disables and relabels button when scan state is running', async () => {
    document.body.innerHTML = '<div class="Layout-sidebar"></div>';
    setupChrome((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({ ok: true, state: { status: 'running' } });
        return;
      }
      callback({ ok: true });
    });
    const locationRef = {
      hostname: 'github.com',
      pathname: '/octo/repo',
      href: 'https://github.com/octo/repo'
    };

    const { injectStartButton } = await import('../extension/content.js');
    const button = injectStartButton({ locationRef });
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: MSG_GET_STATE }, expect.any(Function));
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('扫描中');
  });

  test('keeps button enabled with normal label when scan is not running', async () => {
    document.body.innerHTML = '<div class="Layout-sidebar"></div>';
    setupChrome((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({ ok: true, state: { status: 'paused' } });
        return;
      }
      callback({ ok: true });
    });
    const locationRef = {
      hostname: 'github.com',
      pathname: '/octo/repo',
      href: 'https://github.com/octo/repo'
    };

    const { injectStartButton } = await import('../extension/content.js');
    const button = injectStartButton({ locationRef });
    await Promise.resolve();

    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('开始邮箱扫描');
  });

  test('does not send start message when compliance confirmation is rejected', async () => {
    document.body.innerHTML = '<div class="Layout-sidebar"></div>';
    setupChrome((message, callback) => {
      if (message.type === MSG_GET_STATE) {
        callback({ ok: true, state: { status: 'idle', complianceConfirmEnabled: true } });
        return;
      }
      callback({ ok: true });
    });
    globalThis.confirm = vi.fn(() => false);
    const locationRef = {
      hostname: 'github.com',
      pathname: '/octo/repo',
      href: 'https://github.com/octo/repo'
    };

    const { injectStartButton, BUTTON_ID } = await import('../extension/content.js');
    injectStartButton({ locationRef });
    const button = document.querySelector(`#${BUTTON_ID}`);
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(globalThis.confirm).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      {
        type: MSG_START_SCAN_FROM_PAGE,
        url: locationRef.href
      },
      expect.any(Function)
    );
  });
});
