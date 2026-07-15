import {
  getHassCommandTopicFilters,
  getHassCommandTopicFromStateTopic,
  getStateTopicFromCommandTopic,
  isHassInstallPayload,
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

  test.each([
    'update',
    '',
    'INSTALL',
    'installer',
  ])('returns false for a non-matching payload %j', (payload) => {
    expect(isHassInstallPayload(payload)).toBe(false);
  });

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
