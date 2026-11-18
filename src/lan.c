/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Trusted IPv4 LAN interface and same-origin request checks. */
#include "arcdrop.h"
#include <ifaddrs.h>
#include <net/if.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int allowed_address(ArcContext *app) {
    const char *remote = getenv("REMOTE_ADDR");
    struct in_addr ip;
    if (!remote || inet_pton(AF_INET, remote, &ip) != 1) return 0;
    if (!inet_ntop(AF_INET, &ip, app->client_ip, sizeof(app->client_ip))) return 0;
#ifdef ARCDROP_TEST
    /* Host-only load tests use distinct loopback IPs to respect the per-IP cap. */
    if (getenv("ARCDROP_TEST_MODE") &&
        (ntohl(ip.s_addr) & UINT32_C(0xff000000)) == UINT32_C(0x7f000000)) return 1;
#endif
    /* Only clients in the designated LAN interface subnet are allowed.
       An isolated guest subnet or forwarded WAN connection is rejected. */
    const char *ifname = "br-lan";
    FILE *cfg = fopen("/etc/arcdrop.conf", "r");
    char line[96];
    char configured[IF_NAMESIZE];
    if (cfg) {
        while (fgets(line, sizeof(line), cfg)) {
            if (strncmp(line, "lan_interface=", 14) == 0) {
                size_t len = strcspn(line + 14, "\r\n");
                if (len > 0 && len < sizeof(configured)) {
                    memcpy(configured, line + 14, len); configured[len] = '\0';
                    ifname = configured;
                }
            }
        }
        fclose(cfg);
    }
    struct ifaddrs *ifs = NULL;
    if (getifaddrs(&ifs) != 0) return 0;
    int valid = 0;
    for (struct ifaddrs *it = ifs; it; it = it->ifa_next) {
        if (!it->ifa_addr || !it->ifa_netmask || it->ifa_addr->sa_family != AF_INET || strcmp(it->ifa_name, ifname)) continue;
        uint32_t mask = ((struct sockaddr_in *)it->ifa_netmask)->sin_addr.s_addr;
        uint32_t local = ((struct sockaddr_in *)it->ifa_addr)->sin_addr.s_addr;
        if ((ip.s_addr & mask) == (local & mask) && ip.s_addr != local) { valid = 1; break; }
    }
    freeifaddrs(ifs);
    return valid;
}
int origin_ok(void) {
    const char *origin = getenv("HTTP_ORIGIN");
    const char *host = getenv("HTTP_HOST");
    if (!origin || !host || !*host || strlen(host) > 250) return 0;
    for (const char *c = host; *c; c++) if (*c <= ' ' || *c == '/' || *c == '\\' || *c == '@') return 0;
    char expected[264];
    int n = snprintf(expected, sizeof(expected), "https://%s", host);
    return n > 0 && n < (int)sizeof(expected) && strcmp(origin, expected) == 0;
}
