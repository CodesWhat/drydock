const {
  mockRandomUUID,
  mockGetStoreConfiguration,
  mockAccess,
  mockMkdir,
  mockWriteFile,
  mockRename,
  mockUnlink,
  mockReaddir,
  mockStat,
} = vi.hoisted(() => ({
  mockRandomUUID: vi.fn(() => 'uuid-test'),
  mockGetStoreConfiguration: vi.fn(() => ({ path: '/store', file: 'dd.json' })),
  mockAccess: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockRename: vi.fn(),
  mockUnlink: vi.fn(),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  default: {
    randomUUID: mockRandomUUID,
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: mockAccess,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    rename: mockRename,
    unlink: mockUnlink,
    readdir: mockReaddir,
    stat: mockStat,
  },
}));

vi.mock('../../store/index.js', () => ({
  getConfiguration: mockGetStoreConfiguration,
}));

import {
  enforceIconCacheLimits,
  isCachedIconUsable,
  resetIconCacheEnforcementStateForTests,
  writeIconAtomically,
} from './storage.js';

describe('icons/storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetIconCacheEnforcementStateForTests();
    mockRandomUUID.mockReturnValue('uuid-test');
    mockGetStoreConfiguration.mockReturnValue({ path: '/store', file: 'dd.json' });
    mockAccess.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
    mockStat.mockResolvedValue({
      mtimeMs: Date.now(),
      size: 1024,
      isFile: () => true,
    });
  });

  test('removes stale icon entries when ttl has expired', async () => {
    mockStat.mockResolvedValue({
      mtimeMs: 0,
      size: 1024,
      isFile: () => true,
    });

    const usable = await isCachedIconUsable('/store/icons/simple/stale.svg');

    expect(usable).toBe(false);
    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/stale.svg');
  });

  test('checks cached icon usability via stat without pre-access syscall', async () => {
    mockStat.mockResolvedValue({
      mtimeMs: Date.now(),
      size: 1024,
      isFile: () => true,
    });

    const usable = await isCachedIconUsable('/store/icons/simple/fresh.svg');

    expect(usable).toBe(true);
    expect(mockStat).toHaveBeenCalledWith('/store/icons/simple/fresh.svg');
    expect(mockAccess).not.toHaveBeenCalled();
  });

  test('evicts oldest cache entry when byte budget is exceeded', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(2_000_000_000_000);
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['old.svg', 'fresh.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/old.svg') {
        return { mtimeMs: Date.now() - 2_000, size: 80 * 1024 * 1024, isFile: () => true };
      }
      if (targetPath === '/store/icons/simple/fresh.svg') {
        return { mtimeMs: Date.now() - 1_000, size: 30 * 1024 * 1024, isFile: () => true };
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });

    try {
      await enforceIconCacheLimits();
    } finally {
      nowSpy.mockRestore();
    }

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/old.svg');
    expect(mockUnlink).not.toHaveBeenCalledWith('/store/icons/simple/fresh.svg');
  });

  test('keeps protected path during eviction pass', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(2_000_000_000_000);
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['old.svg', 'protected.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/old.svg') {
        return { mtimeMs: Date.now() - 2_000, size: 30 * 1024 * 1024, isFile: () => true };
      }
      if (targetPath === '/store/icons/simple/protected.svg') {
        return { mtimeMs: Date.now() - 1_000, size: 80 * 1024 * 1024, isFile: () => true };
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });

    try {
      await enforceIconCacheLimits({ protectedPath: '/store/icons/simple/protected.svg' });
    } finally {
      nowSpy.mockRestore();
    }

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/old.svg');
    expect(mockUnlink).not.toHaveBeenCalledWith('/store/icons/simple/protected.svg');
  });

  test('ignores cache entries that fail stat between directory scan and stat call', async () => {
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['vanished.svg', 'fresh.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/vanished.svg') {
        throw new Error('ENOENT');
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });

    await enforceIconCacheLimits();

    expect(mockUnlink).not.toHaveBeenCalledWith('/store/icons/simple/vanished.svg');
  });

  test('keeps protected cache entry when no other eviction candidate is available', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(2_000_000_000_000);
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['protected.svg']);
    mockStat.mockResolvedValue({
      mtimeMs: Date.now() - 1_000,
      size: 150 * 1024 * 1024,
      isFile: () => true,
    });

    try {
      await enforceIconCacheLimits({ protectedPath: '/store/icons/simple/protected.svg' });
    } finally {
      nowSpy.mockRestore();
    }

    expect(mockUnlink).not.toHaveBeenCalledWith('/store/icons/simple/protected.svg');
  });

  test('writes icons atomically through a tmp file', async () => {
    await writeIconAtomically('/store/icons/simple/docker.svg', Buffer.from('<svg />'));

    expect(mockMkdir).toHaveBeenCalledWith('/store/icons/simple', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/store/icons/simple/docker.svg.tmp.uuid-test',
      expect.any(Buffer),
    );
    expect(mockRename).toHaveBeenCalledWith(
      '/store/icons/simple/docker.svg.tmp.uuid-test',
      '/store/icons/simple/docker.svg',
    );
  });

  test('cleans up tmp file when atomic rename fails', async () => {
    mockRename.mockRejectedValue(new Error('rename failed'));

    await expect(
      writeIconAtomically('/store/icons/simple/docker.svg', Buffer.from('<svg />')),
    ).rejects.toThrow('rename failed');

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/docker.svg.tmp.uuid-test');
  });
});
