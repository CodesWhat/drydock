/*
 * healthcheck - Minimal HTTP healthcheck for Docker containers
 *
 * Opens a TCP connection to localhost, sends GET /health, exits 0 on 2xx.
 * Statically linked, ~20KB binary. No TLS (unnecessary for localhost probes).
 *
 * Usage: healthcheck [port]   (default: 3000)
 *
 * MIT License - part of the Drydock project
 */

#include <sys/time.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define DEFAULT_PORT 3000
#define TIMEOUT_SEC 5
#define BUF_SIZE 256

int main(int argc, char *argv[]) {
    int port = DEFAULT_PORT;

    if (argc > 1) {
        port = atoi(argv[1]);
        if (port <= 0 || port > 65535) {
            return 1;
        }
    }

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0)
        return 1;

    /* Set send/recv timeout */
    struct timeval tv = {.tv_sec = TIMEOUT_SEC, .tv_usec = 0};
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons(port),
        .sin_addr.s_addr = htonl(INADDR_LOOPBACK),
    };

    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(fd);
        return 1;
    }

    const char *req = "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n";
    if (write(fd, req, strlen(req)) < 0) {
        close(fd);
        return 1;
    }

    char buf[BUF_SIZE];
    int n = read(fd, buf, sizeof(buf) - 1);
    close(fd);

    if (n <= 0)
        return 1;

    buf[n] = '\0';

    /* Parse status code from "HTTP/1.x NNN" */
    char *sp = strchr(buf, ' ');
    if (!sp)
        return 1;

    int status = atoi(sp + 1);
    return (status >= 200 && status <= 299) ? 0 : 1;
}
