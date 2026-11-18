# ArcDrop

**Languages:** [English](README.md) | [한국어](README.ko.md)

**ArcDrop — by SmartSafeHub**. Lightweight, open-source, LAN-only peer-to-peer file sharing for OpenWrt.

[![Lint](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml)
![OpenWrt](https://img.shields.io/badge/OpenWrt-Compatible-blue)
[![License: GPL v3+](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

- License: **GPL-3.0-or-later**
- Package: `smartsafehub-app-arcdrop` (`0.1.0-r20`).
- Sender/receiver browsers transfer file bytes via encrypted **WebRTC RTCDataChannel**, with `iceServers: []` (no external STUN/TURN).
- The router only serves a small local UI and passes bounded discovery/SDP/ICE metadata; **no file bytes are sent to or stored on the router**, cloud or local disk.
- The signaling metadata (device name, IP, session token, SDP/ICE messages) temporarily resides in `/tmp/arcdrop` (tmpfs). Session metadata expires after 45 seconds of inactivity.
- Uses the existing OpenWrt **uHTTPd HTTPS /cgi-bin** handler. No Node.js, Python, database, dedicated server process, or certificate issuing backend is required.

## Start using it (after building and installing the `.apk` package)

1. Confirm uHTTPd has an **HTTPS listener** with a browser-trusted certificate valid for the address used; confirm `cgi_prefix=/cgi-bin` and the default document root `/www`.
2. Visit `https://<your-router-LAN-host>/arcdrop/` on two browsers connected to the **trusted LAN**. Avoid visiting via HTTP; API requests are refused over HTTP.
3. Click the recipient device and select a file (maximum **64 MiB**) from the browser file picker; on desktop you can also drop a file onto a recipient.
4. The recipient explicitly accepts; once directly connected the file is streamed in 16 KiB chunks. The recipient uses **Save file** to download locally.

**HTTPS caveat:** ArcDrop deliberately **does not** issue certificates. If the router's HTTPS certificate is self-signed or does not match the URL, browsers may refuse secure-context features (especially mobile browsers). Never tell end users to bypass TLS warnings as a permanent solution. Obtain a trusted certificate before a public release. See [deployment and security](docs/DEPLOYMENT.md).

**Device labels:** ArcDrop detects phones/tablets/computers from the browser and sends the category separately from the editable display name. iPadOS Safari can identify itself as macOS; touch capability is checked to classify it as an iPad. For privacy, browsers do not reliably expose exact models such as "MacBook Pro" or "iPad Pro"; use the pencil icon beside your device name to set a custom label. Device categories are display hints, not trusted device identities.

**Network caveat:** The CGI permits access only from the IPv4 subnet assigned to `br-lan` by default. It intentionally fails closed for IPv6 and missing interfaces. Configure a different *trusted* LAN interface with `/etc/arcdrop.conf` if necessary. Keep guest/IoT client isolation and WAN firewall rules enabled. A LAN with client isolation can block WebRTC host candidates; ArcDrop does not use TURN to work around that isolation.

## Build as a local OpenWrt package

Place this repository directory (named `arcdrop`) within the OpenWrt build tree, e.g.

```sh
ln -s /path/to/arcdrop /path/to/openwrt/package/arcdrop
cd /path/to/openwrt
make menuconfig   # Network -> ArcDrop, package `smartsafehub-app-arcdrop`
make package/arcdrop/compile V=s
```

OpenWrt 25.12 APK package support is targeted; the `.apk` output is emitted by the target's package build. This archive contains **source**, not a target-architecture `.apk`.

To remove, uninstall `smartsafehub-app-arcdrop`; its `/www/arcdrop/`, `/www/cgi-bin/arcdrop`, and `/etc/arcdrop.conf` packaged paths are removed by the package manager. Volatile `/tmp/arcdrop/` metadata disappears at reboot (and can be removed after ArcDrop has no active users).

## Preview the UI on macOS (without OpenWrt)

```sh
cd web
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://127.0.0.1:8080/demo.html**. The preview shows three sample devices and interactive buttons for an empty discovery screen, incoming request, progress, completion, and HTTPS error. The rings expand outward from the center device, with a reduced-motion fallback. Switch the light/dark theme using the header button. The preview does not call a signaling API or transmit files, and its HTML/JavaScript are deliberately **not installed on the router**.

The normal `index.html` page can also be opened locally to inspect its layout, but will display an HTTPS requirement notice. This does not disable production HTTPS checks. See the [development guide](docs/DEVELOPMENT.md) ([한국어](docs/ko/DEVELOPMENT.md)).

## Test

```sh
shellspec
```

For host-only multi-language lint after installing the documented prerequisites,
run `sh tools/lint.sh`. To measure the native CGI with GCC/gcov, run
`sh tools/coverage.sh` (optional). See [development](docs/DEVELOPMENT.md).

The default CI also runs a real Chromium/CGI browser smoke check. For host-only CGI concurrency measurements use `python3 tools/bench_cgi.py --clients 2,6,12 --polls 8`; these are **not router performance results**. See [release validation](docs/VALIDATION.md).

As in Jarbis, `.shellspec` and `spec/contracts_spec.sh` run Korean-language contracts. CI first executes `sh tests/test-suite-integrity.sh` and `sh tests/test-openwrt-commands.sh` to catch missing tests and BusyBox violations. The tests compile a host **test-only** CGI binary, run the existing Python and Node.js tests, and check packaging, JavaScript syntax, and CHANGELOG formatting. No frontend build files are produced. Requires ShellSpec 0.28.1, Python 3, Node.js, a C compiler, and json-c development headers.

On macOS with Homebrew, install the native CGI test dependency if it is missing:

```bash
brew install json-c pkgconf
```

The CGI tests accept `pkg-config`/`pkgconf` or an installed Homebrew `json-c` prefix.
The Node.js tests explicitly use the TAP reporter, so ShellSpec assertions do not
vary between the `# pass` and `ℹ pass` formats printed by different Node.js releases.

To run the CI preflight checks without ShellSpec installed:

```sh
sh tests/test-suite-integrity.sh
sh tests/test-openwrt-commands.sh
```

## Known MVP limits

- Browser compatibility and router-performance testing **on actual supported hardware have not been completed**.
- File size capped at 64 MiB to constrain receiver memory on iOS/Safari and other browsers; one transfer at a time per browser.
- HTTPS requires an already valid, trusted certificate. Public ACME issuance, DNS automation and SmartSafeHub Apps Store registration are **not implemented** in this standalone repository.
- IPv4 trusted LAN only; IPv6, guest networks, large-file streaming-to-disk, multi-file queuing and remote transfer are not supported.
- Signaling is acknowledged and bounded, but in-progress WebRTC file transfers do not survive a tab reload; session metadata remains transient. Only transfer content goes via WebRTC/DTLS; signaling TLS security depends on the uHTTPd certificate.

## Documentation

- [Release validation checklist](docs/VALIDATION.md)
- [Development guide](docs/DEVELOPMENT.md) ([한국어](docs/ko/DEVELOPMENT.md))
- [Installation](docs/INSTALLATION.md) and [Deployment security](docs/DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md) and [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Repository

- `src/arcdrop.c`, `src/arcdrop.h` and the other `src/*.c` modules: single bounded, same-origin, LAN-restricted native CGI. See [architecture](docs/ARCHITECTURE.md) for module responsibilities.
- `web/`: static **source** HTML/CSS/vanilla JS (no bundler output). The central-device discovery UI displays outward animated signal waves, surrounding recipient devices, and modal transfer states.
- `web/icon.svg`: original ArcDrop continuous infinity-flow mark, shared by the header, transfer dialog, demo, and browser favicon. Included in the OpenWrt package; SVG source only, no external assets.
- `web/demo.html`, `web/demo.js`: local design preview **only**, excluded from the OpenWrt package and incapable of real transfer.
- `Makefile`, `root/etc/arcdrop.conf`: OpenWrt APK package sources. The tracked configuration is installed unchanged at `/etc/arcdrop.conf`.
- `spec/contracts_spec.sh` and `.shellspec`: Jarbis-style ShellSpec test specification.
- `tests/`: CGI, browser client and OpenWrt/package contracts; CI integrity guard.
- `e2e/browser_e2e.py`: optional Playwright/WebRTC integration test (separate manual GitHub Actions workflow, not part of mandatory ShellSpec CI).
- `docs/DEPLOYMENT.md`: security, HTTPS and validation notes.

For an **optional** two-browser test on macOS or Linux (requires Playwright, OpenSSL, and a host C compiler/json-c):

```sh
python3 -m pip install 'playwright>=1.50,<2'
python3 -m playwright install chromium
python3 e2e/browser_e2e.py
```

The E2E runner now detects local Chrome/Chromium on Mac and Linux and can use `ARCDROP_E2E_BROWSER_PATH` for a custom binary. To try another desktop engine, set `ARCDROP_E2E_BROWSER=webkit` or `firefox` after installing that browser with Playwright. The E2E checks **both transfer directions, decline, and payload isolation**; it is not an iPadOS emulator. It could not run in the current sandbox due to blocked loopback navigation, so it remains optional and must be tested on a normal developer machine. See [release validation](docs/VALIDATION.md).

### Discovery cadence and presence (0.1.0-r11)

ArcDrop uses adaptive signaling polls: 1.8 seconds while idle, 0.7 seconds during active sends/receives, and 12 seconds while backgrounded and idle. Peer-list refreshes occur every 6.5 seconds when idle or 3.5 seconds during a transfer. Background tabs skip the peer-list lookup entirely. Returning to the tab immediately wakes discovery. These are target delays; browsers may throttle timers.

The peer list can show **Send file**, **Transferring**, **Away**, or **Delayed response** based only on recent browser polling. Presence is advisory and **does not guarantee ICE/P2P reachability**. Peers marked busy or unavailable cannot be selected until they respond again. The router retains only bounded, temporary session metadata; it never receives file data.
