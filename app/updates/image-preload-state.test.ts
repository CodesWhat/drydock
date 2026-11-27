import type { Container } from '../model/container.js';
import {
  clearImagePreload,
  countRetainedImagePreloads,
  getImagePreload,
  getImagePreloadView,
  getPreloadCandidate,
  hasRetainedImagePreload,
  peekImagePreload,
  releaseImagePreload,
  resetImagePreloads,
  retainImagePreload,
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

test('retained references are counted per host, once per distinct image', () => {
  const a = makeContainer({ identityKey: 'a' });
  const b = makeContainer({ identityKey: 'b' });
  retainImagePreload('h1', 'img:1', a);
  retainImagePreload('h1', 'img:1', b);
  retainImagePreload('h1', 'img:2', a);
  retainImagePreload('h2', 'img:1', a);
  expect(countRetainedImagePreloads('h1')).toBe(2);
  expect(countRetainedImagePreloads('h2')).toBe(1);
  expect(countRetainedImagePreloads('none')).toBe(0);
  expect(hasRetainedImagePreload('h1', 'img:1')).toBe(true);
  expect(hasRetainedImagePreload('h1', 'img:3')).toBe(false);
  expect(hasRetainedImagePreload('none', 'img:1')).toBe(false);
});

test('release reports the last owner only', () => {
  const a = makeContainer({ identityKey: 'a' });
  const b = makeContainer({ identityKey: 'b' });
  retainImagePreload('h1', 'img:1', a);
  retainImagePreload('h1', 'img:1', b);
  expect(releaseImagePreload('h1', 'img:1', a)).toBe(false);
  expect(releaseImagePreload('h1', 'img:1', a)).toBe(false);
  expect(hasRetainedImagePreload('h1', 'img:1')).toBe(true);
  expect(releaseImagePreload('h1', 'img:1', b)).toBe(true);
  expect(countRetainedImagePreloads('h1')).toBe(0);
  expect(releaseImagePreload('h1', 'img:1', b)).toBe(false);
});

test('release keeps the host entry while other references remain', () => {
  const a = makeContainer({ identityKey: 'a' });
  retainImagePreload('h1', 'img:1', a);
  retainImagePreload('h1', 'img:2', a);
  expect(releaseImagePreload('h1', 'img:1', a)).toBe(true);
  expect(countRetainedImagePreloads('h1')).toBe(1);
});

test('reset forgets retained references', () => {
  retainImagePreload('h1', 'img:1', makeContainer());
  resetImagePreloads();
  expect(countRetainedImagePreloads('h1')).toBe(0);
});
