# Changelog

All notable changes to ArcDrop are documented here. Releases follow the OpenWrt package revision (`PKG_VERSION`-r`PKG_RELEASE`).


## 0.1.0-r22 (2026-11-20)

### Improved
- After choosing Save file, show a five-second countdown and automatically close only the download dialog. The dialog remains open until Save file is clicked, and users can still close it immediately.
- Keep the received Blob URL available throughout the countdown; allow another save request to restart the countdown without changing WebRTC transfer behavior.

### Compatibility
- Keep browser-triggered downloads, LAN-only WebRTC file transfers, router file-storage policy and the existing package dependencies unchanged. Do not add frontend build artifacts.

### Tests
- Verify countdown timing, manual closing, repeated save requests, URL cleanup and unchanged download handling; check the same dialog structure in the production page and design preview.


## 0.1.0-r21 (2026-11-19)

### Improved
- Simplify the English and Korean READMEs around features, getting started, UI preview and documentation, following the SmartSafeHub repository style.
- Keep detailed build, security and release-validation guidance in the existing documentation rather than duplicating it in the README.

### Compatibility
- Keep the existing WebRTC protocol, OpenWrt dependencies and router file-storage policy unchanged. No new release-gate tooling or frontend build output.

### Tests
- Verify concise bilingual READMEs, required safety information, documentation links and synchronized package/UI versions.


## 0.1.0-r20 (2026-11-18)

### Fixed
- Fix the Chromium E2E wait for hidden transfer/consent dialogs; use Playwright's hidden state instead of waiting for a hidden element to become visible.
- Keep signaling messages unacknowledged on transient processing errors; retry a bounded three times before terminal handling.
- Isolate new and earlier transfers between the same devices using a scoped transfer ID for server consent and browser signaling.

### Improved
- Set explicit CGI request timeouts and retain idempotent request identifiers across uncertain signaling retries.
- Detect cloned sessionStorage tokens between open tabs through BroadcastChannel where supported, registering an independent session for the new tab.
- Check generated session paths for truncation and remove only stale, private, owned, regular atomic-write temporary files.
- Optionally verify files up to 8 MiB using end-to-end WebCrypto SHA-256; keep the 64 MiB limit and avoid full-buffer hashing on larger files to protect mobile memory.

### Compatibility
- Preserve legacy signaling without transfer IDs, LAN-only HTTPS restrictions, direct WebRTC file payload transfer and the existing OpenWrt package dependencies.
- Do not store file contents or hashes as persistent file data on the router. Do not add a frontend build step.

### Tests
- Cover Playwright hidden-state waits, transfer ID consent/late-message isolation, retry acknowledgements, request timeouts, cloned tabs, integrity mismatch and safe stale temporary file cleanup.
- Keep manual physical-router and iPad Safari acceptance tests separate from host automation.


## 0.1.0-r19 (2026-11-18)

### Fixed
- Let an inviting device cancel a not-yet-approved transfer without letting unrelated peers send cancellation messages; dismiss a pending consent dialog when the cancellation arrives.

### Improved
- Run genuine Chromium-to-Chromium CGI/WebRTC transfer smoke checks automatically on push and pull requests, while retaining manually selected Firefox/WebKit checks.
- Add an optional exact-64-MiB transfer test with streaming SHA-256 verification and no dependency on a browser file-system access API.
- Add an isolated native CGI load probe for 2, 6, and 12 simultaneous virtual clients that reports anonymous Server-Timing percentiles and lock waits. Provide a portable read-only resource sampler for manual router tests.

### Compatibility
- Keep OpenWrt package dependencies and LAN-only production access checks unchanged; multiple loopback test clients are accepted only by the ARCDROP_TEST build.
- Do not include browser test tooling, load probes, temporary certificates, or file payloads in the router package.

### Tests
- Exercise bidirectional transfer, empty files, rejection, pre-approval cancellation and tab reload through the browser E2E runner.
- Verify CGI pre-approval cancellation authorization, load probe statistics, CI integration and absence of authorization tokens in benchmark reports.
- Document real-device browser, router timing, resource usage and network-isolation acceptance checks separately from host results.


