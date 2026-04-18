import joi from 'joi';
import log from '../../../log/index.js';
import Smtp from './Smtp.js';

const smtp = new Smtp();

const configurationValid = {
  allowcustomtld: false,
  host: 'smtp.gmail.com',
  port: '465',
  user: 'user',
  pass: 'pass',
  from: 'from@xx.com',
  to: 'to@xx.com',
  threshold: 'all',
  mode: 'simple',
  once: true,
  auto: 'all',
  order: 100,
  simpletitle:
    '${isDigestUpdate ? container.notificationAgentPrefix + "New image available for container " + container.name + container.notificationWatcherSuffix + " (tag " + currentTag + ")" : container.notificationAgentPrefix + "New " + container.updateKind.kind + " found for container " + container.name + container.notificationWatcherSuffix}',

  simplebody:
    '${isDigestUpdate ? container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running tag " + currentTag + " has a newer image available" : container.notificationAgentPrefix + "Container " + container.name + container.notificationWatcherSuffix + " running with " + container.updateKind.kind + " " + container.updateKind.localValue + " can be updated to " + container.updateKind.kind + " " + container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
  securitymode: 'simple',
  digestcron: '0 8 * * *',
};

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = smtp.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual({
    ...configurationValid,
    port: 465,
    tls: {
      enabled: false,
      verify: true,
    },
  });
});

test.each([
  {
    fromValue: 'This is a display name <from@xx.com>',
    expectedResult: '"This is a display name" <from@xx.com>',
  },
  {
    fromValue: '"This is a display name" <from@xx.com>',
    expectedResult: '"This is a display name" <from@xx.com>',
  },
  {
    fromValue: '"This is a display name <from@xx.com>',
    expectedResult: '"This is a display name" <from@xx.com>',
  },
  {
    fromValue: 'This is a display name" <from@xx.com>',
    expectedResult: '"This is a display name" <from@xx.com>',
  },
  {
    fromValue: 'This is a display name from@xx.com>',
    expectedResult: null,
  },
  {
    fromValue: 'This is a display name <from@xx.com',
    expectedResult: '"This is a display name" <from@xx.com>',
  },
  {
    fromValue: '"" <from@xx.com>',
    expectedResult: 'from@xx.com',
  },
  {
    fromValue: 'Display "Name" <from@xx.com>',
    expectedResult: null,
  },
  {
    fromValue: 'from@xx.com',
    expectedResult: 'from@xx.com',
  },
  {
    fromValue: 'This is a display name <from@@xx.com>',
    expectedResult: null,
  },
  {
    fromValue: 'This is a display name from@@xx.com',
    expectedResult: null,
  },
  {
    fromValue: 'from@@xx.com',
    expectedResult: null,
  },
  {
    fromValue: 'Multiline\nSender <from@xx.com>',
    expectedResult: null,
  },
])("smtp from value should normalize to '$expectedResult' when configuration is '$fromValue'", async ({
  fromValue,
  expectedResult,
}) => {
  const config = {
    ...configurationValid,
    from: fromValue,
  };

  if (expectedResult) {
    let validatedConfiguration;
    expect(() => {
      validatedConfiguration = smtp.validateConfiguration(config);
    }).not.toThrow(joi.ValidationError);
    expect(validatedConfiguration.from).toStrictEqual(expectedResult);
  } else {
    expect(() => {
      smtp.validateConfiguration(config);
    }).toThrow(joi.ValidationError);
  }
});

test.each([
  { allowCustomTld: true, field: 'from' },
  { allowCustomTld: false, field: 'from' },
  { allowCustomTld: true, field: 'to' },
  { allowCustomTld: false, field: 'to' },
  { allowCustomTld: true, field: 'both' },
  { allowCustomTld: false, field: 'both' },
])('trigger should $allowCustomTld allow custom tld for $field field', async ({
  allowCustomTld,
  field,
}) => {
  const config = {
    ...configurationValid,
    allowcustomtld: allowCustomTld,
    from: field === 'from' || field === 'both' ? 'user@domain.lan' : configurationValid.from,
    to: field === 'to' || field === 'both' ? 'user@domain.lan' : configurationValid.to,
  };

  if (allowCustomTld) {
    expect(() => {
      smtp.validateConfiguration(config);
    }).not.toThrow(joi.ValidationError);
  } else {
    expect(() => {
      smtp.validateConfiguration(config);
    }).toThrow(joi.ValidationError);
  }
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    host: 'smtp.gmail..com',
    port: 'xyz',
    from: 'from@@xx.com',
    to: 'to@@xx.com',
  };
  expect(() => {
    smtp.validateConfiguration(configuration);
  }).toThrow(joi.ValidationError);
});

