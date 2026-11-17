/* SPDX-License-Identifier: GPL-3.0-or-later */
/* CGI entry point: HTTP preconditions, action routing, and request lock. */
#include "arcdrop.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static void handle(ArcContext *app, const char *action, J *req) {
    if (!strcmp(action, "register")) create_session(app, req);
    J *me = authenticate(app, req);
    const char *my_id = sfield(me, "id");
    if (!strcmp(action, "profile")) {
        const char *name = sfield(req, "name"), *device_type = sfield(req, "deviceType");
        if (!name || !*name || strlen(name) > 48 || !valid_device_type(device_type)) {
            json_object_put(me); error_reply(app, 400, "invalid device profile");
        }
        addstr(me, "name", name);
        addstr(me, "deviceType", device_type);
        if (!store_peer(app, me)) { json_object_put(me); error_reply(app, 503, "state unavailable"); }
        json_object_put(me); respond(app, 200, json_object_new_object());
    }
    if (!strcmp(action, "heartbeat")) {
        json_object_put(me); respond(app, 200, json_object_new_object());
    }
    if (!strcmp(action, "leave")) {
        char path[320]; path_for(app, my_id, path, sizeof(path)); unlink(path);
        json_object_put(me); respond(app, 200, json_object_new_object());
    }
    if (!strcmp(action, "peers")) {
        J *out = json_object_new_object(), *arr = json_object_new_array();
        PeerListContext ctx = {.app = app, .self = my_id, .arr = arr};
        walk_peers(app, list_peers, &ctx);
        json_object_object_add(out, "peers", arr);
        json_object_put(me); respond(app, 200, out);
    }
    if (!strcmp(action, "poll")) {
        /* Optional hints preserve compatibility with previous ArcDrop clients.
           Validate strict booleans; never use these values for authorization. */
        J *visible = NULL, *busy = NULL;
        int has_visible = json_object_object_get_ex(req, "visible", &visible);
        int has_busy = json_object_object_get_ex(req, "busy", &busy);
        if ((has_visible && (!visible || !json_object_is_type(visible, json_type_boolean))) ||
            (has_busy && (!busy || !json_object_is_type(busy, json_type_boolean)))) {
            json_object_put(me); error_reply(app, 400, "invalid presence flags");
        }
        addint(me, "lastPoll", (int64_t)app->now_time);
        addbool(me, "visible", visible ? json_object_get_boolean(visible) : 1);
        addbool(me, "busy", busy ? json_object_get_boolean(busy) : 0);
        J *out = json_object_new_object();
        J *messages = field(me, "messages");
        json_object_object_add(out, "messages", messages ? json_object_get(messages) : json_object_new_array());
        json_object_object_add(me, "messages", json_object_new_array());
        if (!store_peer(app, me)) { json_object_put(out); json_object_put(me); error_reply(app, 503, "state unavailable"); }
        json_object_put(me); respond(app, 200, out);
    }
    if (!strcmp(action, "signal")) handle_signal(app, me, req);
    json_object_put(me); error_reply(app, 404, "unknown action");
}
int main(void) {
    ArcContext context = {.state_dir = STATE_DIR, .lock_fd = -1};
    ArcContext *app = &context;
    const char *method = getenv("REQUEST_METHOD"), *query = getenv("QUERY_STRING");
    const char *https = getenv("HTTPS"), *length = getenv("CONTENT_LENGTH");
    const char *type = getenv("CONTENT_TYPE");
    if (!method || strcmp(method, "POST") || !query || strncmp(query, "action=", 7) ||
        strspn(query + 7, "abcdefghijklmnopqrstuvwxyz") != strlen(query + 7))
        error_reply(app, 404, "not found");
    if (!https || strcmp(https, "on")) error_reply(app, 403, "HTTPS is required");
    if (!origin_ok() || !type || strncmp(type, "application/json", 16))
        error_reply(app, 403, "same-origin JSON request required");
    if (!allowed_address(app)) error_reply(app, 403, "LAN only");
    if (!length) error_reply(app, 400, "missing Content-Length");
    char *end = NULL;
    errno = 0;
    unsigned long size = strtoul(length, &end, 10);
    if (errno || !end || *end || size == 0 || size > MAX_BODY)
        error_reply(app, 400, "invalid request size");
    char input[MAX_BODY + 1]; size_t total = 0;
    while (total < size) {
        size_t n = fread(input + total, 1, size - total, stdin);
        if (!n) error_reply(app, 400, "truncated request");
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
        error_reply(app, 400, "invalid JSON");
    }
#ifdef ARCDROP_TEST
    app->state_dir = getenv("ARCDROP_TEST_STATE") ? getenv("ARCDROP_TEST_STATE") : STATE_DIR;
    if (getenv("ARCDROP_TEST_NOW")) app->now_time = (time_t)strtoll(getenv("ARCDROP_TEST_NOW"), NULL, 10);
    else app->now_time = time(NULL);
#else
    app->now_time = time(NULL);
#endif
    if (mkdir(app->state_dir, 0700) != 0 && errno != EEXIST)
        error_reply(app, 503, "state directory unavailable");
    if (!prepare_state(app)) error_reply(app, 503, "state directory not private");
    char lock_path[320];
    int lock_length = snprintf(lock_path, sizeof(lock_path), "%s/.lock", app->state_dir);
    if (lock_length < 0 || (size_t)lock_length >= sizeof(lock_path))
        error_reply(app, 503, "state lock unavailable");
    app->lock_fd = open(lock_path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (app->lock_fd < 0 || !state_lock_ok(app->lock_fd) ||
        flock(app->lock_fd, LOCK_EX) != 0) error_reply(app, 503, "state lock unavailable");
    /* Recover an interrupted two-peer update before any authentication. */
    if (!recover_peer_transaction(app)) error_reply(app, 503, "state recovery unavailable");
    if (!maybe_cleanup_peers(app)) error_reply(app, 503, "state cleanup unavailable");
    handle(app, query + 7, req);
    json_object_put(req);
    error_reply(app, 404, "not found");
    return 0;
}
