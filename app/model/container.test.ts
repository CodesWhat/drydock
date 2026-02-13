// @ts-nocheck
import * as container from './container.js';

test('model should be validated when compliant', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',

    linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '2.0.0',
    },
  });

  expect(containerValidated.resultChanged.name).toEqual('resultChangedFunction');
  delete containerValidated.resultChanged;

  expect(containerValidated).toStrictEqual({
    id: 'container-123456789',
    status: 'unknown',
    image: {
      architecture: 'arch',
      created: '2021-06-12T05:33:38.440Z',
      digest: {
        watch: false,
        repo: undefined,
      },
      id: 'image-123456789',
      name: 'organization/image',
      os: 'os',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      tag: {
        semver: true,
        value: '1.0.0',
      },
    },
    name: 'test',
    displayName: 'test',
    displayIcon: 'mdi:docker',

    linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
    link: 'https://release-1.0.0.acme.com',
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
      semverDiff: 'major',
    },
    result: {
      link: 'https://release-2.0.0.acme.com',
      tag: '2.0.0',
    },
    watcher: 'test',
  });
});

test('model should not be validated when invalid', async () => {
  expect(() => {
    container.validate({});
  }).toThrow();
});

test('model should flag updateAvailable when tag is different', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'x',
        semver: false,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: 'y',
    },
  });
  expect(containerValidated.updateAvailable).toBeTruthy();
});

test('model should not flag updateAvailable when tag is equal', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'x',
        semver: false,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: 'x',
    },
  });
  expect(containerValidated.updateAvailable).toBeFalsy();
});

test('model should flag updateAvailable when digest is different', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'x',
        semver: false,
      },
      digest: {
        watch: true,
        repo: 'x',
        value: 'x',
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: 'x',
      digest: 'y',
    },
  });
  expect(containerValidated.updateAvailable).toBeTruthy();
});

test('model should suppress tag update when remote tag is skipped', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    updatePolicy: {
      skipTags: ['1.0.1'],
    },
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '1.0.1',
    },
  });
  expect(containerValidated.updateAvailable).toBeFalsy();
  expect(containerValidated.updateKind).toEqual({
    kind: 'tag',
    localValue: '1.0.0',
    remoteValue: '1.0.1',
    semverDiff: 'patch',
  });
});

test('model should suppress updates when snoozed in the future', async () => {
  const snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    updatePolicy: {
      snoozeUntil,
    },
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '1.0.1',
    },
  });
  expect(containerValidated.updateAvailable).toBeFalsy();
  expect(containerValidated.updateKind.kind).toBe('tag');
});

test('model should keep updateAvailable when remote tag changes past skipped value', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    updatePolicy: {
      skipTags: ['1.0.1'],
    },
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '1.0.2',
    },
  });
  expect(containerValidated.updateAvailable).toBeTruthy();
  expect(containerValidated.updateKind.remoteValue).toBe('1.0.2');
});

test('model should flag updateAvailable when created is different', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'x',
        semver: false,
      },
      digest: {
        watch: true,
        repo: 'x',
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: 'x',
      created: '2021-06-15T05:33:38.440Z',
    },
  });
  const containerEquals = container.validate({
    ...containerValidated,
  });
  const containerDifferent = container.validate({
    ...containerValidated,
  });
  containerDifferent.result.tag = 'y';
  expect(containerValidated.updateAvailable).toBeTruthy();
  expect(containerValidated.updateKind).toEqual({
    kind: 'unknown',
    semverDiff: 'unknown',
  });
  expect(containerValidated.resultChanged(containerEquals)).toBeFalsy();
  expect(containerValidated.resultChanged(containerDifferent)).toBeTruthy();
});

test('model should suppress created-only update when snoozed', async () => {
  const snoozeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    updatePolicy: {
      snoozeUntil,
    },
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'latest',
        semver: false,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: 'latest',
      created: '2021-06-15T05:33:38.440Z',
    },
  });

  expect(containerValidated.updateKind).toEqual({
    kind: 'unknown',
    semverDiff: 'unknown',
  });
  expect(containerValidated.updateAvailable).toBeFalsy();
});

test('model should support transforms for links', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    transformTags: '^(\\d+\\.\\d+)-.*-(\\d+) => $1.$2',

    linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: '1.2-foo-3',
        semver: true,
      },
      digest: {},
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: '1.2-bar-4',
    },
  });

  expect(containerValidated).toMatchObject({
    link: 'https://release-1.2.3.acme.com',
    result: {
      link: 'https://release-1.2.4.acme.com',
    },
  });
});

