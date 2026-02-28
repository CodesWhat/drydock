// @ts-nocheck
import joi from 'joi';
import * as event from '../../event/index.js';
import log from '../../log/index.js';
import * as notificationStore from '../../store/notification.js';
import * as storeContainer from '../../store/container.js';
import Trigger from './Trigger.js';

vi.mock('../../log');
vi.mock('../../event');
vi.mock('../../store/notification.js', () => ({
  isTriggerEnabledForRule: vi.fn(() => true),
}));
vi.mock('../../store/container.js', () => ({
  getContainers: vi.fn(() => []),
}));
vi.mock('../../prometheus/trigger', () => ({
  getTriggerCounter: () => ({
    inc: () => ({}),
  }),
}));

let trigger;

const configurationValid = {
  threshold: 'all',
  once: true,
  mode: 'simple',
  auto: true,
  order: 100,
  simpletitle: 'New ${container.updateKind.kind} found for container ${container.name}',

  simplebody:
    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

  batchtitle: '${containers.length} updates available',
  resolvenotifications: false,
};

beforeEach(async () => {
  vi.resetAllMocks();
  notificationStore.isTriggerEnabledForRule.mockReturnValue(true);
  storeContainer.getContainers.mockReturnValue([]);
  trigger = new Trigger();
  trigger.log = log;
  trigger.configuration = { ...configurationValid };
});

test('validateConfiguration should return validated configuration when valid', async () => {
  const validatedConfiguration = trigger.validateConfiguration(configurationValid);
  expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should accept digest and non-digest thresholds', async () => {
  expect(
    trigger.validateConfiguration({
      ...configurationValid,
      threshold: 'digest',
    }).threshold,
  ).toStrictEqual('digest');
  expect(
    trigger.validateConfiguration({
      ...configurationValid,
      threshold: 'patch-no-digest',
    }).threshold,
  ).toStrictEqual('patch-no-digest');
});

test('validateConfiguration should throw error when invalid', async () => {
  const configuration = {
    url: 'git://xxx.com',
  };
  expect(() => {
    trigger.validateConfiguration(configuration);
  }).toThrowError(joi.ValidationError);
});

test('init should register to container report when simple mode enabled', async () => {
  const spy = vi.spyOn(event, 'registerContainerReport');
  await trigger.init();
  expect(spy).toHaveBeenCalled();
});

test('init should register to container reports when batch mode enabled', async () => {
  const spy = vi.spyOn(event, 'registerContainerReports');
  trigger.configuration.mode = 'batch';
  await trigger.init();
  expect(spy).toHaveBeenCalled();
});

test('init should register handlers with trigger id and order', async () => {
  const spy = vi.spyOn(event, 'registerContainerReport');
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.configuration.order = 42;
  await trigger.init();
  expect(spy).toHaveBeenCalledWith(expect.any(Function), {
    id: 'docker.update',
    order: 42,
  });
});

test('deregister should unregister container report handler', async () => {
  const unregisterHandler = vi.fn();
  vi.spyOn(event, 'registerContainerReport').mockReturnValue(unregisterHandler);

  await trigger.init();
  await trigger.deregister();

  expect(unregisterHandler).toHaveBeenCalled();
});

const handleContainerReportTestCases = [
  {
    shouldTrigger: true,
    threshold: 'all',
    once: true,
    changed: true,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: true,
    threshold: 'all',
    once: false,
    changed: false,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: true,
    changed: true,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: false,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: true,
    updateAvailable: false,
    semverDiff: 'major',
  },
];

test.each(
  handleContainerReportTestCases,
)('handleContainerReport should call trigger? ($shouldTrigger) when changed=$changed and updateAvailable=$updateAvailable and threshold=$threshold', async (item) => {
  trigger.configuration = {
    threshold: item.threshold,
    once: item.once,
    mode: 'simple',
  };
  await trigger.init();

  const spy = vi.spyOn(trigger, 'trigger');
  await trigger.handleContainerReport({
    changed: item.changed,
    container: {
      name: 'container1',
      updateAvailable: item.updateAvailable,
      updateKind: {
        kind: 'tag',
        semverDiff: item.semverDiff,
      },
    },
  });
  if (item.shouldTrigger) {
    expect(spy).toHaveBeenCalledWith({
      name: 'container1',
      updateAvailable: item.updateAvailable,
      updateKind: {
        kind: 'tag',
        semverDiff: item.semverDiff,
      },
    });
  } else {
    expect(spy).not.toHaveBeenCalled();
  }
});

