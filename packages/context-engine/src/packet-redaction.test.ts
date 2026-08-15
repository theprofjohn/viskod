import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextPacket } from './index';
import { redactPacketForPersistence } from './packet-redaction';

/**
 * Phase 29 synthetic-secret fixtures. Every value is fake and must NEVER
 * appear in a persisted structured artifact or agent projection.
 */
const SYNTHETIC_SECRETS = {
  password: 'hunter2-P29-fixture',
  apiKey: 'sk_live_P29FIXTURE9876543210',
  bearer: 'Bearer P29fixture.token.abcdef123456',
  queryToken: 's3cret-p29-query-token',
  email: 'p29.fixture.user@example.com',
  card: '4111 1111 1111 1111',
  base64: 'UEFOR3lmaXh0dXJlZGF0YXRva2VudmFsdWU9PQ==',
  domAttr: 'p29-secret-attribute-value',
  inputValue: 'p29-super-secret-input',
  authHeader: 'Basic cDlmaXh0dXJlOmF1dGh0b2tlbg==',
};

function makePacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    packetId: crypto.randomUUID(),
    schemaVersion: '1.1.0',
    timestamp: new Date().toISOString(),
    captureId: crypto.randomUUID(),
    captureStatus: 'partial',
    evidence: {
      dom: { state: 'collected' },
      hierarchy: { state: 'collected' },
      styles: { state: 'collected' },
      screenshot: { state: 'omitted_sensitive' },
      runtime: { state: 'collected' },
      sourceHints: { state: 'unavailable' },
    },
    browser: {
      url: `http://example.test/login?token=${SYNTHETIC_SECRETS.queryToken}`,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      userAgent: 'P29FixtureAgent/1.0',
    },
    selection: {
      selector: 'input[name="password"]',
      tagName: 'input',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      text: `Password: ${SYNTHETIC_SECRETS.password} (visible neighboring text)`,
    },
    dom: {
      tagName: 'input',
      attributes: {
        id: 'password-field',
        value: SYNTHETIC_SECRETS.inputValue,
        'data-secret': SYNTHETIC_SECRETS.domAttr,
        'data-testid': 'p29-password-input',
        'aria-label': 'Password',
        class: 'form-input',
      },
      childCount: 0,
      depth: 0,
    },
    styles: {
      computed: {
        color: 'rgb(0, 0, 0)',
        'border-color': 'rgb(204, 204, 204)',
        '--p29-token': SYNTHETIC_SECRETS.base64,
      },
      layout: null,
    },
    hierarchy: {
      selectedNode: { tagName: 'input', depth: 1 },
      parents: [
        { tagName: 'form', depth: 2, text: `Login ${SYNTHETIC_SECRETS.email}` },
        { tagName: 'body', depth: 3 },
      ],
      siblings: [{ tagName: 'label', depth: 2, text: 'Password' }],
      children: [],
    },
    screenshots: [
      {
        captureId: 'shot-p29',
        type: 'selection',
        path: null,
        width: 100,
        height: 40,
        format: 'png',
        sizeBytes: 0,
        status: 'omitted_sensitive',
        sensitive: true,
      },
    ],
    confidence: {
      sourceMapping: null,
      semanticLabeling: null,
      layoutAnalysis: null,
      frameworkDetection: null,
    },
    metadata: {
      engineVersion: '1.0.0',
      processingTimeMs: 1,
      evidenceSources: ['browser-runtime'],
      redactions: [],
      capturePolicy: { screenshot: 'omitted_sensitive' },
    },
    diagnostics: [],
    sourceHints: [
      {
        filePath: 'src/components/LoginForm.tsx',
        confidence: 0.71,
        evidence: `matches ${SYNTHETIC_SECRETS.email}`,
        isPrimary: true,
        exists: true,
        matchType: 'class-name',
        reason: 'component match',
        qualification: 'probable',
        reasons: [
          `visible text for ${SYNTHETIC_SECRETS.email}`,
          `session token: ${SYNTHETIC_SECRETS.bearer}`,
          'imported by current route',
        ],
      },
    ],
    runtimeEvidence: {
      console: [
        {
          level: 'error',
          message: `login failed for ${SYNTHETIC_SECRETS.email}; token ${SYNTHETIC_SECRETS.base64}; card ${SYNTHETIC_SECRETS.card}`,
          timestamp: 'now',
        },
      ],
      network: [
        {
          request: {
            method: 'POST',
            url: `http://example.test/api/login?token=${SYNTHETIC_SECRETS.queryToken}&api_key=${SYNTHETIC_SECRETS.apiKey}`,
            headers: { authorization: SYNTHETIC_SECRETS.authHeader },
          },
          response: { status: 401, statusText: 'Unauthorized' },
          timestamp: 'now',
        },
      ],
      selectedElement: {
        selector: 'input[name="password"]',
        tagName: 'input',
        text: `Password: ${SYNTHETIC_SECRETS.password}`,
        attributes: {
          value: SYNTHETIC_SECRETS.inputValue,
          'aria-label': 'Password',
        },
      },
    },
    ...overrides,
  };
}

const TEST_DIR = path.join(os.tmpdir(), `.viskod-test-p29-redaction-${Date.now()}`);