test('flatten should be flatten the nested properties with underscores when called', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',

    linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      tag: '2.0.0',
    },
  });

  expect(container.flatten(containerValidated)).toEqual({
    id: 'container-123456789',
    status: 'unknown',
    image_architecture: 'arch',
    image_created: '2021-06-12T05:33:38.440Z',
    image_digest_watch: false,
    image_id: 'image-123456789',
    image_name: 'organization/image',
    image_os: 'os',
    image_registry_name: 'hub',
    image_registry_url: 'https://hub',
    image_tag_semver: true,
    image_tag_value: '1.0.0',
    link: 'https://release-1.0.0.acme.com',

    link_template: 'https://release-${major}.${minor}.${patch}.acme.com',
    name: 'test',
    display_name: 'test',
    display_icon: 'mdi:docker',
    result_link: 'https://release-2.0.0.acme.com',
    result_tag: '2.0.0',
    update_available: true,
    update_kind_kind: 'tag',
    update_kind_local_value: '1.0.0',
    update_kind_remote_value: '2.0.0',
    update_kind_semver_diff: 'major',
    watcher: 'test',
  });
});

test('fullName should build an id with watcher name & container name when called', async () => {
  expect(
    container.fullName({
      watcher: 'watcher',
      name: 'container_name',
    }),
  ).toEqual('watcher_container_name');
});

test('model should migrate legacy lookupUrl to lookupImage', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
        lookupUrl: 'https://registry-1.docker.io',
      },
      name: 'organization/image',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: '1.0.0',
    },
  });

  expect(containerValidated.image.registry.lookupImage).toBe('https://registry-1.docker.io');
  expect(containerValidated.image.registry.lookupUrl).toBeUndefined();
});

test('flatten should include lookup image when configured', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
        lookupImage: 'library/nginx',
      },
      name: 'organization/image',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
        repo: undefined,
      },
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: '1.0.0',
    },
  });

  expect(container.flatten(containerValidated).image_registry_lookup_image).toBe('library/nginx');
});

test('getLink should render link templates when called', async () => {
  const { testable_getLink: getLink } = container;
  expect(
    getLink(
      {
        linkTemplate: 'https://test-${major}.${minor}.${patch}.acme.com',
        image: {
          tag: {
            semver: true,
          },
        },
      },
      '10.5.2',
    ),
  ).toEqual('https://test-10.5.2.acme.com');
});

test('getLink should render undefined when template is missing', async () => {
  const { testable_getLink: getLink } = container;
  expect(getLink(undefined)).toBeUndefined();
});

test('addUpdateKindProperty should detect major update', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    updateAvailable: true,
    image: {
      tag: {
        value: '1.0.0',
        semver: true,
      },
    },
    result: {
      tag: '2.0.0',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'tag',
    localValue: '1.0.0',
    remoteValue: '2.0.0',
    semverDiff: 'major',
  });
});

test('addUpdateKindProperty should detect minor update', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    updateAvailable: true,
    image: {
      tag: {
        value: '1.0.0',
        semver: true,
      },
    },
    result: {
      tag: '1.1.0',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'tag',
    localValue: '1.0.0',
    remoteValue: '1.1.0',
    semverDiff: 'minor',
  });
});

test('addUpdateKindProperty should detect patch update', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    updateAvailable: true,
    image: {
      tag: {
        value: '1.0.0',
        semver: true,
      },
    },
    result: {
      tag: '1.0.1',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'tag',
    localValue: '1.0.0',
    remoteValue: '1.0.1',
    semverDiff: 'patch',
  });
});

test('addUpdateKindProperty should support transforms', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    transformTags: '^(\\d+\\.\\d+)-.*-(\\d+) => $1.$2',
    updateAvailable: true,
    image: {
      tag: {
        value: '1.2-foo-3',
        semver: true,
      },
    },
    result: {
      tag: '1.2-bar-4',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'tag',
    localValue: '1.2-foo-3',
    remoteValue: '1.2-bar-4',
    semverDiff: 'patch',
  });
});

test('addUpdateKindProperty should detect prerelease semver update', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    updateAvailable: true,
    image: {
      tag: {
        value: '1.0.0-test1',
        semver: true,
      },
    },
    result: {
      tag: '1.0.0-test2',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'tag',
    localValue: '1.0.0-test1',
    remoteValue: '1.0.0-test2',
    semverDiff: 'prerelease',
  });
});

test('addUpdateKindProperty should detect digest update', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    updateAvailable: true,
    image: {
      tag: {
        value: 'latest',
        semver: false,
      },
      digest: {
        watch: true,
        value: 'sha256:123465789',
      },
    },
    result: {
      tag: 'latest',
      digest: 'sha256:987654321',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'digest',
    localValue: 'sha256:123465789',
    remoteValue: 'sha256:987654321',
    semverDiff: 'unknown',
  });
});

