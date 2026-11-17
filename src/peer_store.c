/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Bounded private volatile peer store; every operation holds the CGI lock. */
#include "arcdrop.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_TRANSACTION_FILE (2 * MAX_PEER_FILE + 256)

void path_for(ArcContext *app, const char *id, char *dst, size_t len) {
    snprintf(dst, len, "%s/%s.json", app->state_dir, id);
}

/* All state files must be private, ordinary files owned by the CGI user.
   O_NONBLOCK prevents accidental FIFO/device hangs before fstat rejects them. */
static int private_regular(int fd) {
    struct stat st;
    return fstat(fd, &st) == 0 && S_ISREG(st.st_mode) && st.st_uid == geteuid() &&
        st.st_nlink == 1 && (st.st_mode & 077) == 0;
}

int prepare_state(ArcContext *app) {
    struct stat st;
    if (lstat(app->state_dir, &st) != 0 || !S_ISDIR(st.st_mode) ||
        st.st_uid != geteuid() || (st.st_mode & 077) != 0) return 0;
    return 1;
}

int state_lock_ok(int fd) {
    return private_regular(fd);
}

static J *read_private_json(ArcContext *app, const char *name, size_t limit) {
    char path[384];
    if (snprintf(path, sizeof(path), "%s/%s", app->state_dir, name) >= (int)sizeof(path)) return NULL;
    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) return NULL;
    struct stat st;
    if (!private_regular(fd) || fstat(fd, &st) != 0 ||
        st.st_size <= 0 || (uint64_t)st.st_size > limit) { close(fd); return NULL; }
    size_t len = (size_t)st.st_size;
    char *buf = malloc(len + 1);
    if (!buf) { close(fd); return NULL; }
    size_t pos = 0;
    while (pos < len) {
        ssize_t got = read(fd, buf + pos, len - pos);
        if (got < 0 && errno == EINTR) continue;
        if (got <= 0) break;
        pos += (size_t)got;
    }
    close(fd);
    J *value = NULL;
    if (pos == len) {
        buf[len] = '\0';
        struct json_tokener *tok = json_tokener_new();
        if (tok) {
            value = json_tokener_parse_ex(tok, buf, (int)len);
            if (json_tokener_get_error(tok) != json_tokener_success ||
                json_tokener_get_parse_end(tok) != len ||
                !json_object_is_type(value, json_type_object)) {
                if (value) json_object_put(value);
                value = NULL;
            }
            json_tokener_free(tok);
        }
    }
    free(buf);
    return value;
}

/* Write a complete JSON snapshot to a new private file, then atomic rename.
   A failed write never truncates a previously committed session. */
static int write_private_json(ArcContext *app, const char *name, J *value, size_t limit) {
    const char *content = json_object_to_json_string_ext(value, JSON_C_TO_STRING_PLAIN);
    if (!content) return 0;
    size_t len = strlen(content);
    if (len > limit) return 0;
    char path[384], tmp[416];
    if (snprintf(path, sizeof(path), "%s/%s", app->state_dir, name) >= (int)sizeof(path) ||
        snprintf(tmp, sizeof(tmp), "%s.tmp.%ld", path, (long)getpid()) >= (int)sizeof(tmp)) return 0;
    int fd = open(tmp, O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return 0;
    size_t pos = 0;
    while (pos < len) {
        ssize_t written = write(fd, content + pos, len - pos);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) break;
        pos += (size_t)written;
    }
    int good = pos == len;
    if (close(fd) != 0) good = 0;
    if (good && rename(tmp, path) != 0) good = 0;
    if (!good) unlink(tmp);
    return good;
}

J *load_peer(ArcContext *app, const char *id) {
    if (!is_hex(id, 24)) return NULL;
    char name[30]; snprintf(name, sizeof(name), "%s.json", id);
    J *p = read_private_json(app, name, MAX_PEER_FILE);
    if (p && (!sfield(p, "id") || strcmp(sfield(p, "id"), id))) {
        json_object_put(p);
        return NULL;
    }
    return p;
}

int store_peer(ArcContext *app, J *p) {
    const char *id = sfield(p, "id");
    if (!is_hex(id, 24)) return 0;
    char name[30]; snprintf(name, sizeof(name), "%s.json", id);
    return write_private_json(app, name, p, MAX_PEER_FILE);
}

