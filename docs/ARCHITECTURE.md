# ArcDrop architecture

ArcDrop is a standalone, LAN-only file-transfer app for SmartSafeHub/OpenWrt. The current prototype uses a small native C CGI handler instead of a persistent signaling daemon.

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
| Signaling CGI entry | `src/arcdrop.c` | CGI request validation and action routing |
| CGI HTTP and JSON | `src/http.c`, `src/json_helpers.c` | Response handling, bounded helpers, identifiers |
| LAN access | `src/lan.c` | Same-origin HTTPS and trusted LAN checks |
| Peer storage | `src/peer_store.c` | Volatile JSON metadata, locking contract and expiry |
| Sessions and discovery | `src/session.c` | Registration, session checks and peer presence |
| WebRTC signaling | `src/signaling.c`, `src/signal_queue.c` | Consent validation, SDP/ICE metadata, acknowledgement and bounded queue |
| Shared CGI contract | `src/arcdrop.h` | Explicit request context and module interfaces |
| Browser bootstrap | `web/app.js` | ES module entry, browser event listeners and startup |
| Browser modules | `web/js/{core,api,ui,discovery,transfer,signaling,session}.js` | Shared state, CGI API, UI, discovery, file transfer, WebRTC negotiation and session polling |
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

## Native CGI module boundaries (0.1.0-r14)

`src/arcdrop.c` is the request entry point and router; the other `src/*.c` files
are linked into the same native CGI executable. No new daemon, port, persistent
storage or external runtime is introduced. `ArcContext` is allocated once per
request and passed explicitly; its state-directory path, client IPv4 address,
file-lock descriptor and clock value are not global variables. HTTP replies keep
the existing CGI exit semantics and release the lock. No file payload reaches
these interfaces. Phase 1 changes organization only, not public JSON contracts.

## Private signaling state and interruption recovery (0.1.0-r15)

The CGI's `/tmp/arcdrop` directory must be owned by the CGI user and not
accessible by other users. Its lock and peer files must be private, regular,
single-link files owned by that user. Peer JSON is read through a no-follow
file descriptor and rejected if larger than 96 KiB or if its internal ID does
not match its filename. These checks do not make local processes running with
the **same effective UID** mutually isolated.

Each peer's signaling queue retains the 32-message limit and is additionally
limited to **64 KiB of serialized JSON**. A 15-second `.cleanup` marker avoids
scanning every peer file for every poll; discovery and registration still scan
immediately, and authentication still enforces the existing 45-second expiry.

For a two-peer signaling update, `.transaction` briefly holds **pre-update
metadata snapshots**. All CGI requests acquire `.lock` and recover any
interrupted transaction (by restoring both old snapshots) before authenticating.
The journal is removed after both updates succeed. On a write failure, the CGI
returns 503 and attempts the same rollback; if rollback fails, later requests
continue recovery rather than using partially updated consent state. A process
crash between two updates is covered, but this is **not a disk-power-loss
transaction guarantee** (the directory lives in volatile `/tmp`).

The `.cleanup` and occasional `.transaction` are metadata only, never file
payload bytes. Neither introduces a new background service or browser API.

## Browser ES module boundaries (0.1.0-r16)

The production page loads `web/app.js` with `type="module"` and native relative
imports. `core.js` owns shared state and limits; `api.js` owns the JSON CGI
transport; `ui.js` only updates visual state; `discovery.js` maintains peer
order and selection; `transfer.js` handles consent and file chunk streaming;
`signaling.js` negotiates WebRTC ICE/SDP; `session.js` handles session renewal
and polling. There is no bundler, external dependency, or file-content relay.
The entry point injects the invite callback into discovery, avoiding a
transfer/discovery import cycle and keeping module loading straightforward.

OpenWrt installs the exact `web/js/*.js` module set into
`/www/arcdrop/js/` and serves it with the same HTTPS origin and CSP as the
entry point. The separate demo remains uninstalled.

## Reliable signaling and browser performance (0.1.0-r18)

Browsers supporting the new protocol send `acks: []` with each `poll` request.
Signaling responses contain a short random `id` and an enqueue timestamp `at`.
The CGI keeps messages until a subsequent poll supplies matching IDs in its
`acks` array, redelivering unanswered messages after HTTP response loss.
The browser tracks up to 128 recent IDs per tab to avoid repeating UI/WebRTC
side effects. Each acknowledgement batch is limited to 32 IDs, and queued
messages expire after 45 seconds. Older clients omitting `acks` still drain
once, exactly as before. Credentials, consent and same-origin checks remain
mandatory; an ACK is not authorization for any signaling action.

New outgoing signals use a random `requestId`, reused for up to two retries
on transient transport failures. The sender's bounded, expiring history makes
successful retries idempotent, including an already-consumed acceptance.
Attempting to reuse an ID for a different target, kind or body is rejected.
No separate daemon or persistent service was introduced.

The DataChannel sender now accepts file-complete `ack` only after the `end`
frame was sent and the complete file has been queued. The receiver validates
16 KiB chunk boundaries and reconstructs a completed Blob from 1 MiB
segments. This bounds retained **JavaScript ArrayBuffer references** per
segment, but total memory/Blob allocation remains browser-dependent. It does
not yet use direct-to-disk streaming, so 64 MiB transfers still require a
memory-capable browser. Progress UI updates are limited to about 100ms and
final completion forces an immediate update. A deadline timer replaces
per-chunk timer churn.

The CGI also includes `Server-Timing: cgi;dur=..., lock;dur=...` in its
responses (milliseconds). These fields contain no peer identifiers, tokens,
filenames or contents and are suitable for measuring lock contention from
browser developer tools. Measurements are observations, not performance
benchmarks of the supported OpenWrt devices.
