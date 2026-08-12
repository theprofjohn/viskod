# Security Policy

Viskod is an alpha local-first developer tool. The supported security posture is the latest published `0.2.x-alpha` release and the current `main` branch. Interfaces and behavior may change while the project is alpha.

## Reporting a vulnerability

Please use GitHub's private Security Advisory reporting channel for this repository. Do not open a public issue for an unpatched vulnerability. If private reporting is unavailable, contact a repository maintainer through GitHub before sharing technical details publicly.

Include the affected version or commit, a concise reproduction, impact, relevant configuration, and a proposed mitigation when known. Do not include credentials, tokens, cookies, `.env` values, private application data, raw capture packets, or screenshots containing secrets. Redact evidence before attaching it.

Maintainers will acknowledge reports through GitHub, investigate privately, coordinate a fix or mitigation, and publish a clear resolution when disclosure is safe. No response-time or remediation-time SLA is promised.

## Privacy boundaries

Viskod is designed for local development:

- Services bind to localhost/127.0.0.1 by default.
- Telemetry is disabled by default.
- Captures are explicit and local.
- Sensitive values are redacted before user-facing agent output.

These properties reduce exposure; they do not make an unsafe target application, browser profile, machine, or network configuration safe automatically.
