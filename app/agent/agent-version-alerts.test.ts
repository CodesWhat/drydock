import { ddEnvVars } from '../configuration/index.js';
import { checkAgentVersion, resetAgentVersionAlertsForTests } from './agent-version-alerts.js';

const { emit, debug } = vi.hoisted(() => ({
  emit: vi.fn(() => Promise.resolve()),
  debug: vi.fn(),
}));
vi.mock('../event/index.js', () => ({ emitAgentVersionMismatch: emit }));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug, error: vi.fn() }) },
}));

beforeEach(() => {
  resetAgentVersionAlertsForTests();
  delete ddEnvVars.DD_ALERTS_AGENTVERSIONPATCH;
  emit.mockClear();
  debug.mockClear();
});

afterEach(() => {
  delete ddEnvVars.DD_ALERTS_AGENTVERSIONPATCH;
});

describe('checkAgentVersion', () => {
  test('alerts once when an agent connects on a different minor version', () => {
    expect(checkAgentVersion('edge', '1.8.2', '1.9.0')).toBe('alerted');
    expect(emit).toHaveBeenCalledWith({
      agentName: 'edge',
      agentVersion: '1.8.2',
      controllerVersion: '1.9.0',
      difference: 'minor',
    });
    expect(checkAgentVersion('edge', '1.8.2', '1.9.0')).toBe('unchanged');
    expect(emit).toHaveBeenCalledTimes(1);
  });

  test('reports a major difference', () => {
    checkAgentVersion('edge', '2.0.0', '1.9.0');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ difference: 'major' }));
  });

  test('clears when the agent reconnects matching, so a later mismatch alerts again', () => {
    expect(checkAgentVersion('edge', '1.8.0', '1.9.0')).toBe('alerted');
    expect(checkAgentVersion('edge', '1.9.0', '1.9.0')).toBe('cleared');
    expect(checkAgentVersion('edge', '1.9.0', '1.9.0')).toBe('unchanged');
    expect(checkAgentVersion('edge', '1.8.0', '1.9.0')).toBe('alerted');
    expect(emit).toHaveBeenCalledTimes(2);
  });

  test('alerts again when the agent moves to a different wrong version', () => {
    checkAgentVersion('edge', '1.7.0', '1.9.0');
    expect(checkAgentVersion('edge', '1.8.0', '1.9.0')).toBe('alerted');
    expect(emit).toHaveBeenCalledTimes(2);
  });

  test('tracks agents independently', () => {
    checkAgentVersion('a', '1.8.0', '1.9.0');
    checkAgentVersion('b', '1.8.0', '1.9.0');
    expect(emit).toHaveBeenCalledTimes(2);
  });

  test('ignores a patch-only difference by default and alerts on it when configured', () => {
    expect(checkAgentVersion('edge', '1.9.1', '1.9.0')).toBe('unchanged');
    expect(emit).not.toHaveBeenCalled();

    ddEnvVars.DD_ALERTS_AGENTVERSIONPATCH = 'true';
    expect(checkAgentVersion('edge', '1.9.1', '1.9.0')).toBe('alerted');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ difference: 'patch' }));
  });

  test('a patch-only difference clears an earlier mismatch when patch alerts are off', () => {
    checkAgentVersion('edge', '1.8.0', '1.9.0');
    expect(checkAgentVersion('edge', '1.9.1', '1.9.0')).toBe('cleared');
  });

  test('compares base releases, so a release candidate matches its release', () => {
    expect(checkAgentVersion('edge', '1.9.0-rc.3', '1.9.0')).toBe('unchanged');
    expect(checkAgentVersion('edge', '1.9.0', '1.9.0-rc.1')).toBe('unchanged');
    expect(emit).not.toHaveBeenCalled();
  });

  test('skips versions that cannot be compared and leaves state alone', () => {
    checkAgentVersion('edge', '1.8.0', '1.9.0');
    expect(checkAgentVersion('edge', undefined, '1.9.0')).toBe('skipped');
    expect(checkAgentVersion('edge', 'unknown', '1.9.0')).toBe('skipped');
    expect(checkAgentVersion('edge', '1.9.0', 'local')).toBe('skipped');
    expect(checkAgentVersion('edge', '1.8.0', '1.9.0')).toBe('unchanged');
  });

  test('uses the controller version when none is passed', () => {
    ddEnvVars.DD_VERSION = '1.9.0';
    try {
      expect(checkAgentVersion('edge', '1.7.0')).toBe('alerted');
    } finally {
      delete ddEnvVars.DD_VERSION;
    }
  });

  test('a failing emit is logged and never thrown', async () => {
    emit.mockRejectedValueOnce(new Error('handler down'));
    expect(checkAgentVersion('edge', '1.8.0', '1.9.0')).toBe('alerted');
    await Promise.resolve();
    await Promise.resolve();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('handler down'));
  });

  test('falls back to no patch alerts when the configuration is invalid', () => {
    ddEnvVars.DD_ALERTS_NOPE = 'x';
    try {
      expect(checkAgentVersion('edge', '1.9.1', '1.9.0')).toBe('unchanged');
    } finally {
      delete ddEnvVars.DD_ALERTS_NOPE;
    }
  });
});
