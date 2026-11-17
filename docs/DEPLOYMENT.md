# ArcDrop deployment and security guide

## Access / threat model

ArcDrop is intended for a **trusted private LAN**, not an internet-facing website. The default CGI binds discovery to clients that are in the IPv4 subnet configured on `br-lan`. There is no guest/anonymous account system, and LAN users can view the chosen device display names and send a file invitation. A recipient must click Accept before the browser negotiates WebRTC.

**Keep the router HTTPS listener inaccessible from WAN**, as it would also host `/arcdrop/` and `/cgi-bin/arcdrop`. Do not proxy the ArcDrop endpoint to the public internet. Do not disable DNS rebinding protections or your firewall to make it work.

The browser sends only metadata (`name`, `size`, SDP and ICE candidates) to the CGI. Session credentials are cryptographically random (96-bit ID, 192-bit token), held in the page's memory and sent in JSON POST bodies. Same-origin checks compare the `Origin` header with `https://` + `Host`. The CGI requires `HTTPS=on`, `Content-Type: application/json`, and a request up to 16 KiB. Files/chunks are never accepted by the server. All transient metadata is stored in root-owned `/tmp/arcdrop` (mode 0700) and expires after 45 s of inactivity. New sessions: max 24 globally, 4 per client IP. Signal queues: max 32 items. Approved signaling expires in 120 s.

## TLS and browser secure context

ArcDrop reuses uHTTPd and does **not** create another TLS endpoint/certificate. A certificate trusted by the browser and valid for the router's exact hostname is needed for reliable WebRTC, especially mobile clients. A self-signed LuCI certificate may cause warnings or block browser APIs. **Do not treat clicking through the warning as a production solution.** Public launch should first solve certificate trust via a normal public CA + LAN DNS design, or another trusted deployment method.

For validation, ensure `/etc/config/uhttpd` has an HTTPS listener, `home=/www`, and a valid `cgi_prefix=/cgi-bin`. Do not store API secrets or send file content to the SmartSafeHub backend. `https://<router-host>/arcdrop/` and `/cgi-bin/arcdrop?action=...` must stay on the **same origin**; alternate URL bases and reverse proxies require separate testing.

## Install / routing

The repository's `Makefile` builds a native CGI with `json-c` and installs the static page to `/www/arcdrop/`, the executable to `/www/cgi-bin/arcdrop`, and `lan_interface=br-lan` to `/etc/arcdrop.conf`. No procd daemon, separate listening port or uHTTPd restart is normally needed once CGI and static files are installed. Confirm that your firmware's uHTTPd instance hasn't disabled CGI.

Do not change `lan_interface` to `wan`, a guest interface or an unrestricted bridge. Only the configured interface's IPv4 subnet is eligible. An untrusted client already within that exact LAN subnet is still able to send invitations, so network trust remains necessary.

## Validation before SmartSafeHub Apps release

1. Compile for the five supported targets/architectures in SmartSafeHub's own OpenWrt 25.12 build environment, and run `shellspec` in CI.
2. Test HTTPS certificate trust with iOS Safari, Android Chrome and desktop browsers using the actual LAN hostname.
3. Test presence/disappearance of peers, file acceptance/decline, 0-byte and 64-MiB files, disconnection/retry and download permissions.
4. Verify no file contents, file chunks, blobs or downloads are present in `/tmp/arcdrop` or persistent router storage; only peer metadata should exist.
5. Test LAN isolation with guest Wi-Fi, VLANs, WAN ingress and DoH. Record CPU, memory, and process spawning on GL-MT300N-V2.
6. Add official SmartSafeHub Apps catalog metadata, compatibility matrix, publication approval and firmware-update restore using the actual Hub/Pipeline repositories (not present in this standalone archive).

Do not mark this prototype ready for production before these checks pass.

## Release gate tracking

The detailed supported-device test matrix and remaining external dependencies are tracked in [VALIDATION.md](VALIDATION.md). A passing host contract suite is insufficient for a production deployment.