describe('packet-level redaction boundary', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('redacts synthetic secrets from every structured surface', () => {
    const { packet } = redactPacketForPersistence(makePacket());
    const json = JSON.stringify(packet);
    for (const [name, secret] of Object.entries(SYNTHETIC_SECRETS)) {
      expect(json, `secret fixture '${name}' must be redacted`).not.toContain(secret);
    }
  });

  it('default-denies sensitive attribute values regardless of format', () => {
    const { packet } = redactPacketForPersistence(makePacket());
    expect(packet.dom.attributes.value).toBe('[REDACTED]');
    expect(packet.dom.attributes['data-secret']).toBe('[REDACTED]');
    expect(packet.dom.attributes['data-testid']).toBe('p29-password-input');
    expect(packet.dom.attributes['aria-label']).toBe('Password');
    // selectedElement attributes
    expect(packet.runtimeEvidence?.selectedElement?.attributes?.value).toBe('[REDACTED]');
  });

  it('redacts secrets from source-hint evidence/reasons while keeping relative paths useful (Phase 30)', () => {
    const { packet, redactions } = redactPacketForPersistence(makePacket());
    const hint = packet.sourceHints[0];
    expect(hint?.filePath).toBe('src/components/LoginForm.tsx');
    expect(hint?.qualification).toBe('probable');
    // Secrets embedded in source-hint reasons are scrubbed by the packet-level
    // boundary — the agent never sees them through the projection.
    const hintJson = JSON.stringify(hint);
    expect(hintJson).not.toContain(SYNTHETIC_SECRETS.email);
    expect(hintJson).not.toContain(SYNTHETIC_SECRETS.bearer.replace('Bearer ', ''));
    // Relative path + qualification survive.
    expect(hintJson).toContain('src/components/LoginForm.tsx');
    expect(hintJson).toContain('probable');
    // The boundary reports the applied source-hint redactions.
    expect(redactions).toContain('email');
    expect(redactions).toContain('inline-secret');
  });

  it('redacts sensitive URL query parameters and headers', () => {
    const { packet } = redactPacketForPersistence(makePacket());
    expect(packet.browser.url).not.toContain(SYNTHETIC_SECRETS.queryToken);
    const net = packet.runtimeEvidence?.network?.[0];
    expect(net?.request.headers?.authorization).toBe('[REDACTED]');
    expect(net?.request.url).not.toContain(SYNTHETIC_SECRETS.queryToken);
  });

  it('preserves useful non-sensitive context', () => {
    const { packet } = redactPacketForPersistence(makePacket());
    expect(packet.selection.selector).toBe('input[name="password"]');
    expect(packet.dom.attributes['data-testid']).toBe('p29-password-input');
    expect(packet.styles.computed.color).toBe('rgb(0, 0, 0)');
    expect(packet.hierarchy.parents[1]?.tagName).toBe('body');
    expect(packet.sourceHints[0]?.filePath).toBe('src/components/LoginForm.tsx');
    // Visible non-sensitive neighboring text stays useful.
    expect(packet.hierarchy.parents[0]?.text).toContain('Login');
  });

  it('reports the applied redaction labels', () => {
    const { redactions } = redactPacketForPersistence(makePacket());
    expect(redactions).toContain('sensitive-attribute');
    expect(redactions).toContain('query-param-sensitive');
    expect(redactions).toContain('email');
    expect(redactions).toContain('card-number');
    expect(redactions).toContain('inline-secret');
    expect(redactions).toContain('assign-secret');
  });

  it('is idempotent — re-redaction changes nothing further', () => {
    const once = redactPacketForPersistence(makePacket());
    const twice = redactPacketForPersistence(once.packet);
    expect(JSON.stringify(twice.packet)).toBe(JSON.stringify(once.packet));
  });
});

describe('persisted artifact secret scan (Phase 29)', () => {
  it('persisted packet.json contains none of the synthetic secrets', async () => {
    const pipeline = new CapturePipeline(TEST_DIR);
    const captureId = crypto.randomUUID();
    const { packet } = redactPacketForPersistence(makePacket({ captureId }));
    const persisted = await pipeline.persistCapture({
      captureId,
      packetJson: JSON.stringify(packet, null, 2),
    });
    expect(persisted.ok).toBe(true);

    const artifacts = [
      path.join(TEST_DIR, captureId, 'packet.json'),
      path.join(TEST_DIR, captureId, 'metadata.json'),
    ];
    for (const file of artifacts) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const [name, secret] of Object.entries(SYNTHETIC_SECRETS)) {
        expect(content, `'${name}' leaked into ${path.basename(file)}`).not.toContain(secret);
      }
    }
  });

  it('persisted metadata matches the packet envelope', async () => {
    const pipeline = new CapturePipeline(TEST_DIR);
    const captureId = crypto.randomUUID();
    const { packet } = redactPacketForPersistence(makePacket({ captureId }));
    await pipeline.persistCapture({ captureId, packetJson: JSON.stringify(packet) });
    const meta = JSON.parse(
      fs.readFileSync(path.join(TEST_DIR, captureId, 'metadata.json'), 'utf-8'),
    );
    expect(meta.captureId).toBe(captureId);
    expect(meta.packetId).toBe(packet.packetId);
    expect(meta.captureStatus).toBe('partial');
    expect(meta.page.url).toBe(packet.browser.url);
  });
});