## 0.1.0-r18 (2026-11-18)

### Fixed
- Keep unacknowledged WebRTC signaling messages until the receiving browser confirms processing, avoiding lost invites or SDP after an interrupted HTTP response.
- Reject premature DataChannel transfer-complete acknowledgements and out-of-order file chunks.

### Improved
- Add bounded signal IDs, duplicate-request protection, short-lived message retry and automatic expiry while preserving legacy one-shot polling.
- Reduce repeated transfer UI updates and timer resets; group received chunks into 1 MiB Blob segments to limit retained JavaScript buffers.
- Expose non-sensitive CGI and lock-wait timing through the standard Server-Timing response header.

### Compatibility
- Keep the LAN-only HTTPS/consent policy, 64 MiB file limit, 16 KiB DataChannel chunks, no STUN/TURN and no file payload storage on the router.
- Preserve older clients that do not send a poll acknowledgement list and continue supporting browsers without direct-to-disk save APIs.

### Tests
- Verify lost-response redelivery, idempotent invite/accept retries, acknowledgement validation, message expiry and existing session protections.
- Test browser duplicate suppression, transfer phase checks, segmented receive integrity and progress/timer throttling.


## 0.1.0-r17 (2026-11-17)

### Improved
- Reformat the UI CSS and HTML to make visual styles and screen regions easier to maintain without changing the file-sharing protocol.
- Keep lint tools in host-side development dependencies, not in OpenWrt firmware or browser bundles.

### Added
- Enforce C, JavaScript, CSS, HTML, Python, Shell, GitHub Actions YAML and SVG XML checks in an unconditional CI job.
- Add lint configuration and contract checks for the lint workflow and formatted UI assets.

### Tests
- Make CSS/HTML visual regressions independent of insignificant formatting whitespace and verify readable stylesheet structure.
- Retain CGI and WebRTC regression coverage after the source formatting change.
- Add an optional GCC/gcov host runner for native CGI line and branch coverage.


## 0.1.0-r16 (2026-11-17)

### Improved
- Split the browser client into native ES modules for session management, device discovery, signaling, file transfer and UI, without a bundler.
- Keep the app entry point focused on startup and DOM event listeners; install all modules with the OpenWrt package.

### Compatibility
- Preserve HTTPS/CSP, LAN-only ICE, explicit transfer consent, JSON CGI contracts and the isolated design demo.

### Tests
- Add module graph, installation and browser fixture regressions for the unbundled client.


## 0.1.0-r15 (2026-11-17)

### Fixed
- Reject unsafe or oversized session files and require private ownership for the state directory and lock.
- Restore both peers' previous signaling state if a two-device update is interrupted or fails.

### Improved
- Limit queued signaling JSON to 64 KiB per device in addition to the existing message count limit.
- Check expired session files periodically instead of scanning the entire state directory on every poll.

### Compatibility
- Keep the existing HTTPS/LAN checks, client API, 45-second session expiry and direct browser-to-browser file transfers.

### Tests
- Add session file, queue size, cleanup interval, and interrupted update recovery regression tests.


## 0.1.0-r14 (2026-11-17)

### Improved
- Split the native signaling CGI into focused modules for HTTP, LAN access, session storage, peer sessions, and WebRTC signaling.
- Pass per-request state explicitly instead of sharing mutable process globals, without changing the LAN-only or file-content isolation rules.
- Keep the existing single CGI executable and lightweight OpenWrt package requirements.

### Compatibility
- Preserve existing API actions, JSON response format, error messages, session lifetimes, and HTTP checks.

### Tests
- Compile every native module in host CGI and optional browser E2E tests; verify OpenWrt copies and links all sources.
- Add module boundary, request-context and build regression checks to the required ShellSpec suite.


## 0.1.0-r13 (2026-11-17)