test('init should create a mailer transporter with expected configuration when called', async () => {
  smtp.configuration = configurationValid;
  smtp.log = log;
  smtp.init();
  expect(smtp.transporter.options).toEqual(
    expect.objectContaining({
      host: configurationValid.host,
      port: configurationValid.port,
      auth: {
        user: configurationValid.user,
        pass: configurationValid.pass,
      },
      tls: {
        rejectUnauthorized: true,
      },
    }),
  );
});

test('maskConfiguration should mask sensitive data', async () => {
  smtp.configuration = {
    host: configurationValid.host,
    port: configurationValid.port,
    user: configurationValid.user,
    pass: configurationValid.pass,
  };
  expect(smtp.maskConfiguration()).toEqual({
    host: configurationValid.host,
    port: configurationValid.port,
    user: configurationValid.user,
    pass: '[REDACTED]',
  });
});

test('init should create transporter without auth when no user/pass', async () => {
  smtp.configuration = {
    ...configurationValid,
    user: undefined,
    pass: undefined,
  };
  smtp.log = log;
  smtp.initTrigger();
  expect(smtp.transporter.options.auth).toBeUndefined();
});

test('init should create transporter with tls enabled and verify false', async () => {
  smtp.configuration = {
    ...configurationValid,
    tls: {
      enabled: true,
      verify: false,
    },
  };
  smtp.log = log;
  smtp.initTrigger();
  expect(smtp.transporter.options.secure).toBe(true);
  expect(smtp.transporter.options.tls.rejectUnauthorized).toBe(false);
});

test('init should default tls rejectUnauthorized to true when tls is undefined', async () => {
  smtp.configuration = {
    ...configurationValid,
    tls: undefined,
  };
  smtp.log = log;
  smtp.initTrigger();
  expect(smtp.transporter.options.secure).toBeFalsy();
  expect(smtp.transporter.options.tls.rejectUnauthorized).toBe(true);
});

test('trigger should format mail as expected', async () => {
  smtp.configuration = configurationValid;
  smtp.transporter = {
    sendMail: (conf) => conf,
  };
  const response = await smtp.trigger({
    id: '31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816',
    name: 'homeassistant',
    watcher: 'local',
    includeTags: '^\\d+\\.\\d+.\\d+$',
    image: {
      id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
      registry: {
        url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
      },
      name: 'test',
      tag: {
        value: '2021.6.4',
        semver: true,
      },
      digest: {
        watch: false,
        repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
      },
      architecture: 'amd64',
      os: 'linux',
      created: '2021-06-12T05:33:38.440Z',
    },
    result: {
      link: 'https://test-2.0.0/changelog',
    },
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '2.0.0',
    },
  });
  expect(response.text).toEqual(
    'Container homeassistant running with tag 1.0.0 can be updated to tag 2.0.0\nhttps://test-2.0.0/changelog',
  );
});

