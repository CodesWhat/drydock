import {
  buildHassReleaseSummary,
  getHassButtonCommandTopic,
  getHassButtonCommandTopicFilters,
  getHassButtonResultTopic,
  getHassCommandTopicFilters,
  getHassCommandTopicFromStateTopic,
  getStateTopicFromCommandTopic,
  isHassButtonPressPayload,
  isHassInstallPayload,
  parseHassButtonCommandTopic,
  resolveHassCommandContainer,
} from './hass-commands.js';

describe('getHassCommandTopicFilters', () => {
  test('returns both fixed-depth filter patterns as exact strings', () => {
    expect(getHassCommandTopicFilters('dd/container')).toEqual([
      'dd/container/+/+/cmd',
      'dd/container/agent/+/+/+/cmd',
    ]);
  });

  test('reflects a different base topic verbatim', () => {
    expect(getHassCommandTopicFilters('topic')).toEqual(['topic/+/+/cmd', 'topic/agent/+/+/+/cmd']);
  });
});

describe('getHassCommandTopicFromStateTopic', () => {
  test('appends the /cmd suffix to a state topic', () => {
    expect(getHassCommandTopicFromStateTopic('dd/container/local/nginx')).toBe(
      'dd/container/local/nginx/cmd',
    );
  });

  test('appends the /cmd suffix to an agent-segmented state topic', () => {
    expect(getHassCommandTopicFromStateTopic('dd/container/agent/ml/local/nginx')).toBe(
      'dd/container/agent/ml/local/nginx/cmd',
    );
  });
});

describe('isHassInstallPayload', () => {
  test('returns true for the exact install payload as a string', () => {
    expect(isHassInstallPayload('install')).toBe(true);
  });

  test('returns true for the exact install payload as a Buffer', () => {
    expect(isHassInstallPayload(Buffer.from('install'))).toBe(true);
  });

  test.each(['update', '', 'INSTALL', 'installer'])(
    'returns false for a non-matching payload %j',
    (payload) => {
      expect(isHassInstallPayload(payload)).toBe(false);
    },
  );

  test('trims surrounding whitespace/newlines before comparing', () => {
    expect(isHassInstallPayload('  install\n')).toBe(true);
    expect(isHassInstallPayload(Buffer.from('\ninstall  '))).toBe(true);
  });
});

describe('getStateTopicFromCommandTopic', () => {
  test('strips the /cmd suffix from a valid command topic under the base topic', () => {
    expect(getStateTopicFromCommandTopic('dd/container/local/nginx/cmd', 'dd/container')).toBe(
      'dd/container/local/nginx',
    );
  });

  test('returns undefined when the topic is not under the base topic', () => {
    expect(getStateTopicFromCommandTopic('other/local/nginx/cmd', 'dd/container')).toBeUndefined();
  });

  test('returns undefined when the topic is missing the trailing /cmd', () => {
    expect(
      getStateTopicFromCommandTopic('dd/container/local/nginx', 'dd/container'),
    ).toBeUndefined();
  });

  test('strips correctly for a container literally named "cmd"', () => {
    // State topic dd/container/local/cmd -> command topic dd/container/local/cmd/cmd
    expect(getStateTopicFromCommandTopic('dd/container/local/cmd/cmd', 'dd/container')).toBe(
      'dd/container/local/cmd',
    );
  });
});

describe('resolveHassCommandContainer', () => {
  const getStateTopicForContainer = (container: { topic: string }) => container.topic;

  test('returns not-found when zero candidates match', () => {
    const resolution = resolveHassCommandContainer(
      [{ topic: 'a' }, { topic: 'b' }],
      'z',
      getStateTopicForContainer,
    );
    expect(resolution).toEqual({ status: 'not-found' });
  });

  test('returns found with the single matching candidate', () => {
    const match = { topic: 'a' };
    const resolution = resolveHassCommandContainer(
      [{ topic: 'other' }, match],
      'a',
      getStateTopicForContainer,
    );
    expect(resolution).toEqual({ status: 'found', container: match });
  });

  test('excludes candidates whose computed topic differs', () => {
    const resolution = resolveHassCommandContainer(
      [{ topic: 'x' }, { topic: 'y' }],
      'z',
      getStateTopicForContainer,
    );
    expect(resolution.status).toBe('not-found');
  });

  test('returns ambiguous with both candidates when two computed topics collide', () => {
    const matchA = { topic: 'a', id: 'first' };
    const matchB = { topic: 'a', id: 'second' };
    const resolution = resolveHassCommandContainer(
      [matchA, matchB],
      'a',
      getStateTopicForContainer,
    );
    expect(resolution).toEqual({ status: 'ambiguous', containers: [matchA, matchB] });
  });
});

describe('hass button topics', () => {
  test('filters are fixed-depth and cannot match the install filters', () => {
    expect(getHassButtonCommandTopicFilters('dd/container')).toEqual([
      'dd/container/+/+/cmd/+',
      'dd/container/agent/+/+/+/cmd/+',
    ]);
  });

  test('command and result topics hang off the state topic', () => {
    expect(getHassButtonCommandTopic('dd/container/local/nginx', 'check')).toBe(
      'dd/container/local/nginx/cmd/check',
    );
    expect(getHassButtonResultTopic('dd/container/local/nginx', 'update')).toBe(
      'dd/container/local/nginx/cmd/update/result',
    );
  });

  test('isHassButtonPressPayload accepts PRESS (string or Buffer, trimmed) only', () => {
    expect(isHassButtonPressPayload('PRESS')).toBe(true);
    expect(isHassButtonPressPayload(Buffer.from(' PRESS\n'))).toBe(true);
    expect(isHassButtonPressPayload('press')).toBe(false);
    expect(isHassButtonPressPayload('')).toBe(false);
  });

  test.each([
    ['dd/container/local/nginx/cmd/check', 'dd/container/local/nginx', 'check'],
    ['dd/container/agent/ml/local/nginx/cmd/update', 'dd/container/agent/ml/local/nginx', 'update'],
  ])('parses %s', (topic, stateTopic, action) => {
    expect(parseHassButtonCommandTopic(topic, 'dd/container')).toEqual({ stateTopic, action });
  });

  test.each([
    'other/local/nginx/cmd/check',
    'dd/container/local/nginx/cmd/reboot',
    'dd/container/local/nginx/cmd',
    'dd/container/cmd/check',
    'dd/container/local/nginx/cmd/check/result',
  ])('rejects %s', (topic) => {
    expect(parseHassButtonCommandTopic(topic, 'dd/container')).toBeUndefined();
  });
});

describe('buildHassReleaseSummary', () => {
  test('returns undefined without usable text', () => {
    expect(buildHassReleaseSummary(undefined)).toBeUndefined();
    expect(buildHassReleaseSummary({ title: '  ', body: 5 })).toBeUndefined();
  });

  test('joins title and body and collapses whitespace', () => {
    expect(buildHassReleaseSummary({ title: 'v2', body: 'a\n\nb   c' })).toBe('v2: a b c');
    expect(buildHassReleaseSummary({ body: 'only body' })).toBe('only body');
  });

  test('keeps text of exactly 255 characters untouched', () => {
    expect(buildHassReleaseSummary({ body: 'x'.repeat(255) })).toBe('x'.repeat(255));
  });

  test('truncates to 255 code points with an ellipsis without splitting a pair', () => {
    const summary = buildHassReleaseSummary({ body: '😀'.repeat(300) }) as string;
    expect(Array.from(summary)).toHaveLength(255);
    expect(summary.endsWith('…')).toBe(true);
  });
});
