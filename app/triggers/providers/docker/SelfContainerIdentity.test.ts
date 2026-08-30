import { resolveSelfContainerIdentity } from './SelfContainerIdentity.js';

vi.mock('node:os', () => ({ hostname: () => 'kernel-host' }));

function createDockerApi(containers, inspections = {}) {
  return {
    listContainers: vi.fn().mockResolvedValue(containers),
    getContainer: vi.fn((id) => ({
      inspect: vi.fn().mockResolvedValue(inspections[id]),
    })),
  };
}

describe('resolveSelfContainerIdentity', () => {
  test('uses the kernel hostname instead of a mutable HOSTNAME environment value', async () => {
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'peer-host';
    const dockerApi = createDockerApi([{ Id: 'current-id' }, { Id: 'peer-id' }], {
      'current-id': {
        Id: 'current-id',
        Name: '/drydock-current',
        Config: { Hostname: 'kernel-host' },
      },
      'peer-id': {
        Id: 'peer-id',
        Name: '/drydock-peer',
        Config: { Hostname: 'peer-host' },
      },
    });

    try {
      await expect(resolveSelfContainerIdentity(dockerApi)).resolves.toEqual({
        id: 'current-id',
        name: 'drydock-current',
      });
    } finally {
      process.env.HOSTNAME = originalHostname;
    }
  });

  test('resolves a custom runtime hostname from inspected Docker evidence, not a peer name', async () => {
    const dockerApi = createDockerApi(
      [
        { Id: 'aaaaaaaaaaaa1111', Names: ['/drydock-main'] },
        { Id: 'bbbbbbbbbbbb2222', Names: ['/app-host'] },
      ],
      {
        aaaaaaaaaaaa1111: {
          Id: 'aaaaaaaaaaaa1111',
          Name: '/drydock-main',
          Config: { Hostname: 'app-host' },
        },
        bbbbbbbbbbbb2222: {
          Id: 'bbbbbbbbbbbb2222',
          Name: '/app-host',
          Config: { Hostname: 'bbbbbbbbbbbb' },
        },
      },
    );

    await expect(resolveSelfContainerIdentity(dockerApi, 'app-host')).resolves.toEqual({
      id: 'aaaaaaaaaaaa1111',
      name: 'drydock-main',
    });
  });

  test.each([
    ['cccccccccccc', 'cccccccccccc3333'],
    ['cccccccccccc3333', 'cccccccccccc3333'],
  ])('resolves exact and short Docker ids (%s)', async (hostname, id) => {
    const dockerApi = createDockerApi([{ Id: id, Names: ['/drydock-main'] }]);

    await expect(resolveSelfContainerIdentity(dockerApi, hostname)).resolves.toEqual({
      id,
      name: 'drydock-main',
    });
  });

  test('fails closed when inspected hostname evidence is ambiguous', async () => {
    const dockerApi = createDockerApi(
      [
        { Id: 'aaaaaaaaaaaa1111', Names: ['/drydock-a'] },
        { Id: 'bbbbbbbbbbbb2222', Names: ['/drydock-b'] },
      ],
      {
        aaaaaaaaaaaa1111: {
          Id: 'aaaaaaaaaaaa1111',
          Name: '/drydock-a',
          Config: { Hostname: 'shared' },
        },
        bbbbbbbbbbbb2222: {
          Id: 'bbbbbbbbbbbb2222',
          Name: '/drydock-b',
          Config: { Hostname: 'shared' },
        },
      },
    );

    await expect(resolveSelfContainerIdentity(dockerApi, 'shared')).resolves.toBeNull();
  });

  test('fails closed when Docker runtime evidence is unavailable', async () => {
    const dockerApi = createDockerApi([]);
    dockerApi.listContainers.mockRejectedValue(new Error('socket unavailable'));

    await expect(resolveSelfContainerIdentity(dockerApi, 'drydock-main')).resolves.toBeNull();
    await expect(resolveSelfContainerIdentity(undefined, 'drydock-main')).resolves.toBeNull();
    await expect(resolveSelfContainerIdentity(dockerApi, undefined)).resolves.toBeNull();
  });

  test('fails closed for invalid or incomplete Docker identity evidence', async () => {
    const invalidHostnameApi = createDockerApi([]);
    await expect(resolveSelfContainerIdentity(invalidHostnameApi, 'bad/name')).resolves.toBeNull();

    await expect(
      resolveSelfContainerIdentity(
        createDockerApi([
          { Id: 'cccccccccccc1111', Names: ['/first'] },
          { Id: 'cccccccccccc2222', Names: ['/second'] },
        ]),
        'cccccccccccc',
      ),
    ).resolves.toBeNull();
    await expect(
      resolveSelfContainerIdentity(
        createDockerApi([{ Id: 'dddddddddddd1111', Names: [] }]),
        'dddddddddddd',
      ),
    ).resolves.toBeNull();
    await expect(
      resolveSelfContainerIdentity(createDockerApi([{ Id: undefined }]), 'custom-host'),
    ).resolves.toBeNull();

    const rejectedInspectApi = createDockerApi([{ Id: 'eeeeeeeeeeee1111' }]);
    rejectedInspectApi.getContainer = vi.fn(() => ({
      inspect: vi.fn().mockRejectedValue(new Error('inspect unavailable')),
    }));
    await expect(
      resolveSelfContainerIdentity(rejectedInspectApi, 'custom-host'),
    ).resolves.toBeNull();

    await expect(
      resolveSelfContainerIdentity(
        createDockerApi([{ Id: 'ffffffffffff1111' }], {
          ffffffffffff1111: { Id: 'ffffffffffff1111', Name: '/peer', Config: { Hostname: 'peer' } },
        }),
        'custom-host',
      ),
    ).resolves.toBeNull();
    await expect(
      resolveSelfContainerIdentity(
        createDockerApi([{ Id: '111111111111aaaa' }], {
          '111111111111aaaa': { Name: '/drydock', Config: { Hostname: 'custom-host' } },
        }),
        'custom-host',
      ),
    ).resolves.toBeNull();
    await expect(
      resolveSelfContainerIdentity(
        createDockerApi([{ Id: '222222222222aaaa' }], {
          '222222222222aaaa': { Id: '222222222222aaaa', Config: { Hostname: 'custom-host' } },
        }),
        'custom-host',
      ),
    ).resolves.toBeNull();
  });

  test('fails closed when Docker getContainer throws synchronously', async () => {
    const dockerApi = createDockerApi([{ Id: 'aaaaaaaaaaaa1111' }]);
    dockerApi.getContainer = vi.fn(() => {
      throw new Error('lookup unavailable');
    });

    await expect(resolveSelfContainerIdentity(dockerApi, 'custom-host')).resolves.toBeNull();
  });
});
