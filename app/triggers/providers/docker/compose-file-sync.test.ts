import fs from 'node:fs/promises';
import path from 'node:path';

vi.mock('node:fs/promises');
const mockUpdateComposeServiceImageInText = vi.hoisted(() => vi.fn());
vi.mock('../dockercompose/ComposeFileParser.js', () => ({
  updateComposeServiceImageInText: (...args: unknown[]) =>
    mockUpdateComposeServiceImageInText(...args),
}));

vi.mock('../../../log/index.js', () => ({
  default: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { syncComposeFileTag } from './compose-file-sync.js';

const COMPOSE_CONTENT = `services:
  app:
    image: hemmeligapp/hemmelig:v6
    ports:
      - "3000:3000"
  db:
    image: postgres:15
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
`;

function makeLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeLabels(overrides: Record<string, string> = {}) {
  return {
    'com.docker.compose.project.config_files': '/home/user/stacks/app/docker-compose.yml',
    'com.docker.compose.project.working_dir': '/home/user/stacks/app',
    'com.docker.compose.service': 'app',
    ...overrides,
  };
}

function makeDockerApi(bindDefinitions: string[] = []) {
  return {
    getContainer: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        HostConfig: {
          Binds: bindDefinitions,
        },
      }),
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockUpdateComposeServiceImageInText.mockImplementation(
    (composeText: string, serviceName: string, newImage: string) =>
      serviceName === 'app'
        ? composeText.replace('hemmeligapp/hemmelig:v6', newImage)
        : composeText,
  );
});

describe('syncComposeFileTag', () => {
  test('should update compose file image tag for compose-managed container', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    const result = await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(true);

    // Verify file was read
    expect(fs.readFile).toHaveBeenCalledWith('/home/user/stacks/app/docker-compose.yml', 'utf8');

    // Verify atomic write (temp file then rename)
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1];
    expect(writtenContent).toContain('hemmeligapp/hemmelig:v7');
    expect(writtenContent).not.toContain('hemmeligapp/hemmelig:v6');
    // db service should be unchanged
    expect(writtenContent).toContain('postgres:15');

    expect(fs.rename).toHaveBeenCalledTimes(1);
    expect(logContainer.info).toHaveBeenCalledWith(expect.stringContaining('compose file'));
  });

  test('should skip when container has no compose labels', async () => {
    const logContainer = makeLog();

    const result = await syncComposeFileTag({
      labels: {},
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('should skip when labels are undefined', async () => {
    const logContainer = makeLog();

    const result = await syncComposeFileTag({
      labels: undefined as unknown as Record<string, string>,
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('should skip when config_files label is missing', async () => {
    const logContainer = makeLog();

    const result = await syncComposeFileTag({
      labels: {
        'com.docker.compose.service': 'app',
      },
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('should skip when service label is missing', async () => {
    const logContainer = makeLog();

    const result = await syncComposeFileTag({
      labels: {
        'com.docker.compose.project.config_files': '/path/compose.yml',
      },
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('should skip when compose file path resolves to empty first entry', async () => {
    const logContainer = makeLog();

    const result = await syncComposeFileTag({
      labels: {
        'com.docker.compose.project.config_files': ' , /home/user/stacks/app/docker-compose.yml',
        'com.docker.compose.project.working_dir': '/home/user/stacks/app',
        'com.docker.compose.service': 'app',
      },
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('should resolve relative compose file paths using working_dir', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await syncComposeFileTag({
      labels: makeLabels({
        'com.docker.compose.project.config_files': 'docker-compose.yml',
        'com.docker.compose.project.working_dir': '/home/user/stacks/app',
      }),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(fs.readFile).toHaveBeenCalledWith(
      path.resolve('/home/user/stacks/app', 'docker-compose.yml'),
      'utf8',
    );
  });

  test('should use first file when multiple compose files are specified', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await syncComposeFileTag({
      labels: makeLabels({
        'com.docker.compose.project.config_files':
          '/home/user/stacks/app/docker-compose.yml,/home/user/stacks/app/docker-compose.override.yml',
      }),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(fs.readFile).toHaveBeenCalledWith('/home/user/stacks/app/docker-compose.yml', 'utf8');
  });

  test('should remap host compose file paths through drydock bind mounts', async () => {
    const logContainer = makeLog();
    const dockerApi = makeDockerApi([
      '/Users/sbenson/code/drydock/test/qa-compose.yml:/drydock/qa-compose.yml:ro',
    ]);
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await syncComposeFileTag({
      labels: makeLabels({
        'com.docker.compose.project.config_files':
          '/Users/sbenson/code/drydock/test/qa-compose.yml',
        'com.docker.compose.project.working_dir': '/Users/sbenson/code/drydock/test',
      }),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
      dockerApi,
      selfContainerIdentifier: 'drydock-playwright-qa',
    });

    expect(fs.readFile).toHaveBeenCalledWith('/drydock/qa-compose.yml', 'utf8');
  });

  test('should fall back to the resolved compose path when bind mount inspection fails', async () => {
    const logContainer = makeLog();
    const dockerApi = {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockRejectedValue(new Error('inspect failed')),
      }),
    };
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await syncComposeFileTag({
      labels: makeLabels({
        'com.docker.compose.project.config_files': 'docker-compose.yml',
        'com.docker.compose.project.working_dir': '/home/user/stacks/app',
      }),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
      dockerApi,
      selfContainerIdentifier: 'drydock-playwright-qa',
    });

    expect(fs.readFile).toHaveBeenCalledWith(
      path.resolve('/home/user/stacks/app', 'docker-compose.yml'),
      'utf8',
    );
    expect(logContainer.debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to inspect bind mounts for compose file sync path remapping'),
    );
  });

  test('should stringify non-Error bind mount inspection failures', async () => {
    const logContainer = makeLog();
    const dockerApi = {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockRejectedValue('inspect failed'),
      }),
    };
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await syncComposeFileTag({
      labels: makeLabels({
        'com.docker.compose.project.config_files': '/home/user/stacks/app/docker-compose.yml',
      }),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
      dockerApi,
      selfContainerIdentifier: 'drydock-playwright-qa',
    });

    expect(logContainer.debug).toHaveBeenCalledWith(expect.stringContaining('inspect failed'));
  });

  test('should handle compose file read failure gracefully', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file'));

    const result = await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  test('should handle compose file write failure gracefully', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockRejectedValue(new Error('EACCES: permission denied'));

    const result = await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });

  test('should stringify non-Error compose sync failures', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockRejectedValue('boom' as never);

    const result = await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(logContainer.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  test('should handle rename failure with direct write fallback', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockRejectedValue(new Error('EBUSY'));
    vi.mocked(fs.unlink).mockRejectedValue(new Error('unlink failed'));

    const result = await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    // Falls back to direct overwrite
    expect(result).toBe(true);
    // writeFile called twice: once for temp, once for direct fallback
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  test('should handle service not found in compose file gracefully', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    mockUpdateComposeServiceImageInText.mockReturnValue(COMPOSE_CONTENT);

    const result = await syncComposeFileTag({
      labels: makeLabels({
        'com.docker.compose.service': 'nonexistent',
      }),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(logContainer.debug).toHaveBeenCalledWith(expect.stringContaining('already has image'));
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.rename).not.toHaveBeenCalled();
  });

  test('should skip when compose file already has requested image', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    mockUpdateComposeServiceImageInText.mockReturnValue(COMPOSE_CONTENT);

    const result = await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v6',
      logContainer,
    });

    expect(result).toBe(false);
    expect(logContainer.debug).toHaveBeenCalledWith(expect.stringContaining('already has image'));
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.rename).not.toHaveBeenCalled();
  });

  test('should preserve formatting and other services', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    // Ports should remain intact
    expect(writtenContent).toContain('- "3000:3000"');
    // volumes section should be untouched
    expect(writtenContent).toContain('pgdata:');
  });

  test('should clean up temp file on write failure', async () => {
    const logContainer = makeLog();
    vi.mocked(fs.readFile).mockResolvedValue(COMPOSE_CONTENT);
    vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined);
    vi.mocked(fs.rename).mockRejectedValue(new Error('EBUSY'));
    // Second writeFile (direct fallback) also fails
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('EACCES'));
    vi.mocked(fs.unlink).mockRejectedValue(new Error('unlink failed'));

    const result = await syncComposeFileTag({
      labels: makeLabels(),
      newImage: 'hemmeligapp/hemmelig:v7',
      logContainer,
    });

    expect(result).toBe(false);
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });
});
