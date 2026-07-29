export type ExtensionBridgeMessage =
  | ConsoleCaptureMessage
  | NetworkCaptureMessage
  | ScreenshotBridgeMessage
  | SelectedElementMessage
  | BridgeStatusMessage;

export interface ConsoleCaptureMessage {
  type: 'console:capture';
  payload: {
    entries: Array<{ level: string; message: string; timestamp: string; source?: string }>;
  };
}

export interface NetworkCaptureMessage {
  type: 'network:capture';
  payload: {
    entries: Array<{
      request: { method: string; url: string };
      response?: { status: number; statusText: string };
      durationMs?: number;
      timestamp: string;
    }>;
  };
}

export interface ScreenshotBridgeMessage {
  type: 'screenshot:bridge';
  payload: {
    imageData: string;
    format: 'png' | 'jpeg';
    width: number;
    height: number;
    timestamp: string;
  };
}

export interface SelectedElementMessage {
  type: 'element:selected';
  payload: {
    selector: string;
    tagName: string;
    text?: string;
    attributes?: Record<string, string>;
    boundingBox?: { x: number; y: number; width: number; height: number };
    timestamp: string;
  };
}

export interface BridgeStatusMessage {
  type: 'bridge:status';
  payload: {
    connected: boolean;
    version: string;
    timestamp: string;
  };
}

export interface BridgeError {
  code: string;
  message: string;
}

export function validateBridgeMessage(
  raw: unknown,
): { ok: true; message: ExtensionBridgeMessage } | { ok: false; error: BridgeError } {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: { code: 'INVALID_FORMAT', message: 'Message must be a JSON object' },
    };
  }
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== 'string' || !msg.type) {
    return {
      ok: false,
      error: { code: 'MISSING_TYPE', message: 'Message must have a type field' },
    };
  }
  if (!msg.payload || typeof msg.payload !== 'object') {
    return {
      ok: false,
      error: { code: 'MISSING_PAYLOAD', message: 'Message must have a payload object' },
    };
  }

  const validTypes = [
    'console:capture',
    'network:capture',
    'screenshot:bridge',
    'element:selected',
    'bridge:status',
  ];
  if (!validTypes.includes(msg.type as string)) {
    return {
      ok: false,
      error: { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${msg.type}` },
    };
  }

  return { ok: true, message: raw as ExtensionBridgeMessage };
}

export function validateScreenshotBridgeMessage(
  msg: unknown,
): { ok: true; message: ScreenshotBridgeMessage } | { ok: false; error: BridgeError } {
  const validated = validateBridgeMessage(msg);
  if (!validated.ok) return validated;
  if (validated.message.type !== 'screenshot:bridge') {
    return {
      ok: false,
      error: { code: 'WRONG_TYPE', message: 'Expected screenshot:bridge message' },
    };
  }
  const payload = validated.message.payload;
  if (typeof payload.imageData !== 'string' || payload.imageData.length === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_IMAGE', message: 'Screenshot bridge requires non-empty imageData' },
    };
  }
  if (payload.format !== 'png' && payload.format !== 'jpeg') {
    return { ok: false, error: { code: 'INVALID_FORMAT', message: 'Format must be png or jpeg' } };
  }
  return { ok: true, message: validated.message };
}

export function validateSelectedElementMessage(
  msg: unknown,
): { ok: true; message: SelectedElementMessage } | { ok: false; error: BridgeError } {
  const validated = validateBridgeMessage(msg);
  if (!validated.ok) return validated;
  if (validated.message.type !== 'element:selected') {
    return {
      ok: false,
      error: { code: 'WRONG_TYPE', message: 'Expected element:selected message' },
    };
  }
  const payload = validated.message.payload;
  if (typeof payload.selector !== 'string' || !payload.selector) {
    return {
      ok: false,
      error: { code: 'MISSING_SELECTOR', message: 'Selected element requires a selector' },
    };
  }
  return { ok: true, message: validated.message };
}

export interface ExtensionAdapter {
  readonly experimental: true;
  readonly name: string;
  connect(): Promise<{ ok: boolean; error?: string }>;
  disconnect(): Promise<void>;
  sendMessage(msg: ExtensionBridgeMessage): Promise<void>;
  onMessage(handler: (msg: ExtensionBridgeMessage) => void): void;
}