test('handleContainerReport should warn when trigger method of the trigger fails', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.trigger = () => {
    throw new Error('Fail!!!');
  };
  await trigger.init();
  const spyLog = vi.spyOn(log, 'warn');
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
    },
  });
  expect(spyLog).toHaveBeenCalledWith('Error (Fail!!!)');
});

const handleContainerReportsTestCases = [
  {
    shouldTrigger: true,
    threshold: 'all',
    once: true,
    changed: true,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: true,
    threshold: 'all',
    once: false,
    changed: false,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: true,
    changed: true,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: false,
    updateAvailable: true,
    semverDiff: 'major',
  },
  {
    shouldTrigger: false,
    threshold: 'minor',
    once: false,
    changed: true,
    updateAvailable: false,
    semverDiff: 'major',
  },
];

test.each(
  handleContainerReportsTestCases,
)('handleContainerReports should call triggerBatch? ($shouldTrigger) when changed=$changed and updateAvailable=$updateAvailable and threshold=$threshold', async (item) => {
  trigger.configuration = {
    threshold: item.threshold,
    once: item.once,
    mode: 'simple',
  };
  await trigger.init();

  const spy = vi.spyOn(trigger, 'triggerBatch');
  await trigger.handleContainerReports([
    {
      changed: item.changed,
      container: {
        name: 'container1',
        updateAvailable: item.updateAvailable,
        updateKind: {
          kind: 'tag',
          semverDiff: item.semverDiff,
        },
      },
    },
  ]);
  if (item.shouldTrigger) {
    expect(spy).toHaveBeenCalledWith([
      {
        name: 'container1',
        updateAvailable: item.updateAvailable,
        updateKind: {
          kind: 'tag',
          semverDiff: item.semverDiff,
        },
      },
    ]);
  } else {
    expect(spy).not.toHaveBeenCalled();
  }
});

const isThresholdReachedTestCases = [
  {
    result: true,
    threshold: 'all',
    change: undefined,
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'major',
    change: 'major',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'major',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'major',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'minor',
    change: 'major',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'minor',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'minor',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch',
    change: 'major',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'patch',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'all',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'major',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'minor',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'patch',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'digest',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: false,
    threshold: 'digest',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch-no-digest',
    change: 'unknown',
    kind: 'digest',
  },
  {
    result: true,
    threshold: 'patch-no-digest',
    change: 'patch',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'patch-no-digest',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: true,
    threshold: 'minor-only-no-digest',
    change: 'minor',
    kind: 'tag',
  },
  {
    result: false,
    threshold: 'minor-only-no-digest',
    change: 'major',
    kind: 'tag',
  },
];

test.each(
  isThresholdReachedTestCases,
)('isThresholdReached should return $result when threshold is $threshold and change is $change', (item) => {
  trigger.configuration = {
    threshold: item.threshold,
  };
  expect(
    Trigger.isThresholdReached(
      {
        updateKind: {
          kind: item.kind,
          semverDiff: item.change,
        },
      },
      trigger.configuration.threshold,
    ),
  ).toEqual(item.result);
});

test('isThresholdReached should return true when there is no semverDiff regardless of the threshold', async () => {
  trigger.configuration = {
    threshold: 'all',
  };
  expect(
    Trigger.isThresholdReached(
      {
        updateKind: { kind: 'digest' },
      },
      trigger.configuration.threshold,
    ),
  ).toBeTruthy();
});

test('parseIncludeOrIncludeTriggerString should parse digest thresholds', async () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:digest')).toStrictEqual({
    id: 'docker.local',
    threshold: 'digest',
  });
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:patch-no-digest')).toStrictEqual({
    id: 'docker.local',
    threshold: 'patch-no-digest',
  });
});

test('parseIncludeOrIncludeTriggerString should trim spaces around id and threshold', () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('  docker.local : DIGEST  ')).toStrictEqual({
    id: 'docker.local',
    threshold: 'digest',
  });
});

test('parseIncludeOrIncludeTriggerString should ignore threshold when multiple separators are present', () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:digest:extra')).toStrictEqual({
    id: 'docker.local',
    threshold: 'all',
  });
});

test('parseIncludeOrIncludeTriggerString should fallback to all for unsupported threshold', () => {
  expect(Trigger.parseIncludeOrIncludeTriggerString('docker.local:not-supported')).toStrictEqual({
    id: 'docker.local',
    threshold: 'all',
  });
});

