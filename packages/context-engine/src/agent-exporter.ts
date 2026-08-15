import type { ContextPacket } from './index';

export type ExportFormat = 'markdown' | 'json';

export interface ExportOptions {
  format: ExportFormat;
}

export interface CompactPacket {
  packetId: string;
  timestamp: string;
  selector: string;
  tagName: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  visibleText: string;
  screenshots: Array<{ type: string; path: string | null; sizeBytes: number }>;
  profile: string;
  sourceHints: Array<{
    filePath: string;
    confidence: number;
    exists: boolean;
    matchType: string;
    reason: string;
    isPrimary: boolean;
  }>;
  consoleSummary: Array<{ level: string; count: number; sample: string }>;
  networkSummary: Array<{ method: string; url: string; status: number }>;
  evidenceSources: string[];
  framework: string | null;
  processingTimeMs: number;
  redactions: string[];
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function groupConsoleByLevel(
  entries: Array<{ level: string; message: string }> | undefined,
): Array<{ level: string; count: number; sample: string }> {
  if (!entries || entries.length === 0) return [];
  const groups = new Map<string, { count: number; sample: string }>();
  for (const e of entries) {
    const g = groups.get(e.level);
    if (g) {
      g.count++;
    } else {
      groups.set(e.level, { count: 1, sample: truncate(e.message, 200) });
    }
  }
  return Array.from(groups.entries()).map(([level, v]) => ({
    level,
    count: v.count,
    sample: v.sample,
  }));
}

function extractNetworkSummary(
  entries:
    | Array<{ request: { method: string; url: string }; response?: { status: number } }>
    | undefined,
): Array<{ method: string; url: string; status: number }> {
  if (!entries || entries.length === 0) return [];
  return entries.map((e) => ({
    method: e.request.method,
    url: truncate(e.request.url, 120),
    status: e.response?.status ?? 0,
  }));
}

function detectProfile(packet: ContextPacket): string {
  const hasNetwork = !!packet.runtimeEvidence?.network?.length;
  const hasScreenshot = (packet.screenshots?.length ?? 0) > 0;
  if (hasNetwork && !hasScreenshot) return 'audit';
  if (hasNetwork && hasScreenshot) return 'debug';
  return 'default';
}

function toAgentBriefMarkdown(packet: ContextPacket): string {
  const lines: string[] = [];
  const profile = detectProfile(packet);
  const sel = packet.selection ?? {
    selector: 'unknown',
    tagName: 'unknown',
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
  };

  lines.push(`# Context Packet: ${packet.packetId.slice(0, 8)}…`);
  lines.push('');
  lines.push(`- **Selector:** \`${sel.selector}\``);
  lines.push(`- **Tag:** \`${sel.tagName}\``);
  lines.push(
    `- **Bounding Box:** x=${sel.boundingBox.x} y=${sel.boundingBox.y} w=${sel.boundingBox.width} h=${sel.boundingBox.height}`,
  );
  lines.push(`- **Profile:** ${profile}`);
  lines.push(`- **Captured:** ${packet.timestamp}`);
  lines.push(`- **Evidence Sources:** ${(packet.metadata?.evidenceSources ?? []).join(', ')}`);
  lines.push('');
  lines.push('## Visible Text');
  lines.push('');
  lines.push(packet.selection?.text ? truncate(packet.selection.text, 500) : '(none)');
  lines.push('');

  // Screenshots
  if (packet.screenshots && packet.screenshots.length > 0) {
    lines.push('## Screenshots');
    lines.push('');
    for (const s of packet.screenshots) {
      const ref = s.path
        ? `\`${s.path}\``
        : s.status === 'omitted_sensitive' || s.sensitive
          ? '(omitted — sensitive pixels are not persisted)'
          : '(omitted)';
      lines.push(`- ${ref} (${s.type}, ${s.sizeBytes} bytes)`);
    }
    lines.push('');
  }

  // Source hints
  if (packet.sourceHints && packet.sourceHints.length > 0) {
    lines.push('## Source Hints (ranked)');
    lines.push('');
    lines.push('| # | File | Kind | Confidence | Exists | Match Type | Primary |');
    lines.push('|---|------|------|-----------|--------|------------|---------|');
    packet.sourceHints.forEach((h, i) => {
      const filePath = h.filePath.length > 50 ? `…${h.filePath.slice(-47)}` : h.filePath;
      const kind = h.kind ?? '—';
      lines.push(
        `| ${i + 1} | \`${filePath}\` | ${kind} | ${(h.confidence * 100).toFixed(0)}% | ${h.exists ? '✅' : '❌'} | ${h.matchType ?? '—'} | ${h.isPrimary ? '⭐' : ''} |`,
      );
    });
    lines.push('');

    // Separate usage-site and definition-site hints
    const usageHints = packet.sourceHints.filter(
      (h) => h.kind === 'usage-site' || h.kind === 'route-owner',
    );
    const defHints = packet.sourceHints.filter((h) => h.kind === 'definition-site');

    if (usageHints.length > 0) {
      lines.push('**Likely usage sites:**');
      usageHints.slice(0, 3).forEach((h, i) => {
        lines.push(`${i + 1}. \`${h.filePath}\` — ${h.reason ?? 'high confidence'}`);
      });
      lines.push('');
    }
    if (defHints.length > 0) {
      lines.push('**Supporting definitions:**');
      defHints.slice(0, 3).forEach((h, i) => {
        lines.push(`${i + 1}. \`${h.filePath}\` — ${h.reason ?? 'component definition'}`);
      });
      lines.push('');
    }

    lines.push('**Suggested:** Inspect the top existing usage-site hint first.');
    lines.push('');
  } else {
    lines.push('## Source Hints');
    lines.push('');
    lines.push('No source hints available. The project scan may need a component directory.');
    lines.push('');
  }

  // Console evidence
  const consoleSummary = groupConsoleByLevel(packet.runtimeEvidence?.console);
  if (consoleSummary.length > 0) {
    lines.push('## Console Evidence');
    lines.push('');
    lines.push('| Level | Count | Sample |');
    lines.push('|-------|-------|--------|');
    for (const c of consoleSummary) {
      lines.push(`| ${c.level} | ${c.count} | \`${c.sample}\` |`);
    }
    if ((packet.metadata?.redactions ?? []).length > 0) {
      lines.push('');
      lines.push('*Values were redacted. See redaction summary below.*');
    }
    lines.push('');
  }

  // Network evidence
  const networkSummary = extractNetworkSummary(packet.runtimeEvidence?.network);
  if (networkSummary.length > 0) {
    lines.push('## Network Evidence');
    lines.push('');
    lines.push('| Method | Status | URL |');
    lines.push('|--------|--------|-----|');
    for (const n of networkSummary.slice(0, 10)) {
      lines.push(`| ${n.method} | ${n.status} | \`${n.url}\` |`);
    }
    if (networkSummary.length > 10) {
      lines.push(`| … | … | *${networkSummary.length - 10} more entries* |`);
    }
    lines.push('');
  }

  // Redaction summary
  const redactions = packet.metadata?.redactions ?? [];
  if (redactions.length > 0) {
    lines.push('## Redactions Applied');
    lines.push('');
    lines.push(`Types: ${redactions.join(', ')}`);
    lines.push('');
  }

  // Confidence
  const confidence = packet.confidence ?? {};
  const fmt = (v: number | null | undefined): string =>
    v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(0)}%`;
  lines.push('## Confidence');
  lines.push('');
  lines.push(`- Source Mapping: ${fmt(confidence.sourceMapping)}`);
  lines.push(`- Semantic Labeling: ${fmt(confidence.semanticLabeling)}`);
  lines.push(`- Layout Analysis: ${fmt(confidence.layoutAnalysis)}`);
  lines.push(`- Framework Detection: ${fmt(confidence.frameworkDetection)}`);
  lines.push('');

  // Suggested next steps
  lines.push('## Suggested Next Steps');
  lines.push('');
  if (packet.sourceHints && packet.sourceHints.length > 0) {
    const topExists = packet.sourceHints.find((h) => h.exists);
    if (topExists) {
      lines.push(
        `1. **Inspect source file:** \`${topExists.filePath}\` (confidence ${(topExists.confidence * 100).toFixed(0)}%)`,
      );
    }
  }
  lines.push(
    `2. **Review bounding box:** Compare expected vs captured layout (w=${sel.boundingBox.width} h=${sel.boundingBox.height})`,
  );
  if (consoleSummary.length > 0) {
    lines.push('3. **Address console errors:** See Console Evidence table above');
  }
  if (networkSummary.length > 0) {
    lines.push('4. **Check network failures:** See Network Evidence table above');
  }
  lines.push('5. **Fix the issue** in the identified source file');
  lines.push('6. **Re-capture** the same selector to verify the fix');
  lines.push('');

  return lines.join('\n');
}

