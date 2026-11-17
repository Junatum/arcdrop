# ArcDrop architecture

ArcDrop is a standalone, LAN-only file-transfer app for SmartSafeHub/OpenWrt. Its implementation is independent of PairDrop/Snapdrop. The current prototype uses a small native C CGI handler instead of a persistent signaling daemon.

## Data flow

```text
Browser A ── HTTPS JSON (discovery, invites, SDP/ICE) ──┐
                                                        │
                                              OpenWrt uHTTPd + CGI
                                                        │
Browser B ── HTTPS JSON (discovery, approval, SDP/ICE) ─┘

Browser A ═════════ WebRTC DataChannel (file bytes) ═════════ Browser B
```

The router serves the HTML/CSS/JS/SVG and exchanges **signaling metadata only**; it does **not** proxy, upload, or persist file payloads. Metadata, including peer IDs, names, network addresses, tokens and signaling messages, is held in memory-backed `/tmp/arcdrop` with bounded lifetimes. No separate database, cloud relay, or Node.js process is required.

## Components

| Component | Source | Purpose |
|---|---|---|
| HTTPS host | Existing OpenWrt `uhttpd` | Serves static assets and runs CGI |
| Signaling CGI | `src/arcdrop.c` | Validates HTTPS, same-origin and trusted LAN; manages peer sessions, approval and ICE/SDP |
| Browser client | `web/app.js` | Peer discovery and encrypted WebRTC data-channel file transfer |
| Browser UI | `web/index.html`, `web/style.css`, `web/icon.svg` | Responsive device-centric transfer UI |
| Local design demo | `web/demo.html`, `web/demo.js` | Isolated preview only; not installed to routers |
| Configuration | `root/etc/arcdrop.conf` | Trusted LAN interface (`br-lan` by default) |

## Transfer and security boundaries

1. Both browsers connect to the router's **trusted HTTPS** origin and register in the same authorized IPv4 LAN.
2. The sender selects a peer and one file (up to **64 MiB**), then sends an invitation through CGI.
3. The receiver **must accept** before WebRTC negotiation begins.
4. Browsers collect local ICE candidates before exchanging bundled offer/answer SDP through CGI, then attempt direct connectivity with `iceServers: []` (no STUN/TURN relay). Legacy trickled ICE messages remain accepted for mixed-version sessions.
5. File bytes move through an encrypted WebRTC RTCDataChannel in **16 KiB** chunks, with buffering limits. The receiver saves locally.

The CGI requires HTTPS and same-origin JSON requests. Session credentials are short-lived. The API is not intended for WAN or isolated guest/VLAN segments. The system cannot guarantee direct connectivity when local client isolation blocks WebRTC host candidates.

## Runtime and development boundaries

- No file content is written to router storage, but browser-side buffering/memory use is still possible.
- Browser certificate trust is a prerequisite; ArcDrop does not manage certificate issuance.
- `web/demo.html` is a static design preview, not a bypass for production HTTPS and approval checks.
- ShellSpec contracts cover CGI, browser code, UI, packaging, and docs. An optional Playwright E2E test exists; real supported-device validation remains outstanding.

See [deployment security](DEPLOYMENT.md), [installation](INSTALLATION.md), and [development](DEVELOPMENT.md).

## Advisory peer presence (0.1.0-r11)

The CGI continues to authenticate each short-lived session, then records optional browser-poll hints (`visible`, `busy`) and the last poll time under `/tmp/arcdrop`. On a peer-list request, it returns an advisory presence label when a poll has occurred. A recent foreground poll indicates availability, while an in-progress transfer, a background tab, or a delayed response is labeled separately. UI availability **does not authorize signaling, prove ICE reachability, or substitute for explicit acceptance**. Legacy clients with missing presence fields retain their previous discovery behavior. Data payloads continue to bypass the router.

## Signal failure handling (0.1.0-r12)

Incoming invitations expire after 30 seconds if not accepted/declined. The browser processes each queued poll message independently; a malformed SDP/failed exchange cancels the affected transfer but does not discard later messages in that poll batch. This is an additional resilience measure, **not a guarantee of successful WebRTC connectivity**. Full validation matrix: [VALIDATION.md](VALIDATION.md).
