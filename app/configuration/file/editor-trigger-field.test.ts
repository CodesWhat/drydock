import yaml from 'yaml';
import { configFileInterpolatedKeys, configFileSources, ddEnvVars } from '../index.js';
import { triggerFieldDescriptor as describeField } from './editor-trigger-field.js';
import { resetConfigFileLayer } from './layer.js';

const { state } = vi.hoisted(() => ({ state: { trigger: {} } }));
vi.mock('../../registry/index.js', () => ({ getState: () => state }));

describe('trigger field descriptors', () => {
  let sources: typeof configFileSources;
  let previous: typeof ddEnvVars;
  let interpolated: Set<string>;
  beforeEach(() => {
    sources = { ...configFileSources };
    previous = { ...ddEnvVars };
    interpolated = new Set(configFileInterpolatedKeys);
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    configFileInterpolatedKeys.clear();
    state.trigger = {};
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of Object.keys(configFileSources)) delete configFileSources[key];
    for (const key of Object.keys(ddEnvVars)) delete ddEnvVars[key];
    Object.assign(configFileSources, sources);
    Object.assign(ddEnvVars, previous);
    configFileInterpolatedKeys.clear();
    for (const key of interpolated) configFileInterpolatedKeys.add(key);
    resetConfigFileLayer();
  });

  function context(raw = 'notification:\n  discord:\n    private:\n      threshold: all\n') {
    const document = {
      path: '/unused/drydock.yml',
      raw,
      doc: yaml.parseDocument(raw),
      revision: 'test-revision',
    };
    return {
      document,
      category: 'notification' as 'action' | 'notification',
      trigger: {
        type: 'discord',
        name: 'private',
        configuration: { threshold: 'major' } as Record<string, unknown>,
      },
      field: 'threshold',
      node: document.doc.getIn(['notification', 'discord', 'private'], true),
      prefix: ['notification', 'discord', 'private'],
    };
  }

  test('retains the exact file path and distinct raw and effective values', () => {
    expect(describeField(context())).toEqual({
      present: true,
      source: 'file',
      path: ['notification', 'discord', 'private', 'threshold'],
      value: 'all',
      effectiveValue: 'major',
    });
  });

  test('reports an absent field as default with its writable path', () => {
    const input = context('notification:\n  discord:\n    private: {}\n');
    expect(describeField(input)).toEqual({
      present: false,
      source: 'default',
      path: [...input.prefix, 'threshold'],
      effectiveValue: 'major',
    });
  });

  test('an environment literal takes ownership ahead of a file reference', () => {
    const input = context(
      'notification:\n  discord:\n    private:\n      threshold: ${PRIVATE_VALUE}\n',
    );
    vi.stubEnv('DD_NOTIFICATION_DISCORD_PRIVATE_THRESHOLD', 'major');
    expect(describeField(input)).toEqual({
      present: true,
      source: 'env',
      readOnlyReason: 'environment-owned',
      value: '${PRIVATE_VALUE}',
      effectiveValue: 'major',
    });
  });

  test('references hide both values even when the resolved value is scalar', () => {
    expect(
      describeField(
        context('notification:\n  discord:\n    private:\n      threshold: ${PRIVATE_VALUE}\n'),
      ),
    ).toEqual({ present: true, source: 'reference', readOnlyReason: 'referenced-field' });
  });

  test('file unavailability takes precedence over an agent and provider restrictions', () => {
    const input = context();
    expect(
      describeField({
        ...input,
        document: undefined,
        node: undefined,
        prefix: undefined,
        trigger: { ...input.trigger, type: 'mqtt', agent: 'edge' },
        field: 'mode',
      }),
    ).toEqual({
      present: false,
      source: 'default',
      readOnlyReason: 'configuration-file-unavailable',
    });
  });

  test('agent fields omit raw and effective values', () => {
    const input = context();
    expect(describeField({ ...input, trigger: { ...input.trigger, agent: 'edge' } })).toEqual({
      present: true,
      source: 'file',
      readOnlyReason: 'agent-trigger',
    });
  });

  test('ambiguous aliases omit values and paths before environment ownership is considered', () => {
    vi.stubEnv('DD_NOTIFICATION_DISCORD_PRIVATE_THRESHOLD', 'major');
    const input = context(
      'notification:\n  discord:\n    private:\n      threshold: all\n      THRESHOLD: major\n',
    );
    expect(describeField(input)).toEqual({
      present: true,
      source: 'env',
      readOnlyReason: 'ambiguous-field-alias',
    });
  });

  test.each([
    ['mode', 'simple', 'provider-forced'],
    ['securitydigesttitle', '${scan.alertCount} alerts', 'provider-unsupported'],
    ['threshold', 'all', undefined],
  ])('applies the MQTT %s field restriction', (field, value, readOnlyReason) => {
    const input = context(
      yaml.stringify({ notification: { mqtt: { private: { [field]: value } } } }),
    );
    input.trigger = { type: 'mqtt', name: 'private', configuration: { [field]: value } };
    input.prefix = ['notification', 'mqtt', 'private'];
    input.node = input.document.doc.getIn(input.prefix, true);
    input.field = field;
    expect(describeField(input)).toEqual({
      present: true,
      source: 'file',
      ...(readOnlyReason ? { readOnlyReason } : { path: [...input.prefix, field] }),
      value,
      effectiveValue: value,
    });
  });

  test.each([false, 0, '', 3, 'major'])(
    'retains scalar value %j without truthiness coercion',
    (value) => {
      const input = context(
        yaml.stringify({ notification: { discord: { private: { threshold: value } } } }),
      );
      input.trigger.configuration.threshold = value;
      expect(describeField(input)).toMatchObject({ value, effectiveValue: value });
    },
  );

  test('does not expose non-scalar or non-finite effective values', () => {
    const input = context();
    for (const value of [null, undefined, [], {}, Infinity, NaN]) {
      input.trigger.configuration.threshold = value;
      expect(describeField(input)).toEqual({
        present: true,
        source: 'file',
        path: [...input.prefix, 'threshold'],
        value: 'all',
      });
    }
  });
});
