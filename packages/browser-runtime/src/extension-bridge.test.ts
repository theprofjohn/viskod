import { describe, expect, it } from 'vitest';
import {
  validateBridgeMessage,
  validateScreenshotBridgeMessage,
  validateSelectedElementMessage,
} from './extension-bridge';

describe('extension bridge message validation', () => {
  it('accepts valid console:capture message', () => {
    const result = validateBridgeMessage({
      type: 'console:capture',
      payload: {
        entries: [{ level: 'error', message: 'test', timestamp: '2026-01-01T00:00:00Z' }],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('console:capture');
    }
  });

  it('accepts valid network:capture message', () => {
    const result = validateBridgeMessage({
      type: 'network:capture',
      payload: {
        entries: [
          {
            request: { method: 'GET', url: 'https://example.com' },
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('network:capture');
    }
  });

  it('accepts valid bridge:status message', () => {
    const result = validateBridgeMessage({
      type: 'bridge:status',
      payload: { connected: true, version: '1.0.0', timestamp: '2026-01-01T00:00:00Z' },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects null message', () => {
    const result = validateBridgeMessage(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_FORMAT');
    }
  });

  it('rejects message without type', () => {
    const result = validateBridgeMessage({ payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_TYPE');
    }
  });

  it('rejects message without payload', () => {
    const result = validateBridgeMessage({ type: 'network:capture' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_PAYLOAD');
    }
  });

  it('rejects unknown message type', () => {
    const result = validateBridgeMessage({ type: 'unknown:type', payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_TYPE');
    }
  });
});

describe('screenshot bridge message validation', () => {
  it('accepts valid screenshot:bridge message', () => {
    const result = validateScreenshotBridgeMessage({
      type: 'screenshot:bridge',
      payload: {
        imageData: 'base64data',
        format: 'png',
        width: 1280,
        height: 720,
        timestamp: '2026-01-01T00:00:00Z',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('screenshot:bridge');
    }
  });

  it('rejects message with wrong type', () => {
    const result = validateScreenshotBridgeMessage({
      type: 'console:capture',
      payload: { entries: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('WRONG_TYPE');
    }
  });

  it('rejects message with empty imageData', () => {
    const result = validateScreenshotBridgeMessage({
      type: 'screenshot:bridge',
      payload: {
        imageData: '',
        format: 'png',
        width: 1280,
        height: 720,
        timestamp: '2026-01-01T00:00:00Z',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_IMAGE');
    }
  });

  it('rejects message with invalid format', () => {
    const result = validateScreenshotBridgeMessage({
      type: 'screenshot:bridge',
      payload: {
        imageData: 'data',
        format: 'webp',
        width: 1280,
        height: 720,
        timestamp: '2026-01-01T00:00:00Z',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_FORMAT');
    }
  });
});

describe('selected element message validation', () => {
  it('accepts valid element:selected message', () => {
    const result = validateSelectedElementMessage({
      type: 'element:selected',
      payload: { selector: '#btn', tagName: 'button', timestamp: '2026-01-01T00:00:00Z' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('element:selected');
    }
  });

  it('rejects message without selector', () => {
    const result = validateSelectedElementMessage({
      type: 'element:selected',
      payload: { tagName: 'button', timestamp: '2026-01-01T00:00:00Z' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_SELECTOR');
    }
  });
});
