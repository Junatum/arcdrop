/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Bounded, acknowledged signaling for new clients; legacy polls drain once. */
#include "arcdrop.h"
#include <string.h>
#include <stdio.h>

static int fresh(ArcContext *app, J *item) {
    J *when = field(item, "at");
    if (!when) return 1; /* queued before the protocol upgrade */
    if (!json_object_is_type(when, json_type_int)) return 0;
    int64_t at = json_object_get_int64(when), now = (int64_t)app->now_time;
    return at >= 0 && at <= now && now - at <= SIGNAL_TTL;
}

J *live_signal_queue(ArcContext *app, J *queue) {
    J *live = json_object_new_array();
    if (!json_object_is_type(queue, json_type_array)) return live;
    for (size_t i = 0; i < json_object_array_length(queue); i++) {
        J *item = json_object_array_get_idx(queue, i);
        if (json_object_is_type(item, json_type_object) && fresh(app, item))
            json_object_array_add(live, json_object_get(item));
    }
    return live;
}

int valid_signal_acks(J *req, int *ack_mode) {
    J *acks = NULL;
    *ack_mode = json_object_object_get_ex(req, "acks", &acks);
    if (!*ack_mode) return 1;
    if (!json_object_is_type(acks, json_type_array) ||
        json_object_array_length(acks) > MAX_QUEUE) return 0;
    for (size_t i = 0; i < json_object_array_length(acks); i++) {
        J *id = json_object_array_get_idx(acks, i);
        if (!json_object_is_type(id, json_type_string) ||
            !is_hex(json_object_get_string(id), 24)) return 0;
    }
    return 1;
}

/* The response holds a reference before replacing the durable queue.
   Unacknowledged messages are delivered again after failed HTTP responses. */
J *poll_signal_queue(ArcContext *app, J *peer, J *req, int ack_mode) {
    J *queue = live_signal_queue(app, field(peer, "messages"));
    J *out = json_object_new_array(), *keep = json_object_new_array();
    J *acks = field(req, "acks");
    for (size_t i = 0; i < json_object_array_length(queue); i++) {
        J *item = json_object_array_get_idx(queue, i);
        const char *id = sfield(item, "id");
        int acknowledged = 0;
        if (ack_mode && is_hex(id, 24)) {
            for (size_t j = 0; j < json_object_array_length(acks); j++) {
                if (!strcmp(id, json_object_get_string(json_object_array_get_idx(acks, j)))) {
                    acknowledged = 1; break;
                }
            }
        }
        if (!acknowledged) json_object_array_add(out, json_object_get(item));
        /* No id means the message predates the reliable queue format. */
        if (ack_mode && !acknowledged && is_hex(id, 24))
            json_object_array_add(keep, json_object_get(item));
    }
    json_object_object_add(peer, "messages", keep);
    json_object_put(queue);
    return out;
}

/* A short non-cryptographic content fingerprint only checks request equality;
   security is provided by the authenticated session token and consent checks. */
static void body_fingerprint(J *body, char out[17]) {
    const unsigned char *bytes = (const unsigned char *)json_object_to_json_string_ext(
        body, JSON_C_TO_STRING_PLAIN);
    uint64_t hash = UINT64_C(14695981039346656037);
    for (; bytes && *bytes; bytes++) {
        hash ^= *bytes;
        hash *= UINT64_C(1099511628211);
    }
    snprintf(out, 17, "%016llx", (unsigned long long)hash);
}

/* A client repeats the same request ID on transport retries. Record recently
   committed sends on the sender so a lost HTTP response cannot duplicate an
   invite, or consume the one-time acceptance permission twice. */
int seen_signal_request(ArcContext *app, J *me, const char *request_id,
                        const char *to, const char *kind, J *body) {
    if (!request_id) return 0;
    char fingerprint[17]; body_fingerprint(body, fingerprint);
    J *sent = field(me, "sent");
    if (!json_object_is_type(sent, json_type_array)) return 0;
    for (size_t i = 0; i < json_object_array_length(sent); i++) {
        J *entry = json_object_array_get_idx(sent, i);
        if (strcmp(sfield(entry, "id") ? sfield(entry, "id") : "", request_id)) continue;
        if (json_object_get_int64(field(entry, "until")) <= (int64_t)app->now_time) continue;
        return !strcmp(sfield(entry, "to") ? sfield(entry, "to") : "", to) &&
            !strcmp(sfield(entry, "kind") ? sfield(entry, "kind") : "", kind) &&
            !strcmp(sfield(entry, "bodyHash") ? sfield(entry, "bodyHash") : "", fingerprint) ? 1 : -1;
    }
    return 0;
}

void remember_signal_request(ArcContext *app, J *me, const char *request_id,
                             const char *to, const char *kind, J *body) {
    if (!request_id) return;
    char fingerprint[17]; body_fingerprint(body, fingerprint);
    J *previous = field(me, "sent"), *next = json_object_new_array();
    if (json_object_is_type(previous, json_type_array)) {
        size_t n = json_object_array_length(previous);
        for (size_t i = 0; i < n; i++) {
            J *item = json_object_array_get_idx(previous, i);
            if (json_object_get_int64(field(item, "until")) > (int64_t)app->now_time &&
                json_object_array_length(next) < MAX_SIGNAL_HISTORY - 1)
                json_object_array_add(next, json_object_get(item));
        }
    }
    J *entry = json_object_new_object();
    addstr(entry, "id", request_id); addstr(entry, "to", to); addstr(entry, "kind", kind);
    addstr(entry, "bodyHash", fingerprint);
    addint(entry, "until", (int64_t)app->now_time + SIGNAL_TTL);
    json_object_array_add(next, entry);
    json_object_object_add(me, "sent", next);
}
