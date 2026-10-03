/* Regression for the input state after a failed direct gzip write. */
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
#include "gzguts.h"

int main(void) {
    unsigned char input[65536];
    unsigned int seed = 1;
    unsigned int i;
    int fd;
    gzFile file;
    gz_statep state;
    int failed;

    for (i = 0; i < sizeof(input); i++) {
        seed = seed * 1664525U + 1013904223U;
        input[i] = (unsigned char)(seed >> 24);
    }
    fd = open("/dev/full", O_WRONLY);
    if (fd < 0) {
        perror("open /dev/full");
        return 2;
    }
    file = gzdopen(fd, "wb");
    if (file == NULL) {
        close(fd);
        return 2;
    }
    if (gzbuffer(file, 128) != 0 || gzwrite(file, input, sizeof(input)) != 0) {
        fprintf(stderr, "expected a failed direct write\n");
        gzclose(file);
        return 2;
    }
    state = (gz_statep)file;
    failed = state->strm.avail_in != 0 || state->strm.next_in != state->in;
    if (failed)
        fprintf(stderr, "failed write retained external input state\n");
    gzclose(file);
    return failed;
}
