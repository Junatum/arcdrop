/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Session authentication, rate bounds, registration, and peer presence. */
#include "arcdrop.h"
#include <string.h>

struct counters { int all, from_ip; ArcContext *app; };
static void count_peers(const char *id, J *p, void *ctx) {
    (void)id; struct counters *c = ctx;
    c->all++;
    if (!strcmp(sfield(p, "ip") ? sfield(p, "ip") : "", c->app->client_ip)) c->from_ip++;
}
J *authenticate(ArcContext *app, J *req) {
    const char *id = sfield(req, "id"), *token = sfield(req, "token");
    if (!is_hex(id, 24) || !is_hex(token, 48)) error_reply(app, 403, "invalid session");
    J *peer = load_peer(app, id);
    if (!peer || !peer_alive(app, peer) || strcmp(sfield(peer, "token") ? sfield(peer, "token") : "", token) ||
            strcmp(sfield(peer, "ip") ? sfield(peer, "ip") : "", app->client_ip)) {
        if (peer) json_object_put(peer);
        error_reply(app, 403, "invalid or expired session");
    }
    int64_t window = json_object_get_int64(field(peer, "window"));
    int count = json_object_get_int(field(peer, "requests"));
    if (app->now_time - window >= WINDOW || app->now_time < window) { window = app->now_time; count = 0; }
    if (count >= MAX_REQUESTS) { json_object_put(peer); error_reply(app, 429, "request limit reached"); }
    addint(peer, "requests", count + 1);
    addint(peer, "window", window);
    addint(peer, "last", app->now_time);
    if (!store_peer(app, peer)) { json_object_put(peer); error_reply(app, 503, "state unavailable"); }
    return peer;
}
int valid_device_type(const char *type) {
    return type && (!strcmp(type, "phone") || !strcmp(type, "tablet") ||
                    !strcmp(type, "laptop") || !strcmp(type, "desktop"));
}
void list_peers(const char *id, J *peer, void *ctx) {
    struct peer_list_ctx *c = ctx;
    ArcContext *app = c->app;
    if (strcmp(id, c->self) == 0) return;
    J *row = json_object_new_object();
    addstr(row, "id", id);
    addstr(row, "name", sfield(peer, "name") ? sfield(peer, "name") : "Device");
    const char *device_type = sfield(peer, "deviceType");
    if (valid_device_type(device_type)) addstr(row, "deviceType", device_type);
    if (json_object_get_int(field(peer, "protocolVersion")) == 2) addint(row, "protocolVersion", 2);
    /* Presence is an advisory UI hint, not a guarantee of P2P reachability.
       Omit it for legacy clients that have never sent a poll request. */
    J *last_poll = field(peer, "lastPoll");
    if (last_poll && json_object_is_type(last_poll, json_type_int)) {
        int64_t age = (int64_t)app->now_time - json_object_get_int64(last_poll);
        /* An explicitly hidden tab remains "away" between 12s polls;
           otherwise its badge would flicker between away and stale. */
        const char *status = age >= 0 && age <= PRESENCE_TTL &&
            json_object_get_boolean(field(peer, "busy")) ? "busy" :
            field(peer, "visible") && !json_object_get_boolean(field(peer, "visible")) ? "away" :
            (age < 0 || age > PRESENCE_TTL) ? "stale" : "available";
        addstr(row, "status", status);
    }
    json_object_array_add(c->arr, row);
}
void create_session(ArcContext *app, J *req) {
    const char *name = sfield(req, "name");
    if (!name || !*name || strlen(name) > 48) error_reply(app, 400, "name must be 1-48 bytes");
    J *device_type_field = NULL;
    int has_device_type = json_object_object_get_ex(req, "deviceType", &device_type_field);
    const char *device_type = sfield(req, "deviceType");
    if (has_device_type && !valid_device_type(device_type))
        error_reply(app, 400, "invalid device type");
    J *protocol = NULL;
    int has_protocol = json_object_object_get_ex(req, "protocolVersion", &protocol);
    if (has_protocol && (!json_object_is_type(protocol, json_type_int) || json_object_get_int(protocol) != 2))
        error_reply(app, 400, "invalid protocol version");
    struct counters counter = {.app = app}; walk_peers(app, count_peers, &counter);
    if (counter.all >= MAX_PEERS || counter.from_ip >= MAX_PER_IP) error_reply(app, 429, "too many devices");
    char id[25], token[49];
    if (!random_hex(id, 12) || !random_hex(token, 24)) error_reply(app, 503, "secure randomness unavailable");
    J *p = json_object_new_object();
    addstr(p, "id", id); addstr(p, "token", token); addstr(p, "ip", app->client_ip);
    addstr(p, "name", name);
    if (device_type) addstr(p, "deviceType", device_type);
    if (has_protocol) addint(p, "protocolVersion", 2);
    addint(p, "last", app->now_time);
    addint(p, "window", app->now_time); addint(p, "requests", 0);
    json_object_object_add(p, "messages", json_object_new_array());
    json_object_object_add(p, "allowed", json_object_new_array());
    json_object_object_add(p, "pending", json_object_new_array());
    if (!store_peer(app, p)) { json_object_put(p); error_reply(app, 503, "state unavailable"); }
    json_object_put(p);
    J *out = json_object_new_object(); addstr(out, "id", id); addstr(out, "token", token);
    respond(app, 200, out);
}
