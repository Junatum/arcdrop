# ArcDrop release validation

This checklist applies to the actual **SmartSafeHub OpenWrt router**. Automated host tests cannot establish production HTTPS trust, client isolation, reliable iPadOS WebKit behavior, or SmartSafeHub Apps publication.

## 0.1.0-r20: protocol and storage regression checks

The browser E2E runner now waits for the **hidden state** of closed transfer and incoming dialogs; Playwright's default visible wait must not be used on `.hidden` elements. The Chromium smoke job still needs to pass on the GitHub Actions runner. Loopback navigation was denied in the isolated development environment, so that environment cannot establish a passing real-browser result.

- Signaling now carries an optional 24-hex `transferId` outside its strict legacy `body`. New browsers advertise `protocolVersion: 2` on registration and only send scoped invitations to peers that advertise the same version. Older browsers continue the legacy protocol, including mixed-version peer pairs. Confirm that a delayed old `bye`/`decline` cannot interrupt the next transfer with the same peer.
- Unprocessed messages are not immediately acknowledged. The browser retries a handler error at most three times; terminal errors are acknowledged to prevent a permanent resend loop. Failed CGI request transport is bounded by AbortController and a signaling request retries with the original `requestId`.
- Duplicate tabs normally obtain separate CGI sessions through BroadcastChannel (where available); browsers that block BroadcastChannel retain the legacy per-tab session policy. Test duplicated tabs, reload and BFCache on iPad Safari.
- New senders include a SHA-256 digest in the WebRTC `end` control message for **all file sizes up to 64 MiB**. For files up to 8 MiB, browsers with WebCrypto may use its digest API; larger files are hashed incrementally from the existing 16 KiB send/receive chunks. This avoids allocating a second full-file buffer. A mismatch or missing digest from a sender that advertised `integrity: sha256` prevents download and ACK. Legacy peers without integrity metadata retain the previous optional-digest behavior; verify old-peer transfers manually if needed. The browser's file picker/save dialog is not proof of a disk write.
- Stale atomic temporary files are removed only after 120 seconds during the periodic cleanup pass and only when they are ordinary files, privately owned, and match known temporary suffixes. Inspect only counts/permissions, not token-bearing session JSON.

Commands:

```sh
python3 tests/test_cgi.py
node --test tests/*.mjs
python3 tests/test_e2e_portability.py
sh tests/test-build-prepare.sh
# Run with installed Playwright browser on a normal local or CI host:
ARCDROP_E2E_BROWSER=chromium python3 e2e/browser_e2e.py
```

## Host contracts

```sh
shellspec
sh tools/lint.sh  # host-only, requires native/npm/Python lint tools
node --test --test-reporter=tap tests/test_discovery.mjs
python3 tests/test_e2e_portability.py
```

On macOS install the native test prerequisites with `brew install json-c pkgconf`.

## Optional host C coverage

When GCC and gcov are installed, run `sh tools/coverage.sh` to compile the
real CGI with coverage instrumentation, execute all host CGI regression cases,
and print gcov line/branch summaries. The runner uses a temporary directory,
removes coverage files afterward, and never changes the production binary or
OpenWrt package. Coverage results depend on the host platform and cannot
substitute for target-router performance tests.

## Optional desktop browser integration

The test harness launches a local-only, short-lived HTTPS server and the **actual ArcDrop CGI**. The certificate is generated in an isolated temporary directory, and HTTPS verification is bypassed **only in the E2E test's Playwright context**. The production website and CGI remain unchanged.

```sh
python3 -m pip install 'playwright>=1.50,<2'
python3 -m playwright install chromium
python3 e2e/browser_e2e.py
```

- macOS: Chrome/Chromium/Edge is auto-discovered where installed. You can select a binary using `ARCDROP_E2E_BROWSER_PATH`.
- Linux: Chromium is searched on `PATH` before the Playwright-managed browser.
- Optional alternative engine (after installation): `ARCDROP_E2E_BROWSER=webkit python3 e2e/browser_e2e.py` or `firefox`.
- On GitHub Actions, run **Optional browser E2E** manually and select a runner and browser. This is intentionally separate from fast, mandatory ShellSpec CI. It does not upload artifacts.

The E2E script checks **both transfer directions**, received file bytes, rejection, and that router CGI JSON state contains no file body. It does **not** emulate a real iPadOS device; macOS WebKit and iPadOS Firefox still require real-device tests. If a managed browser blocks loopback navigation, use a normal developer machine; do not weaken production CSP, ICE, or TLS checks.

## On-router read-only checks

Replace `192.168.1.1` with the actual trusted LAN address and run the following commands on the router:

```sh
apk info -e smartsafehub-app-arcdrop
ls -l /www/arcdrop/index.html /www/arcdrop/app.js /www/arcdrop/js/core.js /www/arcdrop/js/transfer.js /www/arcdrop/style.css /www/arcdrop/icon.svg /www/cgi-bin/arcdrop
cat /etc/arcdrop.conf
/etc/init.d/uhttpd status
uci show uhttpd.main
ip -4 addr show br-lan
ls -ld /tmp/arcdrop
```

Do not print files in `/tmp/arcdrop` to bug reports: they contain short-lived authorization tokens and ICE information. The directory should contain only peer metadata, `.lock` and `.cleanup`; `.transaction` may appear during a two-peer signaling update but should not remain after a successful request. No received file content belongs there. Check that `/www/arcdrop/demo.html` and `/www/arcdrop/demo.js` do not exist.

## Manual device and network matrix

The checkboxes are **not** evidence of completion until the maintainer performs them on the indicated hardware and records results.

