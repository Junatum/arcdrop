# ArcDrop development guide

**Languages:** [English](DEVELOPMENT.md) | [한국어](ko/DEVELOPMENT.md)

This guide describes ArcDrop **0.1.0-r15** from the accompanying source tree. **Static UI previews and real WebRTC file transfers are different tests.** The project remains a prototype pending validation on supported routers.

## 1. Overview

ArcDrop is a SmartSafeHub official app licensed under **GPL-3.0-or-later**, implemented independently of PairDrop/Snapdrop. It is intended for **trusted IPv4 LAN** file sharing with no cloud or router-side payload relay.

- **Browser-to-browser:** encrypted WebRTC RTCDataChannel, `iceServers: []` (no external STUN/TURN).
- **Router:** existing uHTTPd HTTPS/CGI serving UI and handling discovery, acceptance, SDP/ICE metadata.
- **Storage:** only short-lived metadata under memory-backed `/tmp/arcdrop`; **file bytes are not uploaded to or stored on the router**.
- **Limits:** one file up to **64 MiB** per transfer, **16 KiB** data chunks, one concurrent transfer per browser.
- **Open items:** browser-trusted HTTPS, router-specific E2E/performance validation, and SmartSafeHub Apps catalog integration.

## 2. Repository layout

```text
arcdrop/
├── Makefile                     # OpenWrt package and revision
├── root/etc/arcdrop.conf        # Installed as /etc/arcdrop.conf
├── src/arcdrop.c                # CGI entry and routing
├── src/arcdrop.h                # Per-request context / module contract
├── src/{http,lan,peer_store,session,signaling,json_helpers}.c # Native modules
├── web/
│   ├── index.html, app.js       # Real browser UI and WebRTC client
│   ├── style.css, icon.svg      # CSS and shared infinity-flow icon
│   └── demo.html, demo.js       # Local-only mock design preview
├── spec/contracts_spec.sh       # Korean ShellSpec contracts
├── tests/                       # CGI, JS, UI and package/document contracts
├── e2e/browser_e2e.py          # Optional real-browser E2E
├── tools/check_test_coverage.py # CI test-registration integrity
├── docs/ko/DEVELOPMENT.md       # Korean translation
├── docs/INSTALLATION.md         # OpenWrt install/build procedure
├── docs/ARCHITECTURE.md         # Data flow and security boundary
├── docs/DEPLOYMENT.md           # HTTPS/production validation guidance
├── README.md, README.ko.md      # English/Korean readmes
├── CHANGELOG.md                 # English release history
├── CONTRIBUTING.md, SECURITY.md
└── LICENSE, LICENSES/
```

**Never generate or commit frontend build artifacts.** The UI uses plain source HTML/CSS/JS/SVG without a bundler; `web/dist` and `web/build` are not part of the project.

## 3. Development prerequisites

For macOS, install Python 3, Node.js, ShellSpec 0.28.1, Apple Command Line Tools (C compiler), and the `json-c` development library. CI uses Ubuntu 24.04 and Node.js 24.

```sh
xcode-select --install  # Only if the C compiler is missing
brew install json-c pkgconf
python3 --version
node --version
cc --version
shellspec --version
```

The CGI host tests try `pkg-config`/`pkgconf` and Homebrew paths. They still require actual `json-c` headers and libraries.

## 4. Preview the web design locally (no backend)

```sh
cd /path/to/arcdrop/web
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://127.0.0.1:8080/demo.html**. It displays three mock nearby devices, the central device and five expanding waves (about 900px maximum diameter on desktop), and lets you switch the following UI states: peers, no peers, incoming invitation, transfer progress, completion, and connection error. The theme switch toggles dark/light mode. OS reduced-motion settings are honored. The shared `icon.svg` is also used in the production page and dialogs.

You can inspect `http://127.0.0.1:8080/` (`index.html`) for the production markup, but its HTTPS/security check prevents API registration on plain HTTP. The Python static server does **not** expose `/cgi-bin/arcdrop`. This is expected; it does not prove device discovery or transfer works.

The demo only uses `demo.html` and `demo.js` and **cannot transfer files**. Those files are excluded from the router package. No `npm install`, `npm run build`, or backend is required to preview the design. On Chrome/macOS, use `Cmd+Option+I` then `Cmd+Shift+M` to check mobile layouts; use `Ctrl+C` to stop the server.

