import Loki from 'lokijs';
import { createContainerFixture } from '../test/helpers.js';
import * as containerStore from './container.js';
import * as operationStore from './update-operation.js';

beforeEach(() => {
  containerStore._resetContainerStoreStateForTests();
});

test('serialized container records omit sensitive env values', () => {
  const db = new Loki('env-persistence.json');
  containerStore.createCollections(db);
  const secret = 'fixture-private-value-1523';
  const env = [
    { key: 'DB_PASSWORD', value: secret },
    { key: 'PUBLIC_MODE', value: 'visible-setting' },
  ];

  containerStore.insertContainer(
    createContainerFixture({ details: { ports: [], volumes: [], env } }),
  );

  const serialized = db.serialize();
  expect(serialized).not.toContain(secret);
  expect(serialized).toContain('visible-setting');
  expect(env[0].value).toBe(secret);
});

test('updating a container does not serialize new sensitive env values', () => {
  const db = new Loki('env-persistence.json');
  containerStore.createCollections(db);
  containerStore.insertContainer(createContainerFixture());
  const secret = 'fixture-updated-private-value-1523';

  containerStore.updateContainer(
    createContainerFixture({
      details: { ports: [], volumes: [], env: [{ key: 'DB_PASSWORD', value: secret }] },
    }),
  );

  expect(db.serialize()).not.toContain(secret);
});

test('stored URL credentials remain classified when a container is read again', () => {
  const db = new Loki('env-persistence.json');
  containerStore.createCollections(db);
  const input = createContainerFixture({
    details: {
      ports: [],
      volumes: [],
      env: [
        {
          key: 'ENDPOINT_URL',
          value: 'https://fixture-user:fixture-password@example.invalid/api',
        },
      ],
    },
  });
  containerStore.insertContainer(input);

  expect(containerStore.getContainer(input.id)).toMatchObject({
    details: { env: [{ key: 'ENDPOINT_URL', value: '[REDACTED]', sensitive: true }] },
  });
});

test('serialized update operations omit sensitive container env values', () => {
  const db = new Loki('env-persistence.json');
  operationStore.createCollections(db);
  const secret = 'fixture-operation-private-value-1523';
  const input = createContainerFixture({
    details: {
      ports: [],
      volumes: [],
      env: [{ key: 'DB_PASSWORD', value: secret }],
    },
  });

  operationStore.insertOperation({ containerName: input.name, container: input });

  expect(db.serialize()).not.toContain(secret);
});

test('updating an operation does not serialize new sensitive container env values', () => {
  const db = new Loki('env-persistence.json');
  operationStore.createCollections(db);
  const operation = operationStore.insertOperation({ containerName: 'test' });
  const secret = 'fixture-updated-operation-private-value-1523';

  operationStore.updateOperation(operation.id, {
    container: createContainerFixture({
      details: {
        ports: [],
        volumes: [],
        env: [{ key: 'DB_PASSWORD', value: secret }],
      },
    }),
  });

  expect(db.serialize()).not.toContain(secret);
});
