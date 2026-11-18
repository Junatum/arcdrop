/* SPDX-License-Identifier: GPL-3.0-or-later */
/* CGI response serialization and lock release. Functions terminate the process. */
#include "arcdrop.h"
#include <stdio.h>
#include <time.h>
#include <stdlib.h>
#include <sys/file.h>
#include <unistd.h>

uint64_t monotonic_us(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;
    return (uint64_t)ts.tv_sec * 1000000u + (uint64_t)ts.tv_nsec / 1000u;
}

_Noreturn void respond(ArcContext *app, int status, J *body) {
    const char *phrase = status == 200 ? "OK" : status == 400 ? "Bad Request" :
        status == 403 ? "Forbidden" : status == 404 ? "Not Found" :
        status == 409 ? "Conflict" : status == 429 ? "Too Many Requests" :
        status == 503 ? "Service Unavailable" : "Internal Server Error";
    uint64_t now = monotonic_us();
    double total_ms = (app->started_us && now >= app->started_us) ?
        (double)(now - app->started_us) / 1000.0 : 0.0;
    double lock_ms = (double)app->lock_wait_us / 1000.0;
    printf("Status: %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
           "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
           "Referrer-Policy: no-referrer\r\n"
           "Server-Timing: cgi;dur=%.3f, lock;dur=%.3f\r\n\r\n",
           status, phrase, total_ms, lock_ms);
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
