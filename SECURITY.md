# ArcDrop security policy

ArcDrop is an **early-stage LAN-only prototype**. It is not yet verified as production-ready on all SmartSafeHub router targets. No security-support SLA or guaranteed response time is established.

## Reporting a vulnerability

**Do not post exploit details, tokens, private keys, or sensitive logs in a public GitHub issue.** Instead, use the repository's private vulnerability reporting feature **if enabled** (GitHub → Security → Report a vulnerability). If the feature is unavailable, contact the maintainer through a non-public channel listed in the repository profile; do not assume a particular email address exists.

Provide the affected version, router/browser environment, steps to reproduce, and the security impact. Redact personal and network secrets.

## Scope and threat model

ArcDrop is only intended to be served on a **trusted private LAN** through a browser-trusted HTTPS connection. The native CGI checks HTTPS, same-origin requests, approved IPv4 LAN access, and explicit file-transfer acceptance. Signaling is short-lived; file content must never traverse the router's CGI.

Areas of particular interest include:

- Unauthorized WAN/guest-network discovery or bypass of `br-lan` restrictions.
- Cross-origin requests, session-token leakage, or invitation/approval bypass.
- Symlink/path traversal and unsafe temporary metadata operations.
- Malformed SDP/ICE messages, queue exhaustion, and resource limits.
- Accidental file content handling or persistence on the router.

Do not turn off firewall, LAN isolation or certificate validation as a workaround. For HTTPS requirements, see [deployment and security](docs/DEPLOYMENT.md).
