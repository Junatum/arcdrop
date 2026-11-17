/* SPDX-License-Identifier: GPL-3.0-or-later */
/* CGI response serialization and lock release. Functions terminate the process. */
#include "arcdrop.h"
#include <stdio.h>
#include <stdlib.h>
#include <sys/file.h>
#include <unistd.h>

_Noreturn void respond(ArcContext *app, int status, J *body) {
    const char *phrase = status == 200 ? "OK" : status == 400 ? "Bad Request" :
        status == 403 ? "Forbidden" : status == 404 ? "Not Found" :
        status == 409 ? "Conflict" : status == 429 ? "Too Many Requests" :
        status == 503 ? "Service Unavailable" : "Internal Server Error";
    printf("Status: %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
           "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
           "Referrer-Policy: no-referrer\r\n\r\n", status, phrase);
    puts(body ? json_object_to_json_string_ext(body, JSON_C_TO_STRING_PLAIN) : "{}");
    if (body) json_object_put(body);
    if (app->lock_fd >= 0) { flock(app->lock_fd, LOCK_UN); close(app->lock_fd); }
    exit(0);
}
_Noreturn void error_reply(ArcContext *app, int code, const char *message) {
    J *out = json_object_new_object();
    json_object_object_add(out, "error", json_object_new_string(message));
    respond(app, code, out);
}