test('trigger should format agent disconnect mail without container update wording', async () => {
  smtp.configuration = configurationValid;
  smtp.transporter = {
    sendMail: (conf) => conf,
  };
  const response = await smtp.trigger({
    id: 'agent-servicevault',
    name: 'servicevault',
    displayName: 'servicevault',
    displayIcon: 'mdi:server-network-off',
    status: 'disconnected',
    watcher: 'agent',
    image: {
      id: 'agent-servicevault',
      registry: {
        name: 'agent',
        url: 'agent://servicevault',
      },
      name: 'servicevault',
      tag: {
        value: 'disconnected',
        semver: false,
      },
      digest: {
        watch: false,
      },
      architecture: 'unknown',
      os: 'unknown',
    },
    error: {
      message: 'SSE connection lost',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    notificationEvent: {
      kind: 'agent-disconnect',
      agentName: 'servicevault',
      reason: 'SSE connection lost',
    },
  } as any);

  expect(response.subject).toBe('Agent servicevault disconnected');
  expect(response.text).toBe('Agent servicevault disconnected: SSE connection lost');
});

test('triggerBatch should format mail as expected', async () => {
  smtp.configuration = configurationValid;
  smtp.transporter = {
    sendMail: (conf) => conf,
  };
  const response = await smtp.triggerBatch([
    {
      id: '31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816',
      name: 'homeassistant',
      watcher: 'local',
      includeTags: '^\\d+\\.\\d+.\\d+$',
      image: {
        id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
        registry: {
          url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
        },
        name: 'test',
        tag: {
          value: '2021.6.4',
          semver: true,
        },
        digest: {
          watch: false,
          repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
        },
        architecture: 'amd64',
        os: 'linux',
        created: '2021-06-12T05:33:38.440Z',
      },
      result: {
        link: 'https://test-2.0.0/changelog',
      },
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    },
    {
      id: '31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816',
      name: 'homeassistant',
      watcher: 'local',
      includeTags: '^\\d+\\.\\d+.\\d+$',
      image: {
        id: 'sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6',
        registry: {
          url: '123456789.dkr.ecr.eu-west-1.amazonaws.com',
        },
        name: 'test',
        tag: {
          value: '2021.6.4',
          semver: true,
        },
        digest: {
          watch: false,
          repo: 'sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72',
        },
        architecture: 'amd64',
        os: 'linux',
        created: '2021-06-12T05:33:38.440Z',
      },
      result: {
        link: 'https://test-2.0.0/changelog',
      },
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    },
  ]);
  expect(response.text).toEqual(
    '- Container homeassistant running with tag 1.0.0 can be updated to tag 2.0.0\nhttps://test-2.0.0/changelog\n\n- Container homeassistant running with tag 1.0.0 can be updated to tag 2.0.0\nhttps://test-2.0.0/changelog\n',
  );
});

test('triggerBatch should include watcher context for same container names on different watchers', async () => {
  smtp.configuration = configurationValid;
  smtp.transporter = {
    sendMail: (conf) => conf,
  };

  const response = await smtp.triggerBatch([
    {
      id: 'container-1',
      name: 'docker-socket-proxy',
      watcher: 'servicevault',
      image: {
        id: 'sha256:image-1',
        registry: {
          url: 'docker://servicevault',
        },
        name: 'socket-proxy',
        tag: {
          value: 'latest',
          semver: false,
        },
        digest: {
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
      },
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:old-1',
        remoteValue: 'sha256:new-1',
      },
    },
    {
      id: 'container-2',
      name: 'docker-socket-proxy',
      watcher: 'mediavault',
      image: {
        id: 'sha256:image-2',
        registry: {
          url: 'docker://mediavault',
        },
        name: 'socket-proxy',
        tag: {
          value: 'latest',
          semver: false,
        },
        digest: {
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
      },
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:old-2',
        remoteValue: 'sha256:new-2',
      },
    },
  ] as any);

  expect(response.text).toBe(
    '- Container docker-socket-proxy (servicevault) running tag latest has a newer image available\n' +
      '\n' +
      '- Container docker-socket-proxy (mediavault) running tag latest has a newer image available\n',
  );
});

test('triggerBatch should use event-specific wording for update-applied notifications', async () => {
  smtp.configuration = configurationValid;
  smtp.transporter = {
    sendMail: (conf) => conf,
  };

  const response = await smtp.triggerBatch([
    {
      id: 'container-1',
      name: 'homeassistant',
      watcher: 'local',
      image: {
        id: 'sha256:image',
        registry: {
          url: 'docker://local',
        },
        name: 'test',
        tag: {
          value: '2021.6.4',
          semver: true,
        },
        digest: {
          watch: false,
        },
        architecture: 'amd64',
        os: 'linux',
      },
      updateKind: {
        kind: 'tag',
      },
      notificationEvent: {
        kind: 'update-applied',
      },
    },
  ] as any);

  expect(response.subject).toBe('1 updates applied');
  expect(response.text).toBe('- Container homeassistant updated successfully\n');
});