- [ ] Mac Firefox → iPad Firefox (WebKit): text file, zero-byte file, 64 MiB boundary
- [ ] iPad Firefox → Mac Firefox: same files and integrity hashes
- [ ] Safari ↔ Safari and Android Chrome ↔ desktop: forward and reverse transfer
- [ ] Decline, cancel, stale invitation timeout, navigation while transferring, background resume
- [ ] Long-running 2+ device discovery, peer order stability, presence labels and idle CGI overhead
- [ ] Guest Wi-Fi, isolated VLAN, WAN ingress and DNS-over-HTTPS: no unintended discovery
- [ ] Production CA-trusted HTTPS hostname and certificate renewals: no browser warnings
- [ ] On all supported routers: CPU/memory/disk behavior, especially GL-MT300N-V2
- [ ] Firmware update: official Apps installation, signed catalog publication and restore

## External dependencies and release blockers

The standalone ArcDrop repository **cannot** complete the following without additional repositories, accounts or physical hardware:

1. Trusted certificate issuance/renewal and split-horizon LAN DNS (SmartSafeHub Hub, CA/DNS provider and operational validation).
2. Official SmartSafeHub Apps catalog metadata, signing, approvals and firmware-update restoration (Hub, Data Pipeline and LuCI source trees).
3. Cross-compilation on all target toolchains and supported-router/iPad/Android end-to-end validation.

Do not claim any of these are implemented or tested solely because ShellSpec or desktop E2E passes.

## Automated release checks in 0.1.0-r19

- Mandatory GitHub Actions `browser_smoke` job: two independent Chromium contexts, actual host-compiled CGI under temporary HTTPS, bidirectional payload equality, empty file, decline, pre-approval cancellation, reload/rediscovery and metadata-only router state. No artifacts are uploaded. A *passing* job proves only host browser behavior, not iPadOS or a real router.
- Manual **Optional browser E2E** workflow: select Firefox or WebKit and optionally enable **large_file**. For an exact-size 64 MiB payload, use `ARCDROP_E2E_LARGE=1 python3 e2e/browser_e2e.py`. Compare stored file bytes with a streaming SHA-256, without relying on File System Access API. The test does not measure or guarantee iPad RAM usage.
- CGI concurrency probe, run on a **development host only**:

```sh
python3 tools/bench_cgi.py --clients 2,6,12 --polls 8
# Optional, explicit host-only limit (not suitable as a universal CI threshold):
python3 tools/bench_cgi.py --clients 2,6,12 --polls 8 --max-p95-ms 300
```

The probe compiles the real CGI in `ARCDROP_TEST` mode, creates temporary independent loopback clients to honor the production per-IP rate bound, and performs concurrent `poll`/`peers` requests. It records CGI p50/p95, lock p95 and subprocess wall p95 from `Server-Timing`, **not** actual router CPU/memory/network latency. Output contains no IPs, session IDs, tokens or SDP. It runs without changing the production CGI, and any `--json-out` is an explicitly requested local file rather than a CI artifact.

## Router performance acceptance record (human-operated)

Use a **trusted test LAN and a device where you have administrative permission**. These measurements must be performed for each supported router; this repository has no direct access to hardware. Avoid `cat /tmp/arcdrop/*.json`, which reveals authorization tokens and SDP/ICE.

1. Record router model, firmware revision, architecture, available RAM, available `/tmp` space, CPU load, attached client count, and browser/OS versions. Optionally copy `tools/router-sample.sh` manually to the router and run `sh router-sample.sh 10 30` (one snapshot every 10 seconds, 30 snapshots; no network calls, token access or installed service). On the router, read only the following values before and after testing:

   ```sh
   uptime
   free
   df -k /tmp
   ps w | grep '[u]httpd'
   ```

   `router-sample.sh` deliberately refuses to run on macOS. The ShellSpec sampler contract uses mocked OpenWrt commands, so developers do not need `free` or `/proc/meminfo` on their Macs. On Linux/OpenWrt, the sampler uses `/proc/meminfo` when the `free` applet is unavailable.

2. Connect 2, then 6, then 12 **real devices** when available. Keep a browser tab open on each, watch discovery for 10 minutes per group, and record p50/p95 `Server-Timing: cgi;dur=..., lock;dur=...` for successful authenticated `poll` responses using the browser Network inspector. Count errors, timeouts, peer churn and `429` rate limits. **Do not paste request bodies, tokens, peer IDs, Origin/cookie headers or full captured HAR files into bug reports.** The 24 total peer and 4 per-IP limits still apply.
3. Inspect load/RAM/tmpfs before, during and after the session. Capture maxima and note battery/thermal behavior, especially GL-MT300N-V2. Confirm guest VLAN and WAN clients cannot discover or connect. No benchmark is complete unless the target hardware and network isolation checks are recorded.
4. For iPadOS Safari and Firefox (WebKit), send zero bytes, a small file and an exact 64 MiB file in **both directions** with a desktop. Use SHA-256 on the receiving device when tooling is available, otherwise compare the exact bytes via a trusted local file tool. Repeat with a backgrounded tab, cancel-before-accept, approval timeout and reload. Record whether Safari is terminated/reloads under memory pressure; desktop WebKit does not substitute for iPadOS.
5. Attach only **sanitized aggregate measurements** to the release notes. Do not claim CPU, p95, RAM, WebKit stability or throughput figures until an actual measurement has been recorded.

Suggested private report fields: `date`, `model`, `firmware`, `architecture`, `browser/OS`, `clients`, `duration`, `CGI p50/p95`, `lock p95`, `RAM available min`, `/tmp available min`, `CPU/load`, `errors`, `file sizes`, `SHA-256 match`, `isolation result`, `outcome PASS/FAIL/not run`. Do not upload personal file names, transfer bodies, local IPs, auth tokens, certificates or network traces.
