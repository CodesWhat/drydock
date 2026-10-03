import type { Container } from '../../model/container.js';
import { createNotificationContainerLookup } from './trigger-current-container.js';

function container(overrides: Partial<Container> = {}): Container {
  return { id: 'old', name: 'api', watcher: 'local', ...overrides } as Container;
}

function compose(project: string, service = 'api') {
  return {
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
  };
}

test('exact Docker identity wins over business identity and names', () => {
  const exact = container({ name: 'renamed' });
  const sameName = container({ id: 'replacement' });
  expect(createNotificationContainerLookup([sameName, exact])(container())).toBe(exact);
});

test('duplicate Docker IDs are ambiguous instead of last-write-wins', () => {
  expect(
    createNotificationContainerLookup([container(), container({ name: 'different' })])(container()),
  ).toBeNull();
});

test('canonical Compose identity survives recreation and a renamed container', () => {
  const replacement = container({ id: 'new', name: 'renamed', labels: compose('payments') });
  const sibling = container({ id: 'sibling', labels: compose('media') });
  expect(
    createNotificationContainerLookup([sibling, replacement])(
      container({ labels: compose('payments') }),
    ),
  ).toBe(replacement);
});

test('derived canonical identity takes precedence over a stale persisted key', () => {
  const replacement = container({ id: 'new', identityKey: 'stale-current' });
  expect(
    createNotificationContainerLookup([replacement])(container({ identityKey: 'stale-queued' })),
  ).toBe(replacement);
});

test('persisted identity remains usable when canonical fields are unavailable', () => {
  const replacement = { id: 'new', identityKey: 'durable' } as Container;
  expect(
    createNotificationContainerLookup([replacement])({
      id: 'old',
      identityKey: 'durable',
    } as Container),
  ).toBe(replacement);
});

test('a unique scoped name is a fallback after the Compose identity changes', () => {
  const replacement = container({ id: 'new', labels: compose('new-project') });
  expect(
    createNotificationContainerLookup([replacement])(container({ labels: compose('old-project') })),
  ).toBe(replacement);
});

test('a unique replica name disambiguates siblings sharing a Compose service', () => {
  const first = container({ id: 'new-first', name: 'api-1', labels: compose('payments') });
  const second = container({ id: 'new-second', name: 'api-2', labels: compose('payments') });
  expect(
    createNotificationContainerLookup([first, second])(
      container({ name: 'api-1', labels: compose('payments') }),
    ),
  ).toBe(first);
});

test('a name outside the ambiguous canonical set cannot select another project', () => {
  const first = container({ id: 'first', name: 'api-1', labels: compose('payments') });
  const second = container({ id: 'second', name: 'api-2', labels: compose('payments') });
  const other = container({ id: 'other', labels: compose('media') });
  expect(
    createNotificationContainerLookup([first, second, other])(
      container({ labels: compose('payments') }),
    ),
  ).toBeNull();
});

test('ambiguous canonical identity without a matching name remains ambiguous', () => {
  expect(
    createNotificationContainerLookup([
      container({ id: 'first', name: 'api-1', labels: compose('payments') }),
      container({ id: 'second', name: 'api-2', labels: compose('payments') }),
    ])(container({ labels: compose('payments') })),
  ).toBeNull();
});

test('duplicate fallback names stay ambiguous across different Compose projects', () => {
  expect(
    createNotificationContainerLookup([
      container({ id: 'first', labels: compose('one') }),
      container({ id: 'second', labels: compose('two') }),
    ])(container({ labels: compose('old') })),
  ).toBeNull();
});

test.each([{ agent: 'other' }, { watcher: 'other' }])(
  'fallback names do not cross ownership boundaries %j',
  (ownership) => {
    expect(
      createNotificationContainerLookup([
        container({ id: 'new', labels: compose('new-project'), ...ownership }),
      ])(container({ labels: compose('old-project') })),
    ).toBeUndefined();
  },
);

test('genuinely absent and incomplete records are not treated as ambiguous', () => {
  const lookup = createNotificationContainerLookup([
    { name: 'incomplete' } as Container,
    { watcher: 'local' } as Container,
  ]);
  expect(lookup(container())).toBeUndefined();
  expect(lookup({ id: 'missing' } as Container)).toBeUndefined();
});

test('repeated references to one record do not create false ambiguity', () => {
  const current = container();
  expect(createNotificationContainerLookup([current, current])(container())).toBe(current);
});