### Fixed
- Mask the radar origin so the transient center crosshair no longer flashes around the local device in light theme.
- Refined the theme-toggle icon styling and replaced the moon glyph with a clearer crescent for light mode.

### Improved
- Increased dark-theme radar-wave contrast and glow so outward discovery motion is easier to see.

### Tests
- Added UI regression checks for the radar center mask, theme-toggle polish, and dark/light wave styling.


## 0.1.0-r12 (2026-11-17)

### Fixed
- Automatically expire unanswered incoming file invitations after 30 seconds without leaving stale modal or busy state.
- Isolate failed signaling messages so malformed or rejected SDP does not discard subsequent messages from the same poll.

### Improved
- Make the optional real-browser E2E harness portable across macOS and Linux, including Homebrew json-c discovery and LibreSSL-compatible temporary certificates.
- Add forward/reverse WebRTC transfer, rejection and router-payload-isolation scenarios and a manually triggered cross-platform browser CI workflow.
- Document supported-device validation, HTTPS trust, firmware compatibility and Apps publication as separate release gates.

### Tests
- Add Korean regression tests for invitation cleanup, signaling failures, browser binary selection, certificate generation and E2E isolation.
- Keep the standalone E2E workflow optional; required ShellSpec contracts must remain offline and fast.


## 0.1.0-r11 (2026-11-17)

### Improved
- Reduced idle discovery CGI traffic with adaptive polling: 1.8-second foreground signal checks and 6.5-second peer-list refreshes; retain faster checks during active transfers.
- Slowed background discovery to 12-second intervals while preserving mobile resume and session revalidation.
- Added advisory device presence labels for available, transferring, away, and delayed-response browsers; never claim that presence guarantees a WebRTC connection.
- Added bounded retry delays for temporary CGI errors without aborting an established direct file transfer.

### Compatibility
- Keep STUN/TURN disabled and accept poll requests from older clients without the optional presence hints.
- Preserve the existing 45-second session expiry, HTTPS restrictions, and zero file-body storage on the router.

### Tests
- Added real CGI tests for presence state transitions, strict boolean validation, stale sessions, and legacy clients.
- Added browser tests for adaptive polling, mobile wakeup, presence labels, and transient polling errors.


## 0.1.0-r10 (2026-11-17)

### Fixed
- Recover expired discovery sessions when returning to ArcDrop from an iPadOS background tab, without requiring a reload.
- Reuse valid per-tab sessions after refresh to avoid duplicate peers and unnecessary per-IP session-limit errors.
- Handle restricted browser storage without preventing discovery from starting.

### Improved
- Keep discovered devices in stable radial slots and reuse their DOM elements while refreshing the peer list.
- Allow users to edit their device name and icon independently, with local preferences and an authenticated server-side profile update.
- Preserve LAN-only WebRTC, strict CSP, and zero external JavaScript dependencies; avoid UA fingerprinting for hardware model names.

### Tests
- Added tests for session revalidation, profile updates, stable peer positions, restricted storage, and browser lifecycle recovery.


## 0.1.0-r9 (2026-11-17)

### Fixed
- Wait for ICE gathering before sending the offer or answer, so local LAN candidates are included in SDP and signaling does not depend on independently ordered candidate requests.
- Continue processing remaining legacy ICE candidates when an individual candidate is rejected by the browser.

### Improved
- Report ICE gathering timeouts and missing LAN candidates explicitly without adding public STUN/TURN servers or relaying file data through the router.
- Permit a modestly larger bounded SDP payload for gathered LAN candidates.

### Tests
- Added Firefox/WebKit-style asynchronous ICE gathering and both signaling-direction regression tests, rejected-candidate isolation, and SDP size-bound checks.


## 0.1.0-r8 (2026-11-17)

### Fixed
- Prevented a successfully received file from being reported as a transfer failure when the peer closes the WebRTC channel after acknowledgment.
- Removed runtime inline-style writes that triggered strict Content Security Policy warnings in Firefox.
- Detected iPadOS desktop-class Safari correctly instead of labeling an iPad as a Mac.

