// @ts-nocheck
import { createMockRequest, createMockResponse } from '../test/helpers.js';

const { mockRouter, mockGetContainers } = vi.hoisted(() => ({
  mockRouter: { use: vi.fn(), get: vi.fn() },
  mockGetContainers: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('nocache', () => ({ default: vi.fn(() => 'nocache-middleware') }));

vi.mock('../store/container', () => ({
  getContainers: mockGetContainers,
}));

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import * as groupRouter from './group.js';

function getHandler(method, path) {
  groupRouter.init();
  const call = mockRouter[method].mock.calls.find((c) => c[0] === path);
  return call[1];
}

function makeContainer(id, name, labels = {}, updateAvailable = false) {
  return { id, name, displayName: name, labels, updateAvailable };
}

describe('Group Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    test('should register routes', () => {
      groupRouter.init();
      expect(mockRouter.use).toHaveBeenCalledWith('nocache-middleware');
      expect(mockRouter.get).toHaveBeenCalledWith('/groups', expect.any(Function));
    });
  });

  describe('getGroups', () => {
    test('should return empty array when no containers exist', () => {
      mockGetContainers.mockReturnValue([]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([]);
    });

    test('should group containers by dd.group label', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', { 'dd.group': 'web-stack' }),
        makeContainer('c2', 'redis', { 'dd.group': 'web-stack' }),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const groups = res.json.mock.calls[0][0];
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('web-stack');
      expect(groups[0].containerCount).toBe(2);
      expect(groups[0].containers).toHaveLength(2);
    });

    test('should group containers by wud.group label as fallback', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', { 'wud.group': 'legacy-stack' }),
        makeContainer('c2', 'redis', { 'wud.group': 'legacy-stack' }),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('legacy-stack');
      expect(groups[0].containerCount).toBe(2);
    });

    test('should auto-detect com.docker.compose.project as group', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', { 'com.docker.compose.project': 'myapp' }),
        makeContainer('c2', 'postgres', { 'com.docker.compose.project': 'myapp' }),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('myapp');
      expect(groups[0].containerCount).toBe(2);
    });

    test('should prioritize dd.group over wud.group and compose project', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', {
          'dd.group': 'preferred',
          'wud.group': 'fallback',
          'com.docker.compose.project': 'compose',
        }),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('preferred');
    });

    test('should place containers without any group label into ungrouped with null name', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'standalone-nginx', {}),
        makeContainer('c2', 'standalone-redis', {}),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBeNull();
      expect(groups[0].containerCount).toBe(2);
    });

    test('should count updates available correctly', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', { 'dd.group': 'web' }, true),
        makeContainer('c2', 'redis', { 'dd.group': 'web' }, false),
        makeContainer('c3', 'node', { 'dd.group': 'web' }, true),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      expect(groups[0].updatesAvailable).toBe(2);
      expect(groups[0].containerCount).toBe(3);
    });

    test('should handle containers with mixed group labels across groups', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', { 'dd.group': 'frontend' }),
        makeContainer('c2', 'redis', { 'dd.group': 'backend' }),
        makeContainer('c3', 'postgres', { 'wud.group': 'backend' }),
        makeContainer('c4', 'standalone', {}),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      expect(groups).toHaveLength(3);

      const frontend = groups.find((g) => g.name === 'frontend');
      const backend = groups.find((g) => g.name === 'backend');
      const ungrouped = groups.find((g) => g.name === null);

      expect(frontend.containerCount).toBe(1);
      expect(backend.containerCount).toBe(2);
      expect(ungrouped.containerCount).toBe(1);
    });

    test('should return proper container summary format within groups', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', { 'dd.group': 'web' }, true),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      const container = groups[0].containers[0];
      expect(container).toEqual({
        id: 'c1',
        name: 'nginx',
        displayName: 'nginx',
        updateAvailable: true,
      });
    });

    test('should prefer wud.group over compose project when dd.group is absent', () => {
      mockGetContainers.mockReturnValue([
        makeContainer('c1', 'nginx', {
          'wud.group': 'wud-group',
          'com.docker.compose.project': 'compose-project',
        }),
      ]);

      const handler = getHandler('get', '/groups');
      const req = createMockRequest();
      const res = createMockResponse();
      handler(req, res);

      const groups = res.json.mock.calls[0][0];
      expect(groups[0].name).toBe('wud-group');
    });
  });
});
