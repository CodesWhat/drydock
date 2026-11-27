export function observedWriteTimeout(log) {
  return (
    log.includes('websocket write failed') &&
    log.includes('i/o timeout') &&
    log.includes('evicting controller connection')
  );
}

export async function observeSlowConsumerReconnect({
  socket,
  startStream,
  waitFor,
  findReplacement,
  hasWriteTimeout,
  timeoutMs,
}) {
  let frames = 0;
  let paused = false;
  const stream = startStream(() => {
    frames += 1;
  });
  try {
    await waitFor('follow stream frames before eviction pause', () => frames > 0);
    socket.pause();
    paused = true;
    return await waitFor(
      'slow-consumer write-timeout eviction and reconnect',
      () => {
        const replacement = findReplacement();
        return replacement && hasWriteTimeout() ? replacement : undefined;
      },
      timeoutMs,
    );
  } finally {
    if (paused) socket.resume();
    stream?.cancel?.();
  }
}
