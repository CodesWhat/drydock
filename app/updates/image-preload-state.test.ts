import type { Container } from '../model/container.js';
import {
  clearImagePreload,
  countImagePreloads,
  getImagePreload,
  getImagePreloadView,
  getPreloadCandidate,
  peekImagePreload,
  resetImagePreloads,
  setImagePreload,
} from './image-preload-state.js';

function makeContainer(overrides: Record<string, unknown> = {}): Container {
  return {
    id: 'c1',
    identityKey: 'local::local::web',
    result: { tag: '2', digest: 'sha256:aaa' },
    ...overrides,
  } as unknown as Container;
}

const base = { status: 'done' as const, image: 'org/web@sha256:aaa', host: 'local.local' };

beforeEach(() => {
  resetImagePreloads();
});

test('candidate is the digest, else the tag', () => {
  expect(getPreloadCandidate(makeContainer())).toBe('sha256:aaa');
  expect(getPreloadCandidate(makeContainer({ result: { tag: '2' } }))).toBe('2');
  expect(getPreloadCandidate(makeContainer({ result: undefined }))).toBeUndefined();
});

test('state is keyed by identity and survives a container id change', () => {
  setImagePreload(makeContainer(), { ...base, candidate: 'sha256:aaa', digest: 'sha256:aaa' });
  expect(getImagePreload(makeContainer({ id: 'recreated' }))?.status).toBe('done');
});

test('falls back to the id when there is no identity key', () => {
  const container = makeContainer({ identityKey: undefined });
  setImagePreload(container, { ...base, candidate: 'sha256:aaa' });
  expect(peekImagePreload(container)).toBeDefined();
  expect(peekImagePreload(makeContainer({ identityKey: undefined, id: 'other' }))).toBeUndefined();
});

test('a stale candidate reads as none but stays peekable', () => {
  const container = makeContainer();
  setImagePreload(container, { ...base, candidate: 'sha256:old' });
  expect(getImagePreload(container)).toBeUndefined();
  expect(getImagePreloadView(container)).toBeUndefined();
  expect(peekImagePreload(container)?.candidate).toBe('sha256:old');
});

test('the public view hides the host and candidate keys', () => {
  const container = makeContainer();
  setImagePreload(container, { ...base, candidate: 'sha256:aaa', digest: 'sha256:aaa' });
  const view = getImagePreloadView(container);
  expect(view).toEqual({
    status: 'done',
    image: 'org/web@sha256:aaa',
    digest: 'sha256:aaa',
    updatedAt: expect.any(String),
  });
});

test('clear removes the entry', () => {
  const container = makeContainer();
  setImagePreload(container, { ...base, candidate: 'sha256:aaa' });
  clearImagePreload(container);
  expect(peekImagePreload(container)).toBeUndefined();
});

test('count covers pending and done on one host, skipping failed and the excluded container', () => {
  const a = makeContainer({ identityKey: 'a' });
  const b = makeContainer({ identityKey: 'b' });
  const c = makeContainer({ identityKey: 'c' });
  const d = makeContainer({ identityKey: 'd' });
  setImagePreload(a, { ...base, candidate: 'x', status: 'pending' });
  setImagePreload(b, { ...base, candidate: 'x' });
  setImagePreload(c, { ...base, candidate: 'x', status: 'failed' });
  setImagePreload(d, { ...base, candidate: 'x', host: 'other' });
  expect(countImagePreloads('local.local')).toBe(2);
  expect(countImagePreloads('local.local', a)).toBe(1);
  expect(countImagePreloads('other')).toBe(1);
});
