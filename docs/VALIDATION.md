# ArcDrop release validation

This checklist applies to the actual **SmartSafeHub OpenWrt router**. Automated host tests cannot establish production HTTPS trust, client isolation, reliable iPadOS WebKit behavior, or SmartSafeHub Apps publication.

## Host contracts

```sh
shellspec
node --test --test-reporter=tap tests/test_discovery.mjs
python3 tests/test_e2e_portability.py
```

On macOS install the native test prerequisites with `brew install json-c pkgconf`.

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
ls -l /www/arcdrop/index.html /www/arcdrop/app.js /www/arcdrop/style.css /www/arcdrop/icon.svg /www/cgi-bin/arcdrop
cat /etc/arcdrop.conf
/etc/init.d/uhttpd status
uci show uhttpd.main
ip -4 addr show br-lan
ls -la /tmp/arcdrop
```

Do not print files in `/tmp/arcdrop` to bug reports: they contain short-lived authorization tokens and ICE information. The directory should contain only metadata and a `.lock` file, not received file content. Check that `/www/arcdrop/demo.html` and `/www/arcdrop/demo.js` do not exist.

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