test('doesReferenceMatchId should match full trigger id and trigger name', async () => {
  expect(Trigger.doesReferenceMatchId('docker.update', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('update', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('notify', 'docker.update')).toBe(false);
});

test('doesReferenceMatchId should return false for trigger ids without provider segment', () => {
  expect(Trigger.doesReferenceMatchId('docker.update', 'update')).toBe(false);
});

test('mustTrigger should accept trigger name-only include filters', async () => {
  trigger.type = 'docker';
  trigger.name = 'update';

  expect(
    trigger.mustTrigger({
      triggerInclude: 'update:minor',
      updateKind: {
        kind: 'tag',
        semverDiff: 'minor',
      },
    }),
  ).toBe(true);
});

test('mustTrigger should accept trigger name-only exclude filters', async () => {
  trigger.type = 'docker';
  trigger.name = 'update';

  expect(
    trigger.mustTrigger({
      triggerExclude: 'update',
      updateKind: {
        kind: 'tag',
        semverDiff: 'patch',
      },
    }),
  ).toBe(false);
});

// --- Hybrid Triggers: name-only matching for include/exclude ---

test('doesReferenceMatchId should match name-only against multiple trigger types', async () => {
  // "update" should match "docker.update", "discord.update", etc.
  expect(Trigger.doesReferenceMatchId('update', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('update', 'discord.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('update', 'slack.update')).toBe(true);
  // But not a different name
  expect(Trigger.doesReferenceMatchId('update', 'docker.notify')).toBe(false);
});

test('doesReferenceMatchId should be case-insensitive', async () => {
  expect(Trigger.doesReferenceMatchId('UPDATE', 'docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('Docker.Update', 'docker.update')).toBe(true);
});

test('mustTrigger should exclude multiple trigger types by name-only', async () => {
  // When a container has triggerExclude='update', ALL triggers named 'update'
  // should be excluded regardless of provider type
  const dockerTrigger = new Trigger();
  dockerTrigger.log = log;
  dockerTrigger.configuration = { ...configurationValid };
  dockerTrigger.type = 'docker';
  dockerTrigger.name = 'update';

  const discordTrigger = new Trigger();
  discordTrigger.log = log;
  discordTrigger.configuration = { ...configurationValid };
  discordTrigger.type = 'discord';
  discordTrigger.name = 'update';

  const container = {
    triggerExclude: 'update',
    updateKind: { kind: 'tag', semverDiff: 'minor' },
  };

  // Both docker.update and discord.update should be excluded by 'update'
  expect(dockerTrigger.mustTrigger(container)).toBe(false);
  expect(discordTrigger.mustTrigger(container)).toBe(false);
});

test('mustTrigger should include multiple trigger types by name-only', async () => {
  const dockerTrigger = new Trigger();
  dockerTrigger.log = log;
  dockerTrigger.configuration = { ...configurationValid };
  dockerTrigger.type = 'docker';
  dockerTrigger.name = 'update';

  const discordTrigger = new Trigger();
  discordTrigger.log = log;
  discordTrigger.configuration = { ...configurationValid };
  discordTrigger.type = 'discord';
  discordTrigger.name = 'update';

  const slackNotify = new Trigger();
  slackNotify.log = log;
  slackNotify.configuration = { ...configurationValid };
  slackNotify.type = 'slack';
  slackNotify.name = 'notify';

  const container = {
    triggerInclude: 'update:minor',
    updateKind: { kind: 'tag', semverDiff: 'minor' },
  };

  // Both docker.update and discord.update should be included
  expect(dockerTrigger.mustTrigger(container)).toBe(true);
  expect(discordTrigger.mustTrigger(container)).toBe(true);
  // But slack.notify should NOT be included (different name)
  expect(slackNotify.mustTrigger(container)).toBe(false);
});

test('mustTrigger should support name-only include with threshold for hybrid triggers', async () => {
  const dockerTrigger = new Trigger();
  dockerTrigger.log = log;
  dockerTrigger.configuration = { ...configurationValid };
  dockerTrigger.type = 'docker';
  dockerTrigger.name = 'update';

  const discordTrigger = new Trigger();
  discordTrigger.log = log;
  discordTrigger.configuration = { ...configurationValid };
  discordTrigger.type = 'discord';
  discordTrigger.name = 'update';

  // Include 'update' triggers only for minor (excludes major)
  const containerMinor = {
    triggerInclude: 'update:minor',
    updateKind: { kind: 'tag', semverDiff: 'minor' },
  };
  const containerMajor = {
    triggerInclude: 'update:minor',
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };

  expect(dockerTrigger.mustTrigger(containerMinor)).toBe(true);
  expect(discordTrigger.mustTrigger(containerMinor)).toBe(true);
  // Major should be excluded because threshold is 'minor'
  expect(dockerTrigger.mustTrigger(containerMajor)).toBe(false);
  expect(discordTrigger.mustTrigger(containerMajor)).toBe(false);
});

test('renderSimpleTitle should replace placeholders when called', async () => {
  expect(
    trigger.renderSimpleTitle({
      name: 'container-name',
      updateKind: {
        kind: 'tag',
      },
    }),
  ).toEqual('New tag found for container container-name');
});

test('renderSimpleBody should replace placeholders when called', async () => {
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      updateKind: {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
      result: {
        link: 'http://test',
      },
    }),
  ).toEqual(
    'Container container-name running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test',
  );
});

test('renderSimpleBody should replace placeholders when template is a customized one', async () => {
  trigger.configuration.simplebody =
    'Watcher ${watcher} reports container ${name} available update';
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      watcher: 'DUMMY',
    }),
  ).toEqual('Watcher DUMMY reports container container-name available update');
});

test('renderSimpleBody should evaluate js functions when template is a customized one', async () => {
  trigger.configuration.simplebody =
    'Container ${name} update from ${local.substring(0, 15)} to ${remote.substring(0, 15)}';
  expect(
    trigger.renderSimpleBody({
      name: 'container-name',
      updateKind: {
        kind: 'digest',
        localValue: 'sha256:9a82d5773ccfcb73ba341619fd44790a30750731568c25a6e070c2c44aa30bde',
        remoteValue: 'sha256:6cdd479147e4d2f1f853c7205ead7e2a0b0ccbad6e3ff0986e01936cbd179c17',
      },
    }),
  ).toEqual('Container container-name update from sha256:9a82d577 to sha256:6cdd4791');
});

test('renderBatchTitle should replace placeholders when called', async () => {
  expect(
    trigger.renderBatchTitle([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
        },
      },
    ]),
  ).toEqual('1 updates available');
});