### Improved
- Sent a validated device category through the existing LAN discovery API so icons remain correct after users rename a device.
- Used a native HTML progress indicator and predefined CSS classes without relaxing the existing CSP.

### Tests
- Added CGI device-category validation tests, iPadOS detection cases, successful-transfer teardown regression tests, and strict CSP source contracts.


## 0.1.0-r7 (2026-11-17)

### Fixed
- Fixed OpenWrt package preparation failing with `Error 126` when an undefined `$(MKDIR)` expansion left the build directory path as a command.
- Create the package build directory with portable `mkdir -p` before copying source and license files.

### Tests
- Added a real GNU Make preparation contract using stub OpenWrt includes, validating copied file contents and rejecting the broken `$(MKDIR)` recipe.


## 0.1.0-r6 (2026-11-17)

### Improved
- Made English the default language for the README, changelog, and developer documentation.
- Added a Korean README and retained an updated Korean development guide under `docs/ko/`.
- Standardized changelog release separation to **one blank line**.

### Added
- Added installation, architecture, contributing, and security documentation.

### Tests
- Added ShellSpec documentation contracts covering language selection, internal links, package versions, and changelog formatting.
- Corrected the ShellSpec changelog description to match the one-blank-line rule.


## 0.1.0-r5 (2026-11-17)

### Improved
- Replaced the ArcDrop icon with a smoothly connected infinity-flow symbol.
- Refined the cyan transfer highlight so it follows the same continuous curve.
- Reused the same icon in the main UI, transfer dialog, design preview, and browser tab.

### Tests
- Added checks for SVG self-containment, the continuous transfer path, consistent production/demo usage, and package installation.


## 0.1.0-r4 (2026-11-17)

### Improved
- Increased outward discovery waves from three to five and extended their reach.
- Introduced a dedicated ArcDrop symbol instead of the previous arrow icon.

### Tests
- Strengthened tests for wave count, timing, size, and mobile presentation.
- Checked icon consistency between the production UI and design preview.


## 0.1.0-r3 (2026-11-17)

### Improved
- Redesigned discovery around the local device, surrounded by nearby peers.
- Added outward-moving discovery waves from the center device.
- Simplified sending to selecting a recipient first, then choosing a file.
- Moved incoming requests, transfer progress, and completion into dialogs.
- Improved the mobile layout and light/dark themes.

### Added
- Added a local, backend-free design preview.
- Added drag-and-drop file sending to a recipient device on desktop.

### Tests
- Added contracts for discovery animation, device selection, demo isolation, and mobile layout.
- Confirmed design preview files are excluded from OpenWrt packages.


## 0.1.0-r2 (2026-11-17)

### Improved
- Unified testing with a Jarbis-style ShellSpec contract suite.
- Kept optional browser transfer E2E checks separate from required contracts.

### Tests
- Integrated CGI, WebRTC, JavaScript syntax, OpenWrt compatibility, and package checks into ShellSpec.
- Added safeguards against missing ShellSpec test registrations and skipped CI checks.
- Added package-version and changelog-format verification.


## 0.1.0-r1 (2026-11-17)

### Added
- Introduced ArcDrop for direct file transfer between devices on the same trusted LAN.
- Required the recipient to explicitly accept before establishing a transfer.
- Kept file contents off the router: it handles discovery and connection metadata only.

### Improved
- Reused the existing OpenWrt HTTPS web server instead of deploying another TLS service.
- Kept short-lived device and signaling metadata in temporary memory-backed storage.
- Avoided a Node.js runtime to suit resource-constrained routers.

### Compatibility
- Requires OpenWrt uHTTPd with HTTPS and CGI enabled.
- Initial scope: IPv4 trusted LAN and one file of up to 64 MiB per transfer.
- Browser certificate trust depends on the router's existing HTTPS configuration.

### Tests
- Added checks for HTTPS, LAN access restrictions, session tokens, recipient approval, signaling, and temporary metadata.