test('addUpdateKindProperty should return unknown when no image or result', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {};
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'unknown',
    semverDiff: 'unknown',
  });
});

test('addUpdateKindProperty should return unknown when no update available', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: 'image',
    result: {},
    updateAvailable: false,
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'unknown',
    semverDiff: 'unknown',
  });
});

test('addUpdateKindProperty should return unknown when tag.value is undefined', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: {},
      digest: { watch: false },
    },
    result: {
      tag: 'v2',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'unknown',
    semverDiff: 'unknown',
  });
});

test('addUpdateKindProperty should return unknown when result.tag is undefined', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: { value: 'v1', semver: false },
      digest: { watch: false },
    },
    result: {},
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'unknown',
    semverDiff: 'unknown',
  });
});

test('model should suppress digest update when digest is in skipDigests', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    updatePolicy: {
      skipDigests: ['sha256:newdigest'],
    },
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'latest',
        semver: false,
      },
      digest: {
        watch: true,
        value: 'sha256:olddigest',
      },
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: 'latest',
      digest: 'sha256:newdigest',
    },
  });
  expect(containerValidated.updateAvailable).toBeFalsy();
  expect(containerValidated.updateKind).toEqual({
    kind: 'digest',
    localValue: 'sha256:olddigest',
    remoteValue: 'sha256:newdigest',
    semverDiff: 'unknown',
  });
});

test('model should not flag updateAvailable when digest watch is true but values match', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'organization/image',
      tag: {
        value: 'latest',
        semver: false,
      },
      digest: {
        watch: true,
        value: 'sha256:samedigest',
      },
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: 'latest',
      digest: 'sha256:samedigest',
    },
  });
  expect(containerValidated.updateAvailable).toBeFalsy();
});

test('resultChanged should return true when other container is undefined', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: 'v1', semver: false },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: { tag: 'v1' },
  });
  expect(containerValidated.resultChanged(undefined)).toBeTruthy();
});

test('resultChanged should return true when digest differs', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: 'v1', semver: false },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: { tag: 'v1', digest: 'sha256:abc' },
  });

  const other = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: 'v1', semver: false },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: { tag: 'v1', digest: 'sha256:def' },
  });

  expect(containerValidated.resultChanged(other)).toBeTruthy();
});

test('getLink should use raw variable for backward compatibility', () => {
  const { testable_getLink: getLink } = container;
  expect(
    getLink(
      {
        linkTemplate: 'https://v${raw}',
        image: { tag: { semver: false } },
      },
      'mytagvalue',
    ),
  ).toEqual('https://vmytagvalue');
});

test('getLink should handle transformed tag in link', () => {
  const { testable_getLink: getLink } = container;
  expect(
    getLink(
      {
        linkTemplate: 'https://v${transformed}',
        transformTags: '^v(.*) => $1',
        image: { tag: { semver: false } },
      },
      'v1.2.3',
    ),
  ).toEqual('https://v1.2.3');
});

test('getLink should handle empty prerelease', () => {
  const { testable_getLink: getLink } = container;
  const result = getLink(
    {
      linkTemplate: 'https://test-${prerelease}.acme.com',
      image: { tag: { semver: true } },
    },
    '1.0.0',
  );
  expect(result).toEqual('https://test-.acme.com');
});

test('getLink should handle unknown template vars gracefully', () => {
  const { testable_getLink: getLink } = container;
  const result = getLink(
    {
      linkTemplate: 'https://test-${unknownvar}.acme.com',
      image: { tag: { semver: false } },
    },
    '1.0.0',
  );
  expect(result).toEqual('https://test-.acme.com');
});

test('model should handle non-semver tag update', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: { value: 'latest', semver: false },
    },
    result: {
      tag: 'stable',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'tag',
    localValue: 'latest',
    remoteValue: 'stable',
    semverDiff: 'unknown',
  });
});

test('model should handle premajor semver diff', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: { value: '1.0.0-alpha.1', semver: true },
    },
    result: {
      tag: '2.0.0-alpha.1',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind.semverDiff).toBe('major');
});

test('model should handle preminor semver diff', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: { value: '1.0.0-alpha.1', semver: true },
    },
    result: {
      tag: '1.1.0-alpha.1',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind.semverDiff).toBe('minor');
});

test('model should return false for updateAvailable when no result', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
  });
  expect(containerValidated.updateAvailable).toBeFalsy();
  expect(containerValidated.updateKind.kind).toBe('unknown');
});

