# ArcDrop

[한국어](README.ko.md) | **English**

[![CI](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml)
![OpenWrt](https://img.shields.io/badge/OpenWrt-25.12-blue)
![License](https://img.shields.io/badge/License-GPL--3.0--or--later-blue)

**ArcDrop** is a lightweight file-sharing app for devices on the same local network, built for SmartSafeHub and OpenWrt. Send files directly between browsers without uploading them to a cloud service.

- Package: `smartsafehub-app-arcdrop` (`1.0.0-r1`)
- Platform: **OpenWrt 25.12**, uHTTPd HTTPS and CGI
- License: **GPL-3.0-or-later**
- Status: **1.0 release candidate** — not yet published in the official SmartSafeHub Apps catalog; signed package approval and real-router checks are required.

## Features

- **Direct transfers:** Encrypted WebRTC P2P transfer between browsers, without external STUN/TURN servers.
- **No files on the router:** The router handles discovery, approval and signaling only; no file bytes are sent to or stored on the router. Temporary connection metadata expires automatically.
- **Recipient approval:** A file transfer starts only after the receiving device accepts it.
- **Simple interface:** Nearby devices, editable device names, drag-and-drop, mobile layout, and light/dark themes.
- **Local-network protection:** HTTPS and trusted IPv4 LAN access are required; file size is limited to **64 MiB** (one transfer per browser).

## Getting started

Build and install the OpenWrt package by following the [installation guide](docs/INSTALLATION.md). A browser-trusted HTTPS certificate valid for the router's LAN hostname is required.

On two devices connected to the same trusted LAN, open:

```text
https://<router-LAN-host>/arcdrop/
```

Select the receiving device, choose a file, and accept the request on the receiver. Use **Save file** when the transfer completes. The download dialog closes automatically five seconds after requesting the save.

**Limitations:** IPv4 trusted LAN only; no remote transfers, IPv6, or transfers across client-isolated networks. Actual router and mobile-browser validation is still in progress. See [deployment and security](docs/DEPLOYMENT.md) and [validation](docs/VALIDATION.md).

## UI preview

```sh
cd web
python3 -m http.server 8080 --bind 127.0.0.1
```

Open [http://127.0.0.1:8080/demo.html](http://127.0.0.1:8080/demo.html). The demo is for visual preview only: it **does not send files** and is not included in the router package.

## Development and tests

```sh
shellspec
sh tools/lint.sh
```

See [development](docs/DEVELOPMENT.md) ([한국어](docs/ko/DEVELOPMENT.md)) for prerequisites, the OpenWrt build and browser E2E tests.

## Documentation

| Document | Description |
| --- | --- |
| [Installation](docs/INSTALLATION.md) | Build, install and remove the OpenWrt package |
| [Architecture](docs/ARCHITECTURE.md) | WebRTC, CGI, data flow and boundaries |
| [Deployment & security](docs/DEPLOYMENT.md) | HTTPS, trusted LAN and access control |
| [Development](docs/DEVELOPMENT.md) | Local environment, tests and troubleshooting |
| [Validation](docs/VALIDATION.md) | Real-device checks before release |
| [Changelog](CHANGELOG.md) | Version history |

## License

ArcDrop is distributed under [GPL-3.0-or-later](LICENSE).
