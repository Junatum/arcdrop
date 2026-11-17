/* SPDX-License-Identifier: GPL-3.0-or-later */
/* ArcDrop CGI shared interfaces; no browser file content is handled here. */
#ifndef ARCDROP_H
#define ARCDROP_H

/* Feature macros must precede every system header on macOS and OpenWrt. */
#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <json-c/json.h>
#include <stddef.h>
#include <stdint.h>
#include <time.h>

#define STATE_DIR "/tmp/arcdrop"
#define PEER_TTL 45
#define PRESENCE_TTL 8
#define MAX_PEERS 24
#define MAX_PER_IP 4
#define MAX_QUEUE 32
#define MAX_BODY 16384
#define MAX_SIGNAL 14000
#define MAX_REQUESTS 180
#define WINDOW 60

typedef struct json_object J;

/* Lifetime: one CGI request. No process-global mutable state. */
typedef struct {
    const char *state_dir;
    char client_ip[INET_ADDRSTRLEN];
    int lock_fd;
    time_t now_time;
} ArcContext;

typedef void (*PeerVisitor)(const char *id, J *peer, void *user_data);
typedef struct peer_list_ctx {
    ArcContext *app;
    const char *self;
    J *arr;
} PeerListContext;

/* HTTP response owns body and terminates CGI after releasing the lock. */
_Noreturn void respond(ArcContext *app, int status, J *body);
_Noreturn void error_reply(ArcContext *app, int code, const char *message);

/* JSON and identifier helpers. */
const char *sfield(J *obj, const char *key);
J *field(J *obj, const char *key);
void addstr(J *obj, const char *key, const char *value);
void addint(J *obj, const char *key, int64_t value);
void addbool(J *obj, const char *key, int value);
int is_hex(const char *s, size_t length);
int random_hex(char *out, size_t bytes);

/* LAN and same-origin checks. */
int allowed_address(ArcContext *app);
int origin_ok(void);

/* JSON-backed volatile peer storage. All calls take the same request lock. */
void path_for(ArcContext *app, const char *id, char *dst, size_t len);
J *load_peer(ArcContext *app, const char *id);
int store_peer(ArcContext *app, J *peer);
int peer_alive(ArcContext *app, J *peer);
void walk_peers(ArcContext *app, PeerVisitor visit, void *user_data);

/* Session lifecycle and peer discovery. */
J *authenticate(ArcContext *app, J *req);
int valid_device_type(const char *type);
void list_peers(const char *id, J *peer, void *user_data);
void create_session(ArcContext *app, J *req);

/* Explicit consent and WebRTC signaling. Owns `me` on every exit. */
_Noreturn void handle_signal(ArcContext *app, J *me, J *req);

#endif
