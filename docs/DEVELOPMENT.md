# ArcDrop development guide

**Languages:** [English](DEVELOPMENT.md) | [한국어](ko/DEVELOPMENT.md)

This guide describes ArcDrop **0.1.0-r7** from the accompanying source tree. **Static UI previews and real WebRTC file transfers are different tests.** The project remains a prototype pending validation on supported routers.

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
├── src/arcdrop.c                # HTTPS/LAN-limited native signaling CGI
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

`e2e/browser_e2e.py` starts temporary HTTPS/CGI services and uses Playwright Chromium browser contexts to test actual WebRTC transfer. It is **not** part of required ShellSpec CI.

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 e2e/browser_e2e.py
```

**Current limitation:** The optional E2E script assumes Linux `/usr/bin/chromium` and uses a minimal `-ljson-c` compilation path. These assumptions are not yet portable to macOS/Homebrew. Do not count the command as passing on Mac until adjusted and re-tested. `ARCDROP_TEST_MODE` and its temporary certificates are for testing only; never weaken production checks to run E2E.

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
| macOS optional E2E fails | Hardcoded Linux Chromium path and json-c compilation flags |
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
