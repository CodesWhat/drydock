/*
 * healthcheck - Minimal HTTP healthcheck for Docker containers
 *
 * Opens a loopback connection to localhost, probes GET /health, exits 0 on 2xx.
 * Uses raw HTTP by default and switches to HTTPS via openssl when
 * DD_SERVER_TLS_ENABLED=true so container upgrades stay seamless.
 *
 * Usage: healthcheck [port]   (default: 3000)
 *
 * MIT License - part of the Drydock project
 */

#include <sys/time.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <unistd.h>

#define DEFAULT_PORT 3000
#define TIMEOUT_SEC 5
#define BUF_SIZE 256

static int parse_http_status(const char *buf) {
    char *sp = strchr((char *)buf, ' ');
    if (!sp)
        return 0;

    return atoi(sp + 1);
}

static int is_tls_enabled(void) {
    const char *value = getenv("DD_SERVER_TLS_ENABLED");
    return value != NULL && (strcasecmp(value, "true") == 0 || strcmp(value, "1") == 0);
}

static int probe_https(int port) {
    char cmd[BUF_SIZE * 2];
    snprintf(
        cmd,
        sizeof(cmd),
        "printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' | "
        "openssl s_client -quiet -connect 127.0.0.1:%d -servername localhost 2>/dev/null",
        port
    );

    FILE *fp = popen(cmd, "r");
    if (!fp)
        return 1;

    char buf[BUF_SIZE];
    int status = 0;
    while (fgets(buf, sizeof(buf), fp)) {
        if (strncmp(buf, "HTTP/", 5) == 0) {
            status = parse_http_status(buf);
            break;
        }
    }

    pclose(fp);
    return (status >= 200 && status <= 299) ? 0 : 1;
}

static int probe_http(int port) {
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
    int status = parse_http_status(buf);
    return (status >= 200 && status <= 299) ? 0 : 1;
}

int main(int argc, char *argv[]) {
    int port = DEFAULT_PORT;

    if (argc > 1) {
        port = atoi(argv[1]);
        if (port <= 0 || port > 65535) {
            return 1;
        }
    }

    if (is_tls_enabled())
        return probe_https(port);

    return probe_http(port);
}