test('renderBatchBody should replace placeholders when called', async () => {
  expect(
    trigger.renderBatchBody([
      {
        name: 'container-name',
        updateKind: {
          kind: 'tag',
          localValue: '1.0.0',
          remoteValue: '2.0.0',
        },
        result: {
          link: 'http://test',
        },
      },
    ]),
  ).toEqual(
    '- Container container-name running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test\n',
  );
});

test('init should invoke registered simple callback when handleContainerReport is called', async () => {
  let capturedCallback;
  vi.spyOn(event, 'registerContainerReport').mockImplementation((cb) => {
    capturedCallback = cb;
    return vi.fn();
  });
  trigger.configuration.mode = 'simple';
  trigger.configuration.auto = true;
  trigger.configuration.threshold = 'all';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'trigger').mockResolvedValue();
  await capturedCallback({
    changed: true,
    container: {
      name: 'c1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(spy).toHaveBeenCalled();
});

test('init should invoke registered batch callback when handleContainerReports is called', async () => {
  let capturedCallback;
  vi.spyOn(event, 'registerContainerReports').mockImplementation((cb) => {
    capturedCallback = cb;
    return vi.fn();
  });
  trigger.configuration.mode = 'batch';
  trigger.configuration.auto = true;
  trigger.configuration.threshold = 'all';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue();
  await capturedCallback([
    {
      changed: true,
      container: {
        name: 'c1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);
  expect(spy).toHaveBeenCalled();
});

test('deregister should unregister batch container reports handler', async () => {
  const unregisterHandler = vi.fn();
  vi.spyOn(event, 'registerContainerReports').mockReturnValue(unregisterHandler);
  trigger.configuration.mode = 'batch';
  trigger.configuration.auto = true;
  await trigger.init();
  await trigger.deregister();
  expect(unregisterHandler).toHaveBeenCalled();
});

test('init should log manual execution when auto is false', async () => {
  trigger.configuration.auto = false;
  const spyLog = vi.spyOn(log, 'info');
  await trigger.init();
  expect(spyLog).toHaveBeenCalledWith('Registering for manual execution');
});

test('init should register for notification resolution when resolvenotifications is true', async () => {
  const unregisterFn = vi.fn();
  vi.spyOn(event, 'registerContainerReport').mockReturnValue(vi.fn());
  const registerSpy = vi.fn().mockReturnValue(unregisterFn);
  // We need to mock registerContainerUpdateApplied from event/index
  const eventModule = await import('../../event/index.js');
  vi.spyOn(eventModule, 'registerContainerUpdateApplied').mockImplementation(registerSpy);

  trigger.configuration.resolvenotifications = true;
  trigger.configuration.auto = true;
  trigger.configuration.mode = 'simple';
  const spyLog = vi.spyOn(log, 'info');
  await trigger.init();
  expect(spyLog).toHaveBeenCalledWith('Registering for notification resolution');
  expect(registerSpy).toHaveBeenCalled();
});

test('deregister should unregister containerUpdateApplied handler when resolvenotifications was true', async () => {
  const unregisterUpdateApplied = vi.fn();
  trigger.unregisterContainerUpdateAppliedForResolution = unregisterUpdateApplied;
  await trigger.deregister();
  expect(unregisterUpdateApplied).toHaveBeenCalled();
});

test('handleContainerUpdateApplied should call dismiss for stored notification', async () => {
  const mockResult = { messageId: '123' };
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('docker.local/nginx', mockResult);
  trigger.dismiss = vi.fn().mockResolvedValue(undefined);
  const spyLog = vi.spyOn(log, 'info');

  await trigger.handleContainerUpdateApplied('docker.local/nginx');

  expect(trigger.dismiss).toHaveBeenCalledWith('docker.local/nginx', mockResult);
  expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('Dismissing notification'));
  expect(trigger.notificationResults.has('docker.local/nginx')).toBe(false);
});

test('handleContainerUpdateApplied should return early when no stored notification', async () => {
  trigger.notificationResults = new Map();
  trigger.dismiss = vi.fn();
  await trigger.handleContainerUpdateApplied('docker.local/unknown');
  expect(trigger.dismiss).not.toHaveBeenCalled();
});

test('handleContainerUpdateApplied should warn on dismiss error and still clean up', async () => {
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('docker.local/nginx', { id: '1' });
  trigger.dismiss = vi.fn().mockRejectedValue(new Error('dismiss failed'));
  const spyLog = vi.spyOn(log, 'warn');

  await trigger.handleContainerUpdateApplied('docker.local/nginx');

  expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('dismiss failed'));
  expect(trigger.notificationResults.has('docker.local/nginx')).toBe(false);
});

test('handleContainerReport should skip when update-available rule suppresses this trigger', async () => {
  notificationStore.isTriggerEnabledForRule.mockImplementation(
    (ruleId) => ruleId !== 'update-available',
  );
  const spy = vi.spyOn(trigger, 'trigger');

  await trigger.handleContainerReport({
    changed: true,
    container: {
      watcher: 'local',
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });

  expect(spy).not.toHaveBeenCalled();
});

test('handleContainerUpdateAppliedEvent should run trigger when rule allows and container is found', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');

  expect(triggerSpy).toHaveBeenCalledWith(container);
});

test('handleContainerUpdateAppliedEvent should skip when rule disables trigger dispatch', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  notificationStore.isTriggerEnabledForRule.mockImplementation(
    (ruleId) => ruleId !== 'update-applied',
  );
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateAppliedEvent should skip when container cannot be found', async () => {
  storeContainer.getContainers.mockReturnValue([]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_missing');

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateFailedEvent should run batch trigger when configured in batch mode', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  trigger.configuration.mode = 'batch';
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerBatchSpy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateFailedEvent({
    containerName: 'local_container1',
    error: 'boom',
  });

  expect(triggerBatchSpy).toHaveBeenCalledWith([container]);
});

test('handleContainerUpdateFailedEvent should skip when threshold is not reached', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  trigger.configuration.mode = 'simple';
  trigger.configuration.threshold = 'minor';
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateFailedEvent({
    containerName: 'local_container1',
    error: 'boom',
  });

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleContainerUpdateFailedEvent should skip when mustTrigger returns false', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    triggerExclude: 'update',
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  trigger.configuration.mode = 'simple';
  trigger.configuration.threshold = 'all';
  trigger.type = 'docker';
  trigger.name = 'update';
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateFailedEvent({
    containerName: 'local_container1',
    error: 'boom',
  });

  expect(triggerSpy).not.toHaveBeenCalled();
});

test('handleSecurityAlertEvent should dispatch using payload container when provided', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleSecurityAlertEvent({
    containerName: 'local_container1',
    details: 'high=1',
    container,
  });

  expect(triggerSpy).toHaveBeenCalledWith(container);
  expect(storeContainer.getContainers).not.toHaveBeenCalled();
});

test('handleSecurityAlertEvent should resolve container from store when payload container is missing', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleSecurityAlertEvent({
    containerName: 'local_container1',
    details: 'high=1',
  });

  expect(triggerSpy).toHaveBeenCalledWith(container);
});

test('handleSecurityAlertEvent should catch trigger execution errors', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  const warnSpy = vi.spyOn(log, 'warn');
  const debugSpy = vi.spyOn(log, 'debug');
  vi.spyOn(trigger, 'trigger').mockRejectedValue(new Error('dispatch failed'));

  await trigger.handleSecurityAlertEvent({
    containerName: 'local_container1',
    details: 'high=1',
    container,
  });

  expect(warnSpy).toHaveBeenCalledWith('Error handling security-alert event (dispatch failed)');
  expect(debugSpy).toHaveBeenCalledWith(expect.any(Error));
});