test('model should return false for updateAvailable when no image', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    result: { tag: 'v2' },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind.kind).toBe('unknown');
});

test('model should not suppress update when snoozeUntil is in the past', async () => {
  const pastSnooze = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    updatePolicy: {
      snoozeUntil: pastSnooze,
    },
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: '1.0.1',
    },
  });
  expect(containerValidated.updateAvailable).toBeTruthy();
});

test('model should not suppress update when snoozeUntil is invalid', async () => {
  const containerValidated = container.validate({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    updatePolicy: {
      snoozeUntil: '2021-06-12T05:33:38.440Z',
    },
    image: {
      id: 'image-123456789',
      registry: { name: 'hub', url: 'https://hub' },
      name: 'organization/image',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'arch',
      os: 'os',
    },
    result: {
      tag: '1.0.1',
    },
  });
  expect(containerValidated.updateAvailable).toBeTruthy();
});

test('getLink should return undefined when container is null', () => {
  const { testable_getLink: getLink } = container;
  expect(getLink(null, '1.0.0')).toBeUndefined();
});

test('getLink should return undefined when linkTemplate is missing', () => {
  const { testable_getLink: getLink } = container;
  expect(getLink({ image: { tag: { semver: false } } }, '1.0.0')).toBeUndefined();
});

test('model should handle prepatch semver diff', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: { value: '1.0.0-alpha.1', semver: true },
    },
    result: {
      tag: '1.0.1-alpha.1',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind.semverDiff).toBe('patch');
});

test('model should handle semver diff returning null (same version)', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  // Same semver but different raw tags (e.g. through transform)
  const containerObject = {
    transformTags: '^v(.*) => $1',
    image: {
      tag: { value: 'v1.0.0', semver: true },
    },
    result: {
      tag: '1.0.0', // different raw but same after transform
    },
  };
  addUpdateKindProperty(containerObject);
  // Tags are different (v1.0.0 vs 1.0.0) so kind=tag, but after transform
  // both are 1.0.0, so no tag update
  expect(containerObject.updateKind.kind).toBe('unknown');
});

test('model should handle digest watch mode with matching digests returning unknown update kind', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: { value: 'latest', semver: false },
      digest: {
        watch: true,
        value: 'sha256:same',
      },
    },
    result: {
      tag: 'latest',
      digest: 'sha256:same',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind.kind).toBe('unknown');
});

test('model should keep semverDiff unknown when semver diff cannot be classified', async () => {
  const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
  const containerObject = {
    image: {
      tag: { value: '1.0.0+build1', semver: true },
    },
    result: {
      tag: '1.0.0+build2',
    },
  };
  addUpdateKindProperty(containerObject);
  expect(containerObject.updateKind).toEqual({
    kind: 'tag',
    localValue: '1.0.0+build1',
    remoteValue: '1.0.0+build2',
    semverDiff: 'unknown',
  });
});

test('testable_getRawTagUpdate should return unknown when image/result are missing', () => {
  expect(container.testable_getRawTagUpdate({})).toEqual({
    kind: 'unknown',
    localValue: undefined,
    remoteValue: undefined,
    semverDiff: 'unknown',
  });
});

test('testable_getRawDigestUpdate should return unknown when image/result are missing', () => {
  expect(container.testable_getRawDigestUpdate({})).toEqual({
    kind: 'unknown',
    localValue: undefined,
    remoteValue: undefined,
    semverDiff: 'unknown',
  });
});

test('addLinkProperty should fallback to empty result tag when result tag is missing', () => {
  const containerObject = {
    linkTemplate: 'https://release/${transformed}',
    image: {
      tag: {
        value: '1.0.0',
        semver: false,
      },
    },
    result: {},
  };

  container.testable_addLinkProperty(containerObject);
  expect(containerObject.result.link).toBe('https://release/');
});

test('getLink should expose prerelease token when semver has prerelease parts', () => {
  const link = container.testable_getLink(
    {
      linkTemplate: 'https://release/${prerelease}',
      image: {
        tag: {
          semver: true,
        },
      },
    },
    '1.2.3-rc.1',
  );
  expect(link).toBe('https://release/rc');
});

test('addLinkProperty should skip result link definition when container.result is missing', () => {
  const containerObject = {
    linkTemplate: 'https://release/${transformed}',
    image: {
      tag: {
        value: '1.0.0',
        semver: false,
      },
    },
  };

  container.testable_addLinkProperty(containerObject);
  expect(containerObject.link).toBe('https://release/1.0.0');
  expect(containerObject.result).toBeUndefined();
});
