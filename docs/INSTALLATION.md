# Installing ArcDrop on OpenWrt

ArcDrop is currently a **source-only OpenWrt 25.12 package**. No built `.apk` is included. Supported-router cross-compilation and production validation are still pending.

## Requirements

- An OpenWrt 25.12 build tree with the matching target/toolchain.
- `uhttpd` with HTTPS and CGI enabled; `libjson-c` (declared package dependencies).
- A **trusted** HTTPS certificate matching the local hostname (ArcDrop does not issue one).
- Two browsers on an IPv4 trusted LAN without client isolation.

## Build

From a prepared OpenWrt build tree:

```sh
ln -s /absolute/path/to/arcdrop /absolute/path/to/openwrt/package/arcdrop
cd /absolute/path/to/openwrt
make menuconfig
make package/arcdrop/compile V=s
find bin/packages -name 'smartsafehub-app-arcdrop*.apk'
```

The package preparation step runs `mkdir -p $(PKG_BUILD_DIR)` before copying `src/arcdrop.c` and `LICENSE`. To validate that step without an OpenWrt toolchain, run `sh tests/test-build-prepare.sh` from the ArcDrop repository root. The test uses a minimal GNU Make fixture, not a cross-compile. If your build previously failed at `.prepared_*` with `Is a directory` / `Error 126`, rebuild the package after updating the source:

```sh
make package/arcdrop/clean V=s
make package/arcdrop/compile V=s -j1
```

Select `smartsafehub-app-arcdrop` in `make menuconfig`. Adapt paths and package selection to your build environment. Do not confuse this with a firmware or frontend build: `web/` contains source HTML, CSS, JS, and SVG only.

## Install and check

Copy the target-architecture APK to the router's `/tmp/`, then install your **own trusted local build** (example):

```sh
apk add --allow-untrusted /tmp/smartsafehub-app-arcdrop*.apk
ls -l /www/arcdrop/index.html /www/arcdrop/icon.svg /www/cgi-bin/arcdrop
cat /etc/arcdrop.conf
uci show uhttpd.main
```

`--allow-untrusted` is for a trusted, unsigned test build; use signed repository packages for releases.

The default `/etc/arcdrop.conf` contains `lan_interface=br-lan`. The CGI restricts discovery to that interface's IPv4 subnet. Do not change it to `wan` or a guest network.

From two trusted LAN browsers open `https://<router-LAN-host>/arcdrop/`, select a recipient, choose a file, and accept on the receiver. Confirm the saved file matches the original. Do not ignore certificate warnings in a production setup.

## Uninstall and limitations

Use the OpenWrt package manager to remove `smartsafehub-app-arcdrop`. The package manager manages `/www/arcdrop/`, `/www/cgi-bin/arcdrop`, and `/etc/arcdrop.conf`. Temporary discovery metadata under `/tmp/arcdrop` disappears on reboot; it is not file content.

See [deployment security](DEPLOYMENT.md) before enabling the app outside a development network and [development](DEVELOPMENT.md) for local preview and tests.