test('handleAgentDisconnectedEvent should bypass threshold filtering', async () => {
  trigger.configuration.threshold = 'major-only';
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleAgentDisconnectedEvent({
    agentName: 'edge-a',
    reason: 'disconnected',
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'edge-a',
      watcher: 'agent',
      status: 'disconnected',
    }),
  );
});

test('handleAgentDisconnectedEvent should use disconnected fallback values when reason is missing', async () => {
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleAgentDisconnectedEvent({
    agentName: 'edge-a',
  });

  expect(triggerSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      updateKind: expect.objectContaining({
        localValue: 'disconnected',
        remoteValue: 'disconnected',
      }),
      error: undefined,
    }),
  );
});

test('dispatchContainerForEvent should fallback to all threshold when threshold is undefined', async () => {
  const container = {
    watcher: 'local',
    name: 'container1',
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
  };
  trigger.configuration.threshold = undefined;
  storeContainer.getContainers.mockReturnValue([container]);
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerUpdateAppliedEvent('local_container1');

  expect(triggerSpy).toHaveBeenCalledWith(container);
});

test('handleContainerReports should skip when update-available rule disables trigger dispatch', async () => {
  notificationStore.isTriggerEnabledForRule.mockImplementation(
    (ruleId) => ruleId !== 'update-available',
  );
  const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'container1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);

  expect(spy).not.toHaveBeenCalled();
});