## 5. Required contracts (ShellSpec)

From the repository root:

```sh
shellspec
```

ShellSpec loads `.shellspec` and `spec/contracts_spec.sh` and runs **Korean-language** descriptions. The suite covers CGI/LAN/HTTPS, WebRTC, UI, JS syntax, OpenWrt BusyBox, package installation, changelog spacing, documentation, and CI/test registration. New tests must be registered exactly once in the ShellSpec specification.

Run selected checks directly:

```sh
python3 tests/test_cgi.py
node --test --test-reporter=tap tests/test_frontend.mjs
node --test --test-reporter=tap tests/test_ui.mjs
sh tests/test-js-syntax.sh
sh tests/test-openwrt-commands.sh
sh tests/test-package-contract.sh
sh tests/test-build-prepare.sh
sh tests/test-changelog-spacing.sh
sh tests/test-docs-contract.sh
sh tests/test-suite-integrity.sh
```

The explicit TAP reporter prevents differences between Node.js output styles (`# pass` vs `ℹ pass`) from breaking ShellSpec checks. CI checks test-registration integrity and BusyBox compatibility before installing dependencies and executing ShellSpec.

## 6. Optional real-browser WebRTC E2E

`e2e/browser_e2e.py` starts temporary HTTPS/CGI services and uses two Playwright browser contexts to test WebRTC in both directions. It is **not** part of required ShellSpec CI.

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 e2e/browser_e2e.py
```

**Current state:** The optional E2E runner auto-detects Chromium/Chrome/Edge on macOS or Linux, uses the same Homebrew/json-c flag discovery as the CGI tests, and generates portable short-lived OpenSSL certificates. After `python3 -m playwright install chromium`, run `python3 e2e/browser_e2e.py`; set `ARCDROP_E2E_BROWSER=webkit` (or `firefox`) to test another installed engine. The runner tests both file directions and rejection and is available through manual GitHub Actions. The current sandbox still blocks browser localhost navigation: passing the new runner compatibility contracts is not the same as running browser E2E or iPadOS hardware validation. See [release validation](VALIDATION.md). `ARCDROP_TEST_MODE` is strictly testing-only.

## 7. Build and install on OpenWrt

Use a matching OpenWrt 25.12 source/build environment:

```sh
cd /path/to/openwrt
ln -s /path/to/arcdrop package/arcdrop
make menuconfig
make package/arcdrop/compile V=s
find bin/packages -name 'smartsafehub-app-arcdrop*.apk'
```

The `smartsafehub-app-arcdrop` package depends on `uhttpd` and `libjson-c`, installs `/www/arcdrop/` assets and `/www/cgi-bin/arcdrop`, and places `root/etc/arcdrop.conf` at `/etc/arcdrop.conf` (default `lan_interface=br-lan`). Actual target-specific cross-builds remain to be verified. See [installation](INSTALLATION.md).

## 8. Real-router validation

1. Install an APK built for the exact target; use signed packages for release.
2. Verify uHTTPd HTTPS, `/www` document root, `/cgi-bin` handler, and a browser-trusted certificate matching the hostname.
3. Open `https://<router-LAN-host>/arcdrop/` on two browsers in the allowed trusted LAN.
4. Find the recipient, select a file, accept, complete transfer, and compare saved bytes.
5. Test rejection, cancellation, reload, offline peers, empty files, 64 MiB limit, guest/VLAN isolation, and mobile browsers.
6. Confirm `/tmp/arcdrop` stores metadata only and no payload reaches persistent router storage.

Public CA certificate issuance is **not** implemented. Accepting browser TLS warnings is not a release strategy. See [deployment security](DEPLOYMENT.md).

## 9. Troubleshooting

| Symptom | What to check |
|---|---|
| HTTPS notice and no peers at `localhost` | Expected when viewing `index.html` via HTTP without CGI; use `demo.html` for design |
| Demo assets do not refresh | Force browser reload / disable cache in devtools |
| `json-c` CGI test compile error | `brew install json-c pkgconf`, compiler and detected include/library paths |
| Node.js test output format mismatch | Run Node with `--test --test-reporter=tap` |
| macOS optional E2E fails | Install `brew install json-c pkgconf`, `python3 -m playwright install chromium`, or set `ARCDROP_E2E_BROWSER_PATH`; see [release validation](VALIDATION.md) |
| Router static UI returns 404 | `/www/arcdrop/index.html` installed? |
| CGI returns 404/403 | `/www/cgi-bin/arcdrop`, HTTPS, Origin, allowed IPv4 LAN? |
| Peer visible but transfer fails | Client isolation, VLAN, ICE host candidates and browser support |

