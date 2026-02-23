import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { runSelfUpdateController } from './self-update-controller.js';

const mockDockerodeCtor = vi.hoisted(() => vi.fn());

vi.mock('dockerode', () => ({
  default: mockDockerodeCtor,
}));

function setControllerEnv() {
  process.env.DD_SELF_UPDATE_OP_ID = 'op-123';
  process.env.DD_SELF_UPDATE_OLD_CONTAINER_ID = 'old-container-id';
  process.env.DD_SELF_UPDATE_OLD_CONTAINER_NAME = 'drydock';
  process.env.DD_SELF_UPDATE_NEW_CONTAINER_ID = 'new-container-id';
  process.env.DD_SELF_UPDATE_START_TIMEOUT_MS = '1000';
  process.env.DD_SELF_UPDATE_HEALTH_TIMEOUT_MS = '1000';
  process.env.DD_SELF_UPDATE_POLL_INTERVAL_MS = '1';
}

function clearControllerEnv() {
  delete process.env.DD_SELF_UPDATE_OP_ID;
  delete process.env.DD_SELF_UPDATE_OLD_CONTAINER_ID;
  delete process.env.DD_SELF_UPDATE_OLD_CONTAINER_NAME;
  delete process.env.DD_SELF_UPDATE_NEW_CONTAINER_ID;
  delete process.env.DD_SELF_UPDATE_START_TIMEOUT_MS;
  delete process.env.DD_SELF_UPDATE_HEALTH_TIMEOUT_MS;
  delete process.env.DD_SELF_UPDATE_POLL_INTERVAL_MS;
}

describe('self-update-controller', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setControllerEnv();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearControllerEnv();
    vi.restoreAllMocks();
  });

  test('runs controller success path and commits by removing old container', async () => {
    const oldContainer = {
      stop: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
      start: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const newContainer = {
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const getContainer = vi.fn((id: string) => {
      if (id === 'old-container-id') {
        return oldContainer;
      }
      if (id === 'new-container-id') {
        return newContainer;
      }
      throw new Error(`unexpected container id ${id}`);
    });
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return { getContainer };
    });

    await runSelfUpdateController();

    expect(oldContainer.stop).toHaveBeenCalledTimes(1);
    expect(newContainer.start).toHaveBeenCalledTimes(1);
    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(newContainer.remove).not.toHaveBeenCalled();
    expect(oldContainer.start).not.toHaveBeenCalled();
    expect(oldContainer.rename).not.toHaveBeenCalled();
  });

  test('rolls back by removing candidate, restoring old name, and restarting old container when start-new fails', async () => {
    const oldContainer = {
      stop: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ State: { Running: false }, Name: '/drydock-old-123' }),
      start: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const newContainer = {
      start: vi.fn().mockRejectedValue(new Error('start failed')),
      inspect: vi.fn().mockResolvedValue({ State: { Running: false } }),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const getContainer = vi.fn((id: string) => {
      if (id === 'old-container-id') {
        return oldContainer;
      }
      if (id === 'new-container-id') {
        return newContainer;
      }
      throw new Error(`unexpected container id ${id}`);
    });
    mockDockerodeCtor.mockImplementation(function DockerodeMock() {
      return { getContainer };
    });

    await expect(runSelfUpdateController()).rejects.toThrow('start failed');

    expect(newContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(oldContainer.rename).toHaveBeenCalledWith({ name: 'drydock' });
    expect(oldContainer.start).toHaveBeenCalledTimes(1);
    expect(oldContainer.remove).not.toHaveBeenCalled();

    const removeCall = newContainer.remove.mock.invocationCallOrder[0];
    const renameCall = oldContainer.rename.mock.invocationCallOrder[0];
    const startCall = oldContainer.start.mock.invocationCallOrder[0];
    expect(removeCall).toBeLessThan(renameCall);
    expect(renameCall).toBeLessThan(startCall);
  });
});