test('init should wire auto dispatch callbacks for update/security/agent events', async () => {
  let onUpdateApplied;
  let onUpdateFailed;
  let onSecurityAlert;
  let onAgentDisconnected;

  vi.spyOn(event, 'registerContainerUpdateApplied').mockImplementation((cb) => {
    onUpdateApplied = cb;
    return vi.fn();
  });
  vi.spyOn(event, 'registerContainerUpdateFailed').mockImplementation((cb) => {
    onUpdateFailed = cb;
    return vi.fn();
  });
  vi.spyOn(event, 'registerSecurityAlert').mockImplementation((cb) => {
    onSecurityAlert = cb;
    return vi.fn();
  });
  vi.spyOn(event, 'registerAgentDisconnected').mockImplementation((cb) => {
    onAgentDisconnected = cb;
    return vi.fn();
  });

  const updateAppliedSpy = vi
    .spyOn(trigger, 'handleContainerUpdateAppliedEvent')
    .mockResolvedValue(undefined);
  const updateFailedSpy = vi
    .spyOn(trigger, 'handleContainerUpdateFailedEvent')
    .mockResolvedValue(undefined);
  const securityAlertSpy = vi
    .spyOn(trigger, 'handleSecurityAlertEvent')
    .mockResolvedValue(undefined);
  const agentDisconnectedSpy = vi
    .spyOn(trigger, 'handleAgentDisconnectedEvent')
    .mockResolvedValue(undefined);

  trigger.configuration.auto = true;
  trigger.configuration.mode = 'simple';
  await trigger.init();

  await onUpdateApplied('container-a');
  await onUpdateFailed({ containerName: 'container-b', error: 'boom' });
  await onSecurityAlert({ containerName: 'container-c', details: 'high=1' });
  await onAgentDisconnected({ agentName: 'edge-a', reason: 'disconnected' });

  expect(updateAppliedSpy).toHaveBeenCalledWith('container-a');
  expect(updateFailedSpy).toHaveBeenCalledWith({
    containerName: 'container-b',
    error: 'boom',
  });
  expect(securityAlertSpy).toHaveBeenCalledWith({
    containerName: 'container-c',
    details: 'high=1',
  });
  expect(agentDisconnectedSpy).toHaveBeenCalledWith({
    agentName: 'edge-a',
    reason: 'disconnected',
  });
});

