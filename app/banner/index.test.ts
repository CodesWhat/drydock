import { renderBanner } from './index.js';

vi.mock('../configuration/index.js', () => ({
  getVersion: () => '1.6.0-test',
  getDnsMode: () => 'ipv4first',
  ddEnvVars: {},
}));

function makeStream(
  isTTY: boolean,
  columns?: number,
): NodeJS.WriteStream & { write: ReturnType<typeof vi.fn> } {
  return { isTTY, columns, write: vi.fn() } as unknown as NodeJS.WriteStream & {
    write: ReturnType<typeof vi.fn>;
  };
}

describe('renderBanner', () => {
  test('writes art with centering padding when TTY and columns > BANNER_WIDTH', () => {
    const stream = makeStream(true, 200);
    renderBanner({ mode: 'controller', stream, env: {} });

    expect(stream.write).toHaveBeenCalledOnce();
    const output = stream.write.mock.calls[0][0] as string;
    // Should contain the version and mode
    expect(output).toContain('drydock v1.6.0-test · controller');
    // Should have centering padding (200 - 50) / 2 = 75 spaces
    const identityLine = output.split('\n').at(-2) ?? '';
    expect(identityLine.startsWith(' ')).toBe(true);
  });

  test('writes art without padding when columns equals BANNER_WIDTH', () => {
    const stream = makeStream(true, 50);
    renderBanner({ mode: 'agent', stream, env: {} });

    expect(stream.write).toHaveBeenCalledOnce();
    const output = stream.write.mock.calls[0][0] as string;
    expect(output).toContain('drydock v1.6.0-test · agent');
    // No centering: columns not > BANNER_WIDTH
    const identityLine = output.split('\n').at(-2) ?? '';
    expect(identityLine.startsWith('\x1b')).toBe(true);
  });

  test('writes art without padding when columns is undefined', () => {
    const stream = makeStream(true, undefined);
    renderBanner({ mode: 'controller', stream, env: {} });

    expect(stream.write).toHaveBeenCalledOnce();
    const output = stream.write.mock.calls[0][0] as string;
    expect(output).toContain('drydock v1.6.0-test · controller');
  });

  test('does not write when stream is not a TTY', () => {
    const stream = makeStream(false, 200);
    renderBanner({ mode: 'controller', stream, env: {} });
    expect(stream.write).not.toHaveBeenCalled();
  });

  test('does not write when NO_COLOR is set to a non-empty string', () => {
    const stream = makeStream(true, 200);
    renderBanner({ mode: 'controller', stream, env: { NO_COLOR: '1' } });
    expect(stream.write).not.toHaveBeenCalled();
  });

  test('does not write when NO_COLOR is empty string (env var present but blank)', () => {
    // NO_COLOR='' means set but blank — should still render
    const stream = makeStream(true, 200);
    renderBanner({ mode: 'controller', stream, env: { NO_COLOR: '' } });
    expect(stream.write).toHaveBeenCalledOnce();
  });

  test('identity line contains version and mode for agent', () => {
    const stream = makeStream(true, 50);
    renderBanner({ mode: 'agent', stream, env: {} });

    const output = stream.write.mock.calls[0][0] as string;
    expect(output).toContain('drydock v1.6.0-test · agent');
  });

  test('identity line contains version and mode for controller', () => {
    const stream = makeStream(true, 50);
    renderBanner({ mode: 'controller', stream, env: {} });

    const output = stream.write.mock.calls[0][0] as string;
    expect(output).toContain('drydock v1.6.0-test · controller');
  });

  test('output ends with a trailing newline', () => {
    const stream = makeStream(true, 50);
    renderBanner({ mode: 'controller', stream, env: {} });

    const output = stream.write.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);
  });

  test('falls back to process.stderr when stream is omitted', () => {
    // process.stderr is not a TTY in the test environment — this exercises
    // the `stream ?? process.stderr` branch without producing output.
    const originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });
    try {
      // Should not throw; renderBanner should be a no-op (not a TTY)
      renderBanner({ mode: 'controller', env: {} });
    } finally {
      Object.defineProperty(process.stderr, 'isTTY', {
        configurable: true,
        value: originalIsTTY,
      });
    }
  });

  test('falls back to process.env when env is omitted', () => {
    const stream = makeStream(false, 50);
    // process.env is the real env; stream is non-TTY so write is never called.
    renderBanner({ mode: 'controller', stream });
    expect(stream.write).not.toHaveBeenCalled();
  });
});
