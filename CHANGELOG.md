# Changelog

All notable changes to ArcDrop are documented here. Releases follow the OpenWrt package revision (`PKG_VERSION`-r`PKG_RELEASE`).

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
