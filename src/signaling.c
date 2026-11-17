/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Invitation consent and bounded WebRTC SDP/ICE metadata signaling. */
#include "arcdrop.h"
#include <string.h>

static int is_allowed(ArcContext *app, J *peer, const char *other_id) {
    J *allowed = field(peer, "allowed");
    if (!json_object_is_type(allowed, json_type_array)) return 0;
    for (size_t i = 0; i < json_object_array_length(allowed); i++) {
        J *row = json_object_array_get_idx(allowed, i);
        const char *id = sfield(row, "id");
        if (id && strcmp(id, other_id) == 0 &&
                json_object_get_int64(field(row, "until")) > (int64_t)app->now_time) return 1;
    }
    return 0;
}
static void allow(ArcContext *app, J *p, const char *id) {
    J *arr = field(p, "allowed");
    if (!arr) { arr = json_object_new_array(); json_object_object_add(p, "allowed", arr); }
    J *list = json_object_new_array();
    for (size_t i = 0; i < json_object_array_length(arr); i++) {
        J *row = json_object_array_get_idx(arr, i);
        const char *current = sfield(row, "id");
        if (current && strcmp(current, id) && json_object_get_int64(field(row, "until")) > (int64_t)app->now_time)
            json_object_array_add(list, json_object_get(row));
    }
    J *entry = json_object_new_object(); addstr(entry, "id", id); addint(entry, "until", app->now_time + 120);
    json_object_array_add(list, entry);
    json_object_object_add(p, "allowed", list);
}
static int pending_has(ArcContext *app, J *p, const char *id) {
    J *items = field(p, "pending");
    if (!json_object_is_type(items, json_type_array)) return 0;
    for (size_t i = 0; i < json_object_array_length(items); i++) {
        J *row = json_object_array_get_idx(items, i);
        const char *from = sfield(row, "id");
        if (from && strcmp(from, id) == 0 &&
            json_object_get_int64(field(row, "until")) > (int64_t)app->now_time) return 1;
    }
    return 0;
}
static void pending_update(ArcContext *app, J *p, const char *id, int add) {
    J *items = field(p, "pending");
    J *list = json_object_new_array();
    if (json_object_is_type(items, json_type_array)) {
        for (size_t i = 0; i < json_object_array_length(items); i++) {
            J *row = json_object_array_get_idx(items, i);
            const char *from = sfield(row, "id");
            if (from && strcmp(from, id) &&
                json_object_get_int64(field(row, "until")) > (int64_t)app->now_time)
                json_object_array_add(list, json_object_get(row));
        }
    }
    if (add) {
        J *entry = json_object_new_object();
        addstr(entry, "id", id); addint(entry, "until", app->now_time + 60);
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

_Noreturn void handle_signal(ArcContext *app, J *me, J *req) {
    const char *my_id = sfield(me, "id");
    const char *to = sfield(req, "to"), *kind = sfield(req, "kind");
    J *body = field(req, "body");
    if (!is_hex(to, 24) || !message_kind_ok(kind) || !body || !signal_body_ok(kind, body) ||
        strlen(json_object_to_json_string_ext(body, JSON_C_TO_STRING_PLAIN)) > MAX_SIGNAL || !strcmp(to, my_id)) {
        json_object_put(me); error_reply(app, 400, "invalid signal");
    }
    J *other = load_peer(app, to);
    if (!other || !peer_alive(app, other)) {
        if (other) json_object_put(other);
        json_object_put(me); error_reply(app, 404, "device no longer available");
    }
    if ((!strcmp(kind, "accept") || !strcmp(kind, "decline")) && !pending_has(app, me, to)) {
        json_object_put(other); json_object_put(me); error_reply(app, 403, "no pending invitation");
    }
    if (strcmp(kind, "invite") && strcmp(kind, "accept") && strcmp(kind, "decline") &&
        (!is_allowed(app, me, to) || !is_allowed(app, other, my_id))) {
        json_object_put(other); json_object_put(me); error_reply(app, 403, "recipient has not approved the transfer");
    }
    J *queue = field(other, "messages");
    if (!queue || !json_object_is_type(queue, json_type_array) || json_object_array_length(queue) >= MAX_QUEUE) {
        json_object_put(other); json_object_put(me); error_reply(app, 429, "recipient signal queue is full");
    }
    if (!strcmp(kind, "invite")) pending_update(app, other, my_id, 1);
    if (!strcmp(kind, "accept")) { pending_update(app, me, to, 0); allow(app, me, to); allow(app, other, my_id); }
    if (!strcmp(kind, "decline")) pending_update(app, me, to, 0);
    J *msg = json_object_new_object();
    addstr(msg, "from", my_id); addstr(msg, "kind", kind);
    json_object_object_add(msg, "body", json_object_get(body));
    json_object_array_add(queue, msg);
    if (!store_peer(app, other) || !store_peer(app, me)) {
        json_object_put(other); json_object_put(me); error_reply(app, 503, "state unavailable");
    }
    json_object_put(other); json_object_put(me); respond(app, 200, json_object_new_object());
}