test('dismiss should be a no-op by default', async () => {
  await expect(trigger.dismiss('test', {})).resolves.toBeUndefined();
});

test('mustTrigger should return false when agent does not match', async () => {
  trigger.agent = 'remote-agent';
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(trigger.mustTrigger({ agent: 'local-agent' })).toBe(false);
});

test('mustTrigger should return false when strictAgentMatch and agent mismatch', async () => {
  trigger.strictAgentMatch = true;
  trigger.agent = undefined;
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(trigger.mustTrigger({ agent: 'remote-agent' })).toBe(false);
});

test('isTriggerIncludedOrExcluded should return false when trigger not found in list', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(
    trigger.isTriggerIncludedOrExcluded(
      { updateKind: { kind: 'tag', semverDiff: 'major' } },
      'slack.notify:major',
    ),
  ).toBe(false);
});

test('isTriggerIncludedOrExcluded should parse comma-separated trigger list with spaces', () => {
  trigger.type = 'docker';
  trigger.name = 'update';
  expect(
    trigger.isTriggerIncludedOrExcluded(
      { updateKind: { kind: 'tag', semverDiff: 'minor' } },
      '  , slack.notify:major, docker.update : minor , ',
    ),
  ).toBe(true);
});

test('handleContainerReport should store result when resolvenotifications is enabled', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
    resolvenotifications: true,
  };
  trigger.notificationResults = new Map();
  const mockResult = { messageId: '456' };
  trigger.trigger = vi.fn().mockResolvedValue(mockResult);
  await trigger.init();
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      watcher: 'local',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(trigger.notificationResults.size).toBe(1);
});

test('doesReferenceMatchId should match provider.name against 3-part trigger id', () => {
  // When triggerId is 'prefix.docker.update', reference 'docker.update' should match
  expect(Trigger.doesReferenceMatchId('docker.update', 'prefix.docker.update')).toBe(true);
});

test('handleContainerReport should log when mustTrigger returns false', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.agent = 'remote-agent';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'trigger');
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      agent: 'local-agent',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(spy).not.toHaveBeenCalled();
});

test('isThresholdReached should return true for major-only when semverDiff is major', () => {
  expect(
    Trigger.isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'major' } }, 'major-only'),
  ).toBe(true);
});

test('isThresholdReached should return false for major-only when semverDiff is minor', () => {
  expect(
    Trigger.isThresholdReached({ updateKind: { kind: 'tag', semverDiff: 'minor' } }, 'major-only'),
  ).toBe(false);
});

test('doesReferenceMatchId should match provider.name when trigger id has 3+ parts', () => {
  // Trigger id: scope.docker.update -> provider.name = "docker.update"
  expect(Trigger.doesReferenceMatchId('docker.update', 'scope.docker.update')).toBe(true);
  expect(Trigger.doesReferenceMatchId('slack.notify', 'scope.docker.update')).toBe(false);
});

test('handleContainerReport should debug log when mustTrigger returns false', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'simple',
  };
  trigger.type = 'docker';
  trigger.name = 'update';
  await trigger.init();
  const spy = vi.spyOn(trigger, 'trigger');
  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
      triggerExclude: 'update',
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });
  expect(spy).not.toHaveBeenCalled();
});

test('handleContainerReport should fallback to parent logger when child logger is unavailable', async () => {
  trigger.configuration = {
    threshold: undefined,
    mode: 'simple',
    once: true,
  };
  trigger.type = 'docker';
  trigger.name = 'update';
  trigger.log = {
    ...log,
    child: vi.fn().mockReturnValue(undefined),
  };
  const triggerSpy = vi.spyOn(trigger, 'trigger').mockResolvedValue(undefined);

  await trigger.handleContainerReport({
    changed: true,
    container: {
      name: 'container1',
      updateAvailable: true,
      updateKind: { kind: 'tag', semverDiff: 'major' },
    },
  });

  expect(triggerSpy).toHaveBeenCalled();
});

test('handleContainerReports should fallback to all threshold when configuration threshold is empty', async () => {
  trigger.configuration = {
    threshold: '',
    once: true,
    mode: 'batch',
  };
  const spy = vi.spyOn(trigger, 'triggerBatch').mockResolvedValue(undefined);

  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'container1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);

  expect(spy).toHaveBeenCalledTimes(1);
});

