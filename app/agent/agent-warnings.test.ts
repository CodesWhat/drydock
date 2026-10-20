import { agentTrustsImageHookLabels, getAgentWarnings } from './agent-warnings.js';

describe('agent warnings', () => {
  test.each([
    ['1.6.1', undefined, true],
    ['1.7.0', '1.7.0-rc.19', true],
    ['1.7.0', '1.7.0-rc.20', false],
    ['1.7.0', undefined, false],
    ['1.7.0', '1.7.0', false],
    ['1.8.0', '1.8.0-rc.2', false],
    ['1.0', undefined, false],
    ['local', undefined, false],
    [undefined, undefined, false],
    [undefined, '1.6.0-rc.1', true],
  ])('version %s build %s -> old=%s', (version, build, expected) => {
    expect(agentTrustsImageHookLabels({ version, build })).toBe(expected);
  });

  test('returns the warning list', () => {
    expect(getAgentWarnings({ version: '1.6.1' })).toEqual(['hook-labels-trusted']);
    expect(getAgentWarnings({ version: '1.7.0' })).toEqual([]);
    expect(getAgentWarnings(undefined)).toEqual([]);
  });
});