int peer_alive(ArcContext *app, J *p) {
    J *v = field(p, "last");
    if (!v || !json_object_is_type(v, json_type_int)) return 0;
    int64_t last = json_object_get_int64(v);
    int64_t now = (int64_t)app->now_time;
    return last >= 0 && last <= now && now - last <= PEER_TTL;
}

void walk_peers(ArcContext *app, PeerVisitor visit, void *user_data) {
    DIR *dir = opendir(app->state_dir);
    if (!dir) return;
    struct dirent *e;
    while ((e = readdir(dir))) {
        if (strlen(e->d_name) != 29 || strcmp(e->d_name + 24, ".json")) continue;
        char id[25]; memcpy(id, e->d_name, 24); id[24] = '\0';
        if (!is_hex(id, 24)) continue;
        J *p = load_peer(app, id);
        if (!p || !peer_alive(app, p)) {
            char path[320]; path_for(app, id, path, sizeof(path)); unlink(path);
        } else if (visit) visit(id, p, user_data);
        if (p) json_object_put(p);
    }
    closedir(dir);
}

/* Most requests are short polls. Sweep expired sessions at most once every
   CLEANUP_INTERVAL seconds; registration and discovery still scan immediately. */
int maybe_cleanup_peers(ArcContext *app) {
    J *marker = read_private_json(app, ".cleanup", 128);
    J *last = field(marker, "last");
    if (last && json_object_is_type(last, json_type_int)) {
        int64_t previous = json_object_get_int64(last);
        int64_t now = (int64_t)app->now_time;
        if (previous >= 0 && previous <= now && now - previous < CLEANUP_INTERVAL) {
            json_object_put(marker);
            return 1;
        }
    }
    if (marker) json_object_put(marker);
    walk_peers(app, NULL, NULL);
    J *next = json_object_new_object();
    addint(next, "last", (int64_t)app->now_time);
    int ok = write_private_json(app, ".cleanup", next, 128);
    json_object_put(next);
    return ok;
}

static const char *transaction_path(ArcContext *app, char *path, size_t length) {
    if (snprintf(path, length, "%s/.transaction", app->state_dir) >= (int)length) return NULL;
    return path;
}

/* Journal PRE-CHANGE snapshots before touching either peer. If a CGI process
   dies between the two writes, the next request restores BOTH old snapshots. */
int recover_peer_transaction(ArcContext *app) {
    char path[384];
    if (!transaction_path(app, path, sizeof(path))) return 0;
    struct stat st;
    if (lstat(path, &st) < 0) return errno == ENOENT;
    J *journal = read_private_json(app, ".transaction", MAX_TRANSACTION_FILE);
    J *first = field(journal, "first"), *second = field(journal, "second");
    const char *first_id = sfield(first, "id"), *second_id = sfield(second, "id");
    int ok = json_object_is_type(first, json_type_object) &&
        json_object_is_type(second, json_type_object) &&
        is_hex(first_id, 24) && is_hex(second_id, 24) && strcmp(first_id, second_id) &&
        store_peer(app, first) && store_peer(app, second) && unlink(path) == 0;
    if (journal) json_object_put(journal);
    return ok;
}

int begin_peer_transaction(ArcContext *app, J *first, J *second) {
    char path[384];
    struct stat st;
    if (!transaction_path(app, path, sizeof(path)) || lstat(path, &st) == 0 || errno != ENOENT) return 0;
    J *journal = json_object_new_object();
    json_object_object_add(journal, "first", json_object_get(first));
    json_object_object_add(journal, "second", json_object_get(second));
    int ok = write_private_json(app, ".transaction", journal, MAX_TRANSACTION_FILE);
    json_object_put(journal);
    return ok;
}

int finish_peer_transaction(ArcContext *app, J *first, J *second) {
    char path[384];
    if (!transaction_path(app, path, sizeof(path))) return 0;
    int ok = store_peer(app, first);
#ifdef ARCDROP_TEST
    /* Simulate a crash at the non-atomic boundary for recovery tests. */
    if (ok && getenv("ARCDROP_TEST_CRASH_AFTER_FIRST")) _exit(79);
    if (ok && getenv("ARCDROP_TEST_FAIL_AFTER_FIRST")) ok = 0;
#endif
    if (ok) ok = store_peer(app, second);
    if (ok) ok = unlink(path) == 0;
    if (!ok) (void)recover_peer_transaction(app);
    return ok;
}