## 10. Documentation and release checklist

- [ ] `shellspec` passes; new test scripts are registered once in `spec/contracts_spec.sh`.
- [ ] Preview desktop/mobile with both themes and reduced-motion settings.
- [ ] Check recipient approval, cancellation, 64 MiB limit, and no file payload on the router.
- [ ] Keep README/document links, Korean translations and changelog in sync.
- [ ] Use **one blank line between changelog release blocks**.
- [ ] Update `Makefile` revision and `web/index.html` displayed revision together.
- [ ] Do not add external assets, daemons or generated frontend build files.
- [ ] Do not claim real-device E2E success until it has actually been tested.

### ICE signaling (0.1.0-r9)

Offer and answer are sent after local ICE gathering completes (up to 10 seconds), with local candidates bundled in SDP. This reduces the candidate-order race between Firefox/Gecko and iPadOS/WebKit. Legacy trickled candidates remain accepted. No STUN/TURN service or file relay is added. A working LAN path is still required; a connection failure does not establish that STUN is necessary.

### Peer discovery and mobile recovery (0.1.0-r10)

- Discovery still uses the authenticated, LAN-only CGI protocol. No LAN scanning, cloud relay, or new browser runtime dependency is needed.
- A tab-scoped `sessionStorage` token is reused after page reload or back-forward cache restoration. The session is validated by `heartbeat`; an expired session is re-registered. Tokens are never persisted in `localStorage`.
- On `visibilitychange`, persisted `pageshow`, and `online`, the browser revalidates its session and refreshes the peer list. Background tabs are not promised continuous real-time discovery: the server expires them after 45 seconds of inactivity.
- Peer rows keep their identities, DOM nodes, and fixed desktop radial slots while other peers appear, disappear, or the CGI returns a different directory order. More than six devices switch to the existing list layout.
- The pencil button now opens a local device profile dialog. Display name (30 characters, 48 UTF-8 bytes maximum) and one of phone/tablet/laptop/desktop are sent to the authenticated `profile` endpoint without rotating the session or interrupting a transfer. Preference persistence is best-effort; restricted browser storage is supported.
- **Why not Bowser?** Bowser is MIT-licensed, but UA parsing cannot reliably identify a specific MacBook or iPad hardware model. ArcDrop deliberately remains a self-contained, unbundled browser app with no extra library, CDN, or compiled frontend artifact; users can correct the displayed type manually.
- Closing a tab may leave a stale device visible for up to the 45-second session TTL. This is intentional to avoid racing `sendBeacon` leave requests against page reload and tab restoration. A different tab maintains a different session.

Test with `node --test --test-reporter=tap tests/test_discovery.mjs` and `shellspec`. For real device validation, background an iPad tab for over 45 seconds, return, and verify rediscovery without a full reload. Confirm naming and icon edits are reflected on another device and that file transfers still succeed in both directions.

### Adaptive discovery polling (0.1.0-r11)

The browser sends optional `visible` and `busy` boolean hints with its regular `poll` request. The native CGI rejects malformed hints but remains compatible with older clients that omit them. The `peers` response exposes an advisory status based on the last poll (recent: 8 seconds), current visibility, and a transfer flag: `available`, `busy`, `away`, or `stale`. These hints are **not authentication**, proof of physical proximity, or a promise of direct WebRTC connectivity.

- Signal polling: **1,800 ms** idle foreground, **700 ms** active transfer, **12,000 ms** idle background.
- Peer-list refresh: **6,500 ms** idle, **3,500 ms** active.
- Temporary CGI failures use bounded backoff; they must not cancel an otherwise functioning WebRTC data channel.
- Hidden tabs skip peer-list refreshes. `visibilitychange` wakes a waiting polling loop. Browser timer throttling can delay these intervals, and a session expires after 45 seconds without successful requests.
- The actual router remains LAN-only, with no STUN/TURN service or file-content relay.

Run `shellspec` after edits. The CGI presence tests and Node discovery tests cover stale and legacy states, timer selection, and mobile resumption. The design preview uses simulated peers and must not be used to claim that live presence works.