function toCompactJson(packet: ContextPacket): CompactPacket {
  const sel = packet.selection ?? {
    selector: 'unknown',
    tagName: 'unknown',
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    text: '',
  };

  return {
    packetId: packet.packetId,
    timestamp: packet.timestamp,
    selector: sel.selector,
    tagName: sel.tagName,
    boundingBox: sel.boundingBox,
    visibleText: truncate(sel.text ?? '', 300),
    screenshots: (packet.screenshots ?? []).map((s) => ({
      type: s.type,
      path: s.path,
      sizeBytes: s.sizeBytes,
    })),
    profile: detectProfile(packet),
    sourceHints: (packet.sourceHints ?? []).map((h) => ({
      filePath: h.filePath,
      confidence: h.confidence,
      exists: h.exists ?? false,
      matchType: h.matchType ?? 'generated',
      reason: h.reason ?? '',
      isPrimary: h.isPrimary ?? false,
      kind: h.kind,
      status: h.status,
    })),
    consoleSummary: groupConsoleByLevel(packet.runtimeEvidence?.console),
    networkSummary: extractNetworkSummary(packet.runtimeEvidence?.network).slice(0, 50),
    evidenceSources: packet.metadata?.evidenceSources ?? [],
    framework: packet.project?.framework ?? null,
    processingTimeMs: packet.metadata?.processingTimeMs ?? 0,
    redactions: packet.metadata?.redactions ?? [],
  };
}

export function generateExport(packet: ContextPacket, options: ExportOptions): string {
  switch (options.format) {
    case 'markdown':
      return toAgentBriefMarkdown(packet);
    case 'json':
      return JSON.stringify(toCompactJson(packet), null, 2);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}
