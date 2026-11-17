/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Small JSON field, identifier validation, and secure randomness helpers. */
#include "arcdrop.h"
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

const char *sfield(J *obj, const char *key) {
    J *v = NULL;
    if (!obj || !json_object_object_get_ex(obj, key, &v) || !json_object_is_type(v, json_type_string)) return NULL;
    return json_object_get_string(v);
}
J *field(J *obj, const char *key) {
    J *v = NULL; return obj && json_object_object_get_ex(obj, key, &v) ? v : NULL;
}
void addstr(J *obj, const char *key, const char *value) {
    json_object_object_add(obj, key, json_object_new_string(value));
}
void addint(J *obj, const char *key, int64_t value) {
    json_object_object_add(obj, key, json_object_new_int64(value));
}
void addbool(J *obj, const char *key, int value) {
    json_object_object_add(obj, key, json_object_new_boolean(value));
}
int is_hex(const char *s, size_t length) {
    if (!s || strlen(s) != length) return 0;
    for (size_t i = 0; i < length; ++i)
        if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f'))) return 0;
    return 1;
}
int random_hex(char *out, size_t bytes) {
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
