/*
 * ArcDrop - LAN-only, volatile WebRTC signaling CGI for OpenWrt/uHTTPd.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 SmartSafeHub contributors
 *
 * No file content, file chunks, or transfer bytes are accepted by this API.
 * Only bounded metadata and SDP/ICE messages live under /tmp/arcdrop.
 */
/*
 * macOS hides flock(2) and O_NOFOLLOW when only strict POSIX features
 * are requested. Expose Darwin extensions before any system headers;
 * retain O_NOFOLLOW and the existing fail-closed file locking behavior.
 */
#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>
#include <json-c/json.h>

#define STATE_DIR "/tmp/arcdrop"
#define PEER_TTL 45
#define MAX_PEERS 24
#define MAX_PER_IP 4
#define MAX_QUEUE 32
#define MAX_BODY 16384
#define MAX_SIGNAL 14000
#define MAX_REQUESTS 180
#define WINDOW 60

typedef struct json_object J;
static const char *state_dir = STATE_DIR;
static char client_ip[INET_ADDRSTRLEN];
static int lock_fd = -1;
static time_t now_time;

static void respond(int status, J *body) {
    const char *phrase = status == 200 ? "OK" : status == 400 ? "Bad Request" :
        status == 403 ? "Forbidden" : status == 404 ? "Not Found" :
        status == 409 ? "Conflict" : status == 429 ? "Too Many Requests" :
        status == 503 ? "Service Unavailable" : "Internal Server Error";
    printf("Status: %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
           "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
           "Referrer-Policy: no-referrer\r\n\r\n", status, phrase);
    puts(body ? json_object_to_json_string_ext(body, JSON_C_TO_STRING_PLAIN) : "{}");
    if (body) json_object_put(body);
    if (lock_fd >= 0) { flock(lock_fd, LOCK_UN); close(lock_fd); }
    exit(0);
}
static void error_reply(int code, const char *message) {
    J *out = json_object_new_object();
    json_object_object_add(out, "error", json_object_new_string(message));
    respond(code, out);
}
static const char *sfield(J *obj, const char *key) {
    J *v = NULL;
    if (!obj || !json_object_object_get_ex(obj, key, &v) || !json_object_is_type(v, json_type_string)) return NULL;
    return json_object_get_string(v);
}
static J *field(J *obj, const char *key) {
    J *v = NULL; return obj && json_object_object_get_ex(obj, key, &v) ? v : NULL;
}
static void addstr(J *obj, const char *key, const char *value) {
    json_object_object_add(obj, key, json_object_new_string(value));
}
static void addint(J *obj, const char *key, int64_t value) {
    json_object_object_add(obj, key, json_object_new_int64(value));
}
static int is_hex(const char *s, size_t length) {
    if (!s || strlen(s) != length) return 0;
    for (size_t i = 0; i < length; ++i)
        if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f'))) return 0;
    return 1;
}
static int random_hex(char *out, size_t bytes) {
    unsigned char buf[32];
    if (bytes > sizeof(buf)) return 0;
    int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    if (fd < 0) return 0;
    size_t got = 0;
    while (got < bytes) {
        ssize_t n = read(fd, buf + got, bytes - got);
        if (n <= 0) { close(fd); return 0; }
        got += (size_t)n;
    }
    close(fd);
    static const char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < bytes; ++i) {
        out[i * 2] = hex[buf[i] >> 4]; out[i * 2 + 1] = hex[buf[i] & 15];
    }
    out[bytes * 2] = '\0';
    return 1;
}
static int allowed_address(void) {
    const char *remote = getenv("REMOTE_ADDR");
    struct in_addr ip;
    if (!remote || inet_pton(AF_INET, remote, &ip) != 1) return 0;
    if (!inet_ntop(AF_INET, &ip, client_ip, sizeof(client_ip))) return 0;
#ifdef ARCDROP_TEST
    if (getenv("ARCDROP_TEST_MODE") && strcmp(client_ip, "127.0.0.1") == 0) return 1;
#endif
    /* Only clients in the designated LAN interface subnet are allowed.
       An isolated guest subnet or forwarded WAN connection is rejected. */
    const char *ifname = "br-lan";
    FILE *cfg = fopen("/etc/arcdrop.conf", "r");
    char line[96];
    static char configured[IF_NAMESIZE];
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
static int origin_ok(void) {
    const char *origin = getenv("HTTP_ORIGIN");
    const char *host = getenv("HTTP_HOST");
    if (!origin || !host || !*host || strlen(host) > 250) return 0;
    for (const char *c = host; *c; c++) if (*c <= ' ' || *c == '/' || *c == '\\' || *c == '@') return 0;
    char expected[264];
    int n = snprintf(expected, sizeof(expected), "https://%s", host);
    return n > 0 && n < (int)sizeof(expected) && strcmp(origin, expected) == 0;
}
static void path_for(const char *id, char *dst, size_t len) {
    snprintf(dst, len, "%s/%s.json", state_dir, id);
}
static J *load_peer(const char *id) {
    if (!is_hex(id, 24)) return NULL;
    char path[320]; path_for(id, path, sizeof(path));
    return json_object_from_file(path);
}
static int store_peer(J *p) {
    const char *id = sfield(p, "id");
    if (!is_hex(id, 24)) return 0;
    char path[320], tmp[360]; path_for(id, path, sizeof(path));
    snprintf(tmp, sizeof(tmp), "%s/%s.tmp.%ld", state_dir, id, (long)getpid());
    int fd = open(tmp, O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return 0;
    const char *content = json_object_to_json_string_ext(p, JSON_C_TO_STRING_PLAIN);
    size_t len = strlen(content); size_t pos = 0;
    while (pos < len) {
        ssize_t n = write(fd, content + pos, len - pos);
        if (n <= 0) break;
        pos += (size_t)n;
    }
    int good = pos == len;
    if (close(fd) != 0) good = 0;
    if (good && rename(tmp, path) != 0) good = 0;
    if (!good) unlink(tmp);
    return good;
}
static int peer_alive(J *p) {
    J *v = field(p, "last");
    if (!v || !json_object_is_type(v, json_type_int)) return 0;
    time_t age = now_time - (time_t)json_object_get_int64(v);
    return age >= 0 && age <= PEER_TTL;
}
static void walk_peers(void (*visit)(const char *, J *, void *), void *ctx) {
    DIR *dir = opendir(state_dir);
    if (!dir) return;
    struct dirent *e;
    while ((e = readdir(dir))) {
        if (strlen(e->d_name) != 29 || strcmp(e->d_name + 24, ".json")) continue;
        char id[25]; memcpy(id, e->d_name, 24); id[24] = '\0';
        J *p = load_peer(id);
        if (!p || !peer_alive(p)) {
            char path[320]; path_for(id, path, sizeof(path)); unlink(path);
        } else if (visit) visit(id, p, ctx);
        if (p) json_object_put(p);
    }
    closedir(dir);
}
struct counters { int all, from_ip; };
static void count_peers(const char *id, J *p, void *ctx) {
    (void)id; struct counters *c = ctx;
    c->all++;
    if (!strcmp(sfield(p, "ip") ? sfield(p, "ip") : "", client_ip)) c->from_ip++;
}
static J *authenticate(J *req) {
    const char *id = sfield(req, "id"), *token = sfield(req, "token");
    if (!is_hex(id, 24) || !is_hex(token, 48)) error_reply(403, "invalid session");
    J *peer = load_peer(id);
    if (!peer || !peer_alive(peer) || strcmp(sfield(peer, "token") ? sfield(peer, "token") : "", token) ||
            strcmp(sfield(peer, "ip") ? sfield(peer, "ip") : "", client_ip)) {
        if (peer) json_object_put(peer);
        error_reply(403, "invalid or expired session");
    }
    int64_t window = json_object_get_int64(field(peer, "window"));
    int count = json_object_get_int(field(peer, "requests"));
    if (now_time - window >= WINDOW || now_time < window) { window = now_time; count = 0; }
    if (count >= MAX_REQUESTS) { json_object_put(peer); error_reply(429, "request limit reached"); }
    addint(peer, "requests", count + 1);
    addint(peer, "window", window);
    addint(peer, "last", now_time);
    if (!store_peer(peer)) { json_object_put(peer); error_reply(503, "state unavailable"); }
    return peer;
}
static int is_allowed(J *peer, const char *other_id) {
    J *allowed = field(peer, "allowed");
    if (!json_object_is_type(allowed, json_type_array)) return 0;
    for (size_t i = 0; i < json_object_array_length(allowed); i++) {
        J *row = json_object_array_get_idx(allowed, i);
        const char *id = sfield(row, "id");
        if (id && strcmp(id, other_id) == 0 &&
                json_object_get_int64(field(row, "until")) > (int64_t)now_time) return 1;
    }
    return 0;
}
static void allow(J *p, const char *id) {
    J *arr = field(p, "allowed");
    if (!arr) { arr = json_object_new_array(); json_object_object_add(p, "allowed", arr); }
    J *list = json_object_new_array();
    for (size_t i = 0; i < json_object_array_length(arr); i++) {
        J *row = json_object_array_get_idx(arr, i);
        const char *current = sfield(row, "id");
        if (current && strcmp(current, id) && json_object_get_int64(field(row, "until")) > (int64_t)now_time)
            json_object_array_add(list, json_object_get(row));
    }
    J *entry = json_object_new_object(); addstr(entry, "id", id); addint(entry, "until", now_time + 120);
    json_object_array_add(list, entry);
    json_object_object_add(p, "allowed", list);
}
static int pending_has(J *p, const char *id) {
    J *items = field(p, "pending");
    if (!json_object_is_type(items, json_type_array)) return 0;
    for (size_t i = 0; i < json_object_array_length(items); i++) {
        J *row = json_object_array_get_idx(items, i);
        const char *from = sfield(row, "id");
        if (from && strcmp(from, id) == 0 &&
            json_object_get_int64(field(row, "until")) > (int64_t)now_time) return 1;
    }
    return 0;
}
static void pending_update(J *p, const char *id, int add) {
    J *items = field(p, "pending");
    J *list = json_object_new_array();
    if (json_object_is_type(items, json_type_array)) {
        for (size_t i = 0; i < json_object_array_length(items); i++) {
            J *row = json_object_array_get_idx(items, i);
            const char *from = sfield(row, "id");
            if (from && strcmp(from, id) &&
                json_object_get_int64(field(row, "until")) > (int64_t)now_time)
                json_object_array_add(list, json_object_get(row));
        }
    }
    if (add) {
        J *entry = json_object_new_object();
        addstr(entry, "id", id); addint(entry, "until", now_time + 60);
        json_object_array_add(list, entry);
    }
    json_object_object_add(p, "pending", list);
}
static int message_kind_ok(const char *kind) {
    return kind && (!strcmp(kind, "invite") || !strcmp(kind, "accept") ||
        !strcmp(kind, "decline") || !strcmp(kind, "offer") ||
        !strcmp(kind, "answer") || !strcmp(kind, "candidate") || !strcmp(kind, "bye"));
}
static int signal_body_ok(const char *kind, J *body) {
    if (!json_object_is_type(body, json_type_object)) return 0;
    size_t fields = json_object_object_length(body);
    if (!strcmp(kind, "invite")) {
        const char *name = sfield(body, "name");
        J *sz = field(body, "size");
        return fields == 2 && name && *name && strlen(name) <= 255 &&
            sz && json_object_is_type(sz, json_type_int) &&
            json_object_get_int64(sz) >= 0 && json_object_get_int64(sz) <= 64 * 1024 * 1024;
    }
    if (!strcmp(kind, "accept") || !strcmp(kind, "decline") || !strcmp(kind, "bye"))
        return fields == 0;
    if (!strcmp(kind, "offer") || !strcmp(kind, "answer")) {
        J *sdp = field(body, "sdp");
        const char *type = sfield(sdp, "type"), *value = sfield(sdp, "sdp");
        return fields == 1 && json_object_is_type(sdp, json_type_object) &&
            json_object_object_length(sdp) == 2 && type && !strcmp(type, kind) &&
            value && strlen(value) >= 10 && strlen(value) <= 12000 && !strncmp(value, "v=0", 3);
    }
    if (!strcmp(kind, "candidate")) {
        J *candidate = field(body, "candidate");
        const char *value = sfield(candidate, "candidate");
        return fields == 1 && json_object_is_type(candidate, json_type_object) &&
            json_object_object_length(candidate) <= 4 && value && strlen(value) <= 2048;
    }
    return 0;
}
static int valid_device_type(const char *type) {
    return type && (!strcmp(type, "phone") || !strcmp(type, "tablet") ||
                    !strcmp(type, "laptop") || !strcmp(type, "desktop"));
}
static void list_peers(const char *id, J *peer, void *ctx) {
    struct {const char *self; J *arr;} *c = ctx;
    if (strcmp(id, c->self) == 0) return;
    J *row = json_object_new_object();
    addstr(row, "id", id);
    addstr(row, "name", sfield(peer, "name") ? sfield(peer, "name") : "Device");
    const char *device_type = sfield(peer, "deviceType");
    if (valid_device_type(device_type)) addstr(row, "deviceType", device_type);
    json_object_array_add(c->arr, row);
}
static void create_session(J *req) {
    const char *name = sfield(req, "name");
    if (!name || !*name || strlen(name) > 48) error_reply(400, "name must be 1-48 bytes");
    J *device_type_field = NULL;
    int has_device_type = json_object_object_get_ex(req, "deviceType", &device_type_field);
    const char *device_type = sfield(req, "deviceType");
    if (has_device_type && !valid_device_type(device_type))
        error_reply(400, "invalid device type");
    struct counters counter = {0}; walk_peers(count_peers, &counter);
    if (counter.all >= MAX_PEERS || counter.from_ip >= MAX_PER_IP) error_reply(429, "too many devices");
    char id[25], token[49];
    if (!random_hex(id, 12) || !random_hex(token, 24)) error_reply(503, "secure randomness unavailable");
    J *p = json_object_new_object();
    addstr(p, "id", id); addstr(p, "token", token); addstr(p, "ip", client_ip);
    addstr(p, "name", name);
    if (device_type) addstr(p, "deviceType", device_type);
    addint(p, "last", now_time);
    addint(p, "window", now_time); addint(p, "requests", 0);
    json_object_object_add(p, "messages", json_object_new_array());
    json_object_object_add(p, "allowed", json_object_new_array());
    json_object_object_add(p, "pending", json_object_new_array());
    if (!store_peer(p)) { json_object_put(p); error_reply(503, "state unavailable"); }
    json_object_put(p);
    J *out = json_object_new_object(); addstr(out, "id", id); addstr(out, "token", token);
    respond(200, out);
}
static void handle(const char *action, J *req) {
    if (!strcmp(action, "register")) create_session(req);
    J *me = authenticate(req);
    const char *my_id = sfield(me, "id");
    if (!strcmp(action, "profile")) {
        const char *name = sfield(req, "name"), *device_type = sfield(req, "deviceType");
        if (!name || !*name || strlen(name) > 48 || !valid_device_type(device_type)) {
            json_object_put(me); error_reply(400, "invalid device profile");
        }
        addstr(me, "name", name);
        addstr(me, "deviceType", device_type);
        if (!store_peer(me)) { json_object_put(me); error_reply(503, "state unavailable"); }
        json_object_put(me); respond(200, json_object_new_object());
    }
    if (!strcmp(action, "heartbeat")) {
        json_object_put(me); respond(200, json_object_new_object());
    }
    if (!strcmp(action, "leave")) {
        char path[320]; path_for(my_id, path, sizeof(path)); unlink(path);
        json_object_put(me); respond(200, json_object_new_object());
    }
    if (!strcmp(action, "peers")) {
        J *out = json_object_new_object(), *arr = json_object_new_array();
        struct {const char *self; J *arr;} ctx = {my_id, arr};
        walk_peers(list_peers, &ctx);
        json_object_object_add(out, "peers", arr);
        json_object_put(me); respond(200, out);
    }
    if (!strcmp(action, "poll")) {
        J *out = json_object_new_object();
        J *messages = field(me, "messages");
        json_object_object_add(out, "messages", messages ? json_object_get(messages) : json_object_new_array());
        json_object_object_add(me, "messages", json_object_new_array());
        if (!store_peer(me)) { json_object_put(out); json_object_put(me); error_reply(503, "state unavailable"); }
        json_object_put(me); respond(200, out);
    }
    if (!strcmp(action, "signal")) {
        const char *to = sfield(req, "to"), *kind = sfield(req, "kind");
        J *body = field(req, "body");
        if (!is_hex(to, 24) || !message_kind_ok(kind) || !body || !signal_body_ok(kind, body) ||
            strlen(json_object_to_json_string_ext(body, JSON_C_TO_STRING_PLAIN)) > MAX_SIGNAL || !strcmp(to, my_id)) {
            json_object_put(me); error_reply(400, "invalid signal");
        }
        J *other = load_peer(to);
        if (!other || !peer_alive(other)) {
            if (other) json_object_put(other);
            json_object_put(me); error_reply(404, "device no longer available");
        }
        if ((!strcmp(kind, "accept") || !strcmp(kind, "decline")) && !pending_has(me, to)) {
            json_object_put(other); json_object_put(me); error_reply(403, "no pending invitation");
        }
        if (strcmp(kind, "invite") && strcmp(kind, "accept") && strcmp(kind, "decline") &&
            (!is_allowed(me, to) || !is_allowed(other, my_id))) {
            json_object_put(other); json_object_put(me); error_reply(403, "recipient has not approved the transfer");
        }
        J *queue = field(other, "messages");
        if (!queue || !json_object_is_type(queue, json_type_array) || json_object_array_length(queue) >= MAX_QUEUE) {
            json_object_put(other); json_object_put(me); error_reply(429, "recipient signal queue is full");
        }
        if (!strcmp(kind, "invite")) pending_update(other, my_id, 1);
        if (!strcmp(kind, "accept")) { pending_update(me, to, 0); allow(me, to); allow(other, my_id); }
        if (!strcmp(kind, "decline")) pending_update(me, to, 0);
        J *msg = json_object_new_object();
        addstr(msg, "from", my_id); addstr(msg, "kind", kind);
        json_object_object_add(msg, "body", json_object_get(body));
        json_object_array_add(queue, msg);
        if (!store_peer(other) || !store_peer(me)) {
            json_object_put(other); json_object_put(me); error_reply(503, "state unavailable");
        }
        json_object_put(other); json_object_put(me); respond(200, json_object_new_object());
    }
    json_object_put(me); error_reply(404, "unknown action");
}
int main(void) {
    const char *method = getenv("REQUEST_METHOD"), *query = getenv("QUERY_STRING");
    const char *https = getenv("HTTPS"), *length = getenv("CONTENT_LENGTH");
    const char *type = getenv("CONTENT_TYPE");
    if (!method || strcmp(method, "POST") || !query || strncmp(query, "action=", 7) ||
        strspn(query + 7, "abcdefghijklmnopqrstuvwxyz") != strlen(query + 7))
        error_reply(404, "not found");
    if (!https || strcmp(https, "on")) error_reply(403, "HTTPS is required");
    if (!origin_ok() || !type || strncmp(type, "application/json", 16))
        error_reply(403, "same-origin JSON request required");
    if (!allowed_address()) error_reply(403, "LAN only");
    if (!length) error_reply(400, "missing Content-Length");
    char *end = NULL;
    errno = 0;
    unsigned long size = strtoul(length, &end, 10);
    if (errno || !end || *end || size == 0 || size > MAX_BODY)
        error_reply(400, "invalid request size");
    char input[MAX_BODY + 1]; size_t total = 0;
    while (total < size) {
        size_t n = fread(input + total, 1, size - total, stdin);
        if (!n) error_reply(400, "truncated request");
        total += n;
    }
    input[size] = '\0';
    struct json_tokener *tok = json_tokener_new();
    J *req = json_tokener_parse_ex(tok, input, (int)size);
    enum json_tokener_error je = json_tokener_get_error(tok);
    size_t parsed = json_tokener_get_parse_end(tok);
    json_tokener_free(tok);
    if (je != json_tokener_success || parsed != size || !json_object_is_type(req, json_type_object)) {
        if (req) json_object_put(req);
        error_reply(400, "invalid JSON");
    }
#ifdef ARCDROP_TEST
    state_dir = getenv("ARCDROP_TEST_STATE") ? getenv("ARCDROP_TEST_STATE") : STATE_DIR;
    if (getenv("ARCDROP_TEST_NOW")) now_time = (time_t)strtoll(getenv("ARCDROP_TEST_NOW"), NULL, 10);
    else now_time = time(NULL);
#else
    now_time = time(NULL);
#endif
    if (mkdir(state_dir, 0700) != 0 && errno != EEXIST) error_reply(503, "state directory unavailable");
    struct stat st;
    if (lstat(state_dir, &st) != 0 || !S_ISDIR(st.st_mode) || (st.st_mode & 077) != 0)
        error_reply(503, "state directory not private");
    char lock_path[320]; snprintf(lock_path, sizeof(lock_path), "%s/.lock", state_dir);
    lock_fd = open(lock_path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (lock_fd < 0 || flock(lock_fd, LOCK_EX) != 0) error_reply(503, "state lock unavailable");
    /* Clean up stale sessions, even when no users refresh the peers list. */
    walk_peers(NULL, NULL);
    handle(query + 7, req);
    json_object_put(req);
    error_reply(404, "not found");
    return 0;
}
