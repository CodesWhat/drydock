import pLimit from 'p-limit';

const DOCKER_WATCH_CONCURRENCY = 10;

export function mapWithDockerWatchConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R> | R,
) {
  const limit = pLimit(DOCKER_WATCH_CONCURRENCY);
  return Promise.all(items.map((item, index) => limit(() => mapper(item, index))));
}

export function allSettledWithDockerWatchConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R> | R,
) {
  const limit = pLimit(DOCKER_WATCH_CONCURRENCY);
  return Promise.allSettled(items.map((item, index) => limit(() => mapper(item, index))));
}