test('init with resolvenotifications should invoke handleContainerUpdateApplied callback', async () => {
  let capturedCallback;
  vi.spyOn(event, 'registerContainerReport').mockReturnValue(vi.fn());
  const eventModule = await import('../../event/index.js');
  vi.spyOn(eventModule, 'registerContainerUpdateApplied').mockImplementation((cb) => {
    capturedCallback = cb;
    return vi.fn();
  });
  trigger.configuration.resolvenotifications = true;
  trigger.configuration.auto = true;
  trigger.configuration.mode = 'simple';
  trigger.notificationResults = new Map();
  trigger.notificationResults.set('docker.local/nginx', { id: 'msg1' });
  trigger.dismiss = vi.fn().mockResolvedValue(undefined);

  await trigger.init();
  expect(capturedCallback).toBeDefined();

  await capturedCallback('docker.local/nginx');
  expect(trigger.dismiss).toHaveBeenCalledWith('docker.local/nginx', { id: 'msg1' });
});

test('renderSimpleBody should return empty for disallowed method calls', async () => {
  trigger.configuration.simplebody = 'Result: ${name.constructor()}';
  expect(trigger.renderSimpleBody({ name: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should return empty for method on unresolvable path', async () => {
  trigger.configuration.simplebody = 'Result: ${nonexistent.substring(0, 5)}';
  expect(trigger.renderSimpleBody({})).toBe('Result: ');
});

test('renderSimpleBody should return empty when method target has no such method', async () => {
  trigger.configuration.simplebody = 'Result: ${name.nonExistentMethod()}';
  expect(trigger.renderSimpleBody({ name: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should return empty for unsupported expression syntax', async () => {
  trigger.configuration.simplebody = 'Result: ${[1,2,3]}';
  expect(trigger.renderSimpleBody({})).toBe('Result: ');
});

test('renderSimpleBody should handle method call without closing paren', async () => {
  trigger.configuration.simplebody = 'Result: ${name.substring(0, 5}';
  expect(trigger.renderSimpleBody({ name: 'hello world' })).toBe('Result: ');
});

test('renderSimpleBody should handle method call with nested closing paren in args', async () => {
  trigger.configuration.simplebody = 'Result: ${name.substring(0, foo())}';
  expect(trigger.renderSimpleBody({ name: 'hello world' })).toBe('Result: ');
});

test('renderSimpleBody should handle method call with no dot before method', async () => {
  trigger.configuration.simplebody = 'Result: ${substring(0, 5)}';
  expect(trigger.renderSimpleBody({ substring: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should handle invalid property path with leading dot', async () => {
  trigger.configuration.simplebody = 'Result: ${.name}';
  expect(trigger.renderSimpleBody({ name: 'test' })).toBe('Result: ');
});

test('renderSimpleBody should handle empty segments in property path', async () => {
  trigger.configuration.simplebody = 'Result: ${name..value}';
  expect(trigger.renderSimpleBody({ name: { value: 'test' } })).toBe('Result: ');
});

test('renderSimpleBody should handle templates with single-quoted strings in expressions', async () => {
  trigger.configuration.simplebody = "Container ${name} status is ${'running'}";
  expect(
    trigger.renderSimpleBody({
      name: 'test-container',
    }),
  ).toContain('Container test-container');
});

test('handleContainerReports should warn when triggerBatch fails', async () => {
  trigger.configuration = {
    threshold: 'all',
    mode: 'batch',
  };
  trigger.triggerBatch = vi.fn().mockRejectedValue(new Error('batch fail'));
  await trigger.init();
  const spyLog = vi.spyOn(log, 'warn');
  await trigger.handleContainerReports([
    {
      changed: true,
      container: {
        name: 'c1',
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
      },
    },
  ]);
  expect(spyLog).toHaveBeenCalledWith('Error (batch fail)');
});

test('parseThresholdWithDigestBehavior should parse suffix behavior', () => {
  expect(Trigger.parseThresholdWithDigestBehavior(undefined)).toEqual({
    thresholdBase: 'all',
    nonDigestOnly: false,
  });
  expect(Trigger.parseThresholdWithDigestBehavior('minor-no-digest')).toEqual({
    thresholdBase: 'minor',
    nonDigestOnly: true,
  });
});

test('doesReferenceMatchId should return false when trigger id has no name segment', () => {
  expect(Trigger.doesReferenceMatchId('update', '')).toBe(false);
});

test('preview should return an empty object by default', async () => {
  await expect(trigger.preview({})).resolves.toEqual({});
});

test('maskFields should mask non-empty configured values', () => {
  trigger.configuration = {
    token: 'super-secret',
    empty: '',
  };
  const masked = trigger.maskFields(['token', 'empty']);
  expect(masked.token).toBe('s**********t');
  expect(masked.empty).toBe('');
});
