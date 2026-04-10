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
#include <sys/wait.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
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

static const char *find_openssl_binary(void) {
    static const char *candidates[] = {
        "/usr/bin/openssl",
        "/bin/openssl",
        "/usr/local/bin/openssl",
        "/opt/homebrew/bin/openssl",
        NULL,
    };

    for (size_t i = 0; candidates[i] != NULL; i++) {
        if (access(candidates[i], X_OK) == 0)
            return candidates[i];
    }

    return NULL;
}

static int wait_for_fd(int fd, short events) {
    struct pollfd pfd = {
        .fd = fd,
        .events = events,
    };

    while (1) {
        int rc = poll(&pfd, 1, TIMEOUT_SEC * 1000);
        if (rc > 0) {
            if ((pfd.revents & (POLLERR | POLLNVAL)) != 0)
                return 1;

            short ready_events = events;
            if ((events & POLLIN) != 0)
                ready_events |= POLLHUP;

            return (pfd.revents & ready_events) != 0 ? 0 : 1;
        }

        if (rc == 0)
            return 1;

        if (errno != EINTR)
            return 1;
    }
}

static int write_all(int fd, const char *buf, size_t len) {
    size_t written = 0;

    while (written < len) {
        if (wait_for_fd(fd, POLLOUT) != 0)
            return 1;

        ssize_t n = write(fd, buf + written, len - written);
        if (n > 0) {
            written += (size_t)n;
            continue;
        }

        if (n < 0 && errno == EINTR)
            continue;

        return 1;
    }

    return 0;
}

static int write_all_without_sigpipe(int fd, const char *buf, size_t len) {
    void (*previous)(int) = signal(SIGPIPE, SIG_IGN);
    int rc = write_all(fd, buf, len);
    signal(SIGPIPE, previous);
    return rc;
}

static int read_http_status_line(int fd) {
    char buf[BUF_SIZE];
    size_t used = 0;

    while (used < sizeof(buf) - 1) {
        if (wait_for_fd(fd, POLLIN) != 0)
            return 0;

        ssize_t n = read(fd, buf + used, sizeof(buf) - 1 - used);
        if (n > 0) {
            used += (size_t)n;
            buf[used] = '\0';

            char *status_line = strstr(buf, "HTTP/");
            if (status_line != NULL)
                return parse_http_status(status_line);

            continue;
        }

        if (n == 0)
            break;

        if (errno != EINTR)
            break;
    }

    return 0;
}

static void terminate_child(pid_t pid) {
    if (pid <= 0)
        return;

    kill(pid, SIGKILL);
    waitpid(pid, NULL, 0);
}

static int probe_https(int port) {
    const char *openssl_binary = find_openssl_binary();
    if (openssl_binary == NULL)
        return 1;

    char connect_arg[32];
    int connect_len = snprintf(connect_arg, sizeof(connect_arg), "127.0.0.1:%d", port);
    if (connect_len <= 0 || connect_len >= (int)sizeof(connect_arg))
        return 1;

    int stdin_pipe[2] = {-1, -1};
    int stdout_pipe[2] = {-1, -1};
    pid_t pid = -1;
    int status = 0;

    if (pipe(stdin_pipe) < 0 || pipe(stdout_pipe) < 0)
        goto cleanup;

    pid = fork();
    if (pid < 0)
        goto cleanup;

    if (pid == 0) {
        int devnull = open("/dev/null", O_WRONLY);
        if (
            dup2(stdin_pipe[0], STDIN_FILENO) < 0 || dup2(stdout_pipe[1], STDOUT_FILENO) < 0 ||
            (devnull >= 0 && dup2(devnull, STDERR_FILENO) < 0)
        ) {
            _exit(127);
        }

        close(stdin_pipe[0]);
        close(stdin_pipe[1]);
        close(stdout_pipe[0]);
        close(stdout_pipe[1]);
        if (devnull >= 0)
            close(devnull);

        char *const argv[] = {
            (char *)openssl_binary,
            "s_client",
            "-quiet",
            "-connect",
            connect_arg,
            "-servername",
            "localhost",
            NULL,
        };
        execv(openssl_binary, argv);
        _exit(127);
    }

    close(stdin_pipe[0]);
    stdin_pipe[0] = -1;
    close(stdout_pipe[1]);
    stdout_pipe[1] = -1;

    const char *req = "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n";
    if (write_all_without_sigpipe(stdin_pipe[1], req, strlen(req)) != 0)
        goto cleanup;

    close(stdin_pipe[1]);
    stdin_pipe[1] = -1;

    status = read_http_status_line(stdout_pipe[0]);

cleanup:
    if (stdin_pipe[0] >= 0)
        close(stdin_pipe[0]);
    if (stdin_pipe[1] >= 0)
        close(stdin_pipe[1]);
    if (stdout_pipe[0] >= 0)
        close(stdout_pipe[0]);
    if (stdout_pipe[1] >= 0)
        close(stdout_pipe[1]);
    terminate_child(pid);

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
