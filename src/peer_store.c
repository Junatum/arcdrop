/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Volatile JSON peer persistence; caller holds the exclusive request lock. */
#include "arcdrop.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

void path_for(ArcContext *app, const char *id, char *dst, size_t len) {
    snprintf(dst, len, "%s/%s.json", app->state_dir, id);
}
J *load_peer(ArcContext *app, const char *id) {
    if (!is_hex(id, 24)) return NULL;
    char path[320]; path_for(app, id, path, sizeof(path));
    return json_object_from_file(path);
}
int store_peer(ArcContext *app, J *p) {
    const char *id = sfield(p, "id");
    if (!is_hex(id, 24)) return 0;
    char path[320], tmp[360]; path_for(app, id, path, sizeof(path));
    snprintf(tmp, sizeof(tmp), "%s/%s.tmp.%ld", app->state_dir, id, (long)getpid());
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
int peer_alive(ArcContext *app, J *p) {
    J *v = field(p, "last");
    if (!v || !json_object_is_type(v, json_type_int)) return 0;
    time_t age = app->now_time - (time_t)json_object_get_int64(v);
    return age >= 0 && age <= PEER_TTL;
}
void walk_peers(ArcContext *app, PeerVisitor visit, void *user_data) {
    DIR *dir = opendir(app->state_dir);
    if (!dir) return;
    struct dirent *e;
    while ((e = readdir(dir))) {
        if (strlen(e->d_name) != 29 || strcmp(e->d_name + 24, ".json")) continue;
        char id[25]; memcpy(id, e->d_name, 24); id[24] = '\0';
        J *p = load_peer(app, id);
        if (!p || !peer_alive(app, p)) {
            char path[320]; path_for(app, id, path, sizeof(path)); unlink(path);
        } else if (visit) visit(id, p, user_data);
        if (p) json_object_put(p);
    }
    closedir(dir);
}
