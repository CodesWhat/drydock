import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyComposeFileMetadata } from './ComposeFileMetadata.js';

function createLog() {
  return { warn: vi.fn(), debug: vi.fn() };
}

describe('copyComposeFileMetadata', () => {
  let dir: string;

  beforeEach(() => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'dd-compose-meta-'));
  });

  afterEach(() => {
    fsSync.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('copies the mode of the source onto the target', async () => {
    const source = path.join(dir, 'compose.yml');
    const target = path.join(dir, 'tmp');
    await fs.writeFile(source, 'a');
    await fs.writeFile(target, 'b');
    await fs.chmod(source, 0o600);
    await fs.chmod(target, 0o644);
    const log = createLog();

    await copyComposeFileMetadata(source, target, log);

    expect((await fs.stat(target)).mode & 0o7777).toBe(0o600);
    expect(log.warn).not.toHaveBeenCalled();
  });

  test('applies the source uid and gid to the target', async () => {
    const chmodSpy = vi.spyOn(fs, 'chmod').mockResolvedValue(undefined);
    const chownSpy = vi.spyOn(fs, 'chown').mockResolvedValue(undefined);
    vi.spyOn(fs, 'stat').mockResolvedValue({ mode: 0o100640, uid: 1234, gid: 5678 } as never);

    await copyComposeFileMetadata('/src', '/dst', createLog());

    expect(chmodSpy).toHaveBeenCalledWith('/dst', 0o640);
    expect(chownSpy).toHaveBeenCalledWith('/dst', 1234, 5678);
  });

  test('logs a warning and keeps going when chown fails', async () => {
    vi.spyOn(fs, 'chmod').mockResolvedValue(undefined);
    vi.spyOn(fs, 'chown').mockRejectedValue(new Error('EPERM: operation not permitted'));
    vi.spyOn(fs, 'stat').mockResolvedValue({ mode: 0o100600, uid: 0, gid: 0 } as never);
    const log = createLog();

    await expect(copyComposeFileMetadata('/src', '/dst', log)).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('preserve owner of /src'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('EPERM'));
  });

  test('logs a warning and still tries chown when chmod fails', async () => {
    vi.spyOn(fs, 'chmod').mockRejectedValue(new Error('EACCES'));
    const chownSpy = vi.spyOn(fs, 'chown').mockResolvedValue(undefined);
    vi.spyOn(fs, 'stat').mockResolvedValue({ mode: 0o100600, uid: 1, gid: 1 } as never);
    const log = createLog();

    await copyComposeFileMetadata('/src', '/dst', log);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('preserve mode of /src'));
    expect(chownSpy).toHaveBeenCalled();
  });

  test('skips quietly when the source does not exist', async () => {
    const chmodSpy = vi.spyOn(fs, 'chmod');
    const log = createLog();

    await copyComposeFileMetadata(path.join(dir, 'missing.yml'), path.join(dir, 'tmp'), log);

    expect(chmodSpy).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('unable to stat'));
  });
});
