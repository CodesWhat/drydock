import { resolveExplicitComposeMacAddresses } from './ComposeMacIntent.js';

const MAC_A = '02:42:ac:11:00:aa';
const MAC_B = '02:42:ac:11:00:bb';

function resolve(overrides = {}) {
  return resolveExplicitComposeMacAddresses({
    composeDocuments: [],
    service: 'web',
    project: 'stack',
    runtimeNetworkNames: ['stack_front', 'stack_back'],
    primaryNetworkName: 'stack_back',
    ...overrides,
  });
}

describe('resolveExplicitComposeMacAddresses', () => {
  test('maps explicit per-network MACs to project-prefixed runtime networks', () => {
    const result = resolve({
      composeDocuments: [
        {
          services: {
            web: {
              networks: { front: { mac_address: MAC_A }, back: { ipv4_address: '10.0.0.5' } },
            },
          },
        },
      ],
    });
    expect(result).toEqual({ stack_front: MAC_A });
  });

  test('pins different MACs on different networks without cross-copying', () => {
    const result = resolve({
      composeDocuments: [
        {
          services: {
            web: { networks: { front: { mac_address: MAC_A }, back: { mac_address: MAC_B } } },
          },
        },
      ],
    });
    expect(result).toEqual({ stack_front: MAC_A, stack_back: MAC_B });
  });

  test('uses the explicit name or external key of a top-level network', () => {
    const result = resolve({
      runtimeNetworkNames: ['lan_macvlan', 'shared', 'stack_other'],
      primaryNetworkName: 'shared',
      composeDocuments: [
        {
          networks: {
            lan: { name: 'lan_macvlan' },
            shared: { external: true },
            other: { name: '${OTHER_NAME}' },
          },
          services: {
            web: {
              networks: {
                lan: { mac_address: MAC_A },
                shared: { mac_address: MAC_B },
                other: { mac_address: MAC_B },
              },
            },
          },
        },
      ],
    });
    expect(result).toEqual({ lan_macvlan: MAC_A, shared: MAC_B });
  });

  test('later override files win and keep inherited MACs when they only change other keys', () => {
    const result = resolve({
      composeDocuments: [
        {
          networks: { front: { name: 'stack_front' } },
          services: {
            web: { networks: { front: { mac_address: MAC_A }, back: { mac_address: MAC_A } } },
          },
        },
        {
          services: {
            other: { networks: ['front'] },
            web: {
              networks: { front: { ipv4_address: '10.0.0.9' }, back: { mac_address: MAC_B } },
            },
          },
        },
        { services: { web: { networks: ['front'] } } },
        { services: 'invalid' },
      ],
    });
    expect(result).toEqual({ stack_front: MAC_A, stack_back: MAC_B });
  });

  test('an invalid later MAC clears the inherited one instead of resurrecting it', () => {
    const warn = vi.fn();
    const result = resolve({
      warn,
      composeDocuments: [
        { services: { web: { networks: { front: { mac_address: MAC_A } } } } },
        { services: { web: { networks: { front: { mac_address: '${MAC}' } } } } },
      ],
    });
    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a literal MAC address'));
  });

  test('normalizes dashed and upper-case MACs and ignores non-string values', () => {
    const result = resolve({
      composeDocuments: [
        {
          services: {
            web: {
              networks: {
                front: { mac_address: '02-42-AC-11-00-AA' },
                back: { mac_address: 42 },
              },
            },
          },
        },
      ],
    });
    expect(result).toEqual({ stack_front: MAC_A });
  });

  test('applies a service-level MAC to the primary network only', () => {
    const result = resolve({
      composeDocuments: [{ services: { web: { mac_address: MAC_A } } }],
    });
    expect(result).toEqual({ stack_back: MAC_A });
  });

  test('a per-network MAC takes precedence over the service-level MAC', () => {
    const result = resolve({
      composeDocuments: [
        {
          services: {
            web: { mac_address: MAC_A, networks: { front: { mac_address: MAC_B } } },
          },
        },
      ],
    });
    expect(result).toEqual({ stack_front: MAC_B });
  });

  test('ignores a service-level MAC when no primary network is known', () => {
    const result = resolve({
      primaryNetworkName: undefined,
      composeDocuments: [{ services: { web: { mac_address: MAC_A } } }],
    });
    expect(result).toEqual({});
  });

  test('skips MACs for networks the running container is not attached to', () => {
    const warn = vi.fn();
    const result = resolve({
      warn,
      composeDocuments: [{ services: { web: { networks: { gone: { mac_address: MAC_A } } } } }],
    });
    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not match a network'));
  });

  test('does not guess a runtime name without a project label or explicit name', () => {
    const result = resolve({
      project: undefined,
      composeDocuments: [{ services: { web: { networks: { front: { mac_address: MAC_A } } } } }],
    });
    expect(result).toEqual({});
  });

  test('never copies anything when no MAC is configured', () => {
    expect(
      resolve({
        composeDocuments: [
          { services: { web: { image: 'nginx', networks: { front: null, back: {} } } } },
          { services: { web: { networks: ['front', 7] } } },
          null,
        ],
      }),
    ).toEqual({});
  });

  test('tolerates null and external:false top-level network definitions', () => {
    const result = resolve({
      composeDocuments: [
        {
          networks: { front: null, back: { external: false } },
          services: {
            web: { networks: { front: { mac_address: MAC_A }, back: { mac_address: MAC_B } } },
          },
        },
      ],
    });
    expect(result).toEqual({ stack_front: MAC_A, stack_back: MAC_B });
  });
});
