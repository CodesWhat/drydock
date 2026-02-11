// @ts-nocheck
import { describe, test, expect, beforeEach } from 'vitest';
import * as containerApi from './container.js';
import * as storeContainer from '../../store/container.js';
import * as configuration from '../../configuration/index.js';
import * as registry from '../../registry/index.js';

vi.mock('../../log/index.js', () => ({ default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

vi.mock('../../store/container.js', () => ({
    getContainers: vi.fn(),
    getContainer: vi.fn(),
    deleteContainer: vi.fn(),
}));

vi.mock('../../configuration/index.js', () => ({
    getServerConfiguration: vi.fn(),
}));

vi.mock('../../registry/index.js', () => ({
    getState: vi.fn(() => ({ watcher: {}, trigger: {} })),
}));

describe('agent API container', () => {
    let req;
    let res;

    beforeEach(() => {
        vi.clearAllMocks();
        req = { params: {} };
        res = {
            json: vi.fn(),
            sendStatus: vi.fn(),
        };
    });

    describe('getContainers', () => {
        test('should return all containers', () => {
            const containers = [{ id: 'c1' }, { id: 'c2' }];
            storeContainer.getContainers.mockReturnValue(containers);
            containerApi.getContainers(req, res);
            expect(storeContainer.getContainers).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(containers);
        });
    });

    describe('getContainerLogs', () => {
        /** Build a Docker multiplexed stream buffer (8-byte header + payload). */
        function dockerStreamBuffer(text, stream = 1) {
            const payload = Buffer.from(text, 'utf-8');
            const header = Buffer.alloc(8);
            header[0] = stream;
            header.writeUInt32BE(payload.length, 4);
            return Buffer.concat([header, payload]);
        }

        test('should return 404 when container not found', async () => {
            storeContainer.getContainer.mockReturnValue(undefined);
            req.params.id = 'c1';
            req.query = {};
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(res.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return 500 when watcher not found', async () => {
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'my-container', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
            req.params.id = 'c1';
            req.query = {};
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('No watcher found'),
            }));
        });

        test('should return logs successfully', async () => {
            const mockLogs = dockerStreamBuffer('log output');
            const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
            const mockWatcher = { dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) } };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'my-container', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            req.params.id = 'c1';
            req.query = {};
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(mockWatcher.dockerApi.getContainer).toHaveBeenCalledWith('my-container');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ logs: 'log output' });
        });

        test('should return 500 when docker API fails', async () => {
            const mockDockerContainer = { logs: vi.fn().mockRejectedValue(new Error('docker error')) };
            const mockWatcher = { dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) } };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'my-container', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            req.params.id = 'c1';
            req.query = {};
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('Error fetching container logs'),
            }));
        });

        test('should handle string response from docker logs', async () => {
            // Build a docker stream frame as a Buffer, then convert to string
            // to exercise the Buffer.isBuffer() === false branch in demuxDockerStream
            const payload = Buffer.from('string log output', 'utf-8');
            const header = Buffer.alloc(8);
            header[0] = 1; // stdout
            header.writeUInt32BE(payload.length, 4);
            const frame = Buffer.concat([header, payload]);
            // Pass as hex string that will be converted back via Buffer.from()
            const mockDockerContainer = { logs: vi.fn().mockResolvedValue(frame.toString('binary')) };
            const mockWatcher = { dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) } };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'my-container', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            req.params.id = 'c1';
            req.query = {};
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            // The demux should still extract something (the string gets converted to Buffer via Buffer.from)
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ logs: expect.any(String) }));
        });

        test('should handle truncated docker stream buffer', async () => {
            // Create a header claiming 1000 bytes but only provide 10
            const header = Buffer.alloc(8);
            header[0] = 1;
            header.writeUInt32BE(1000, 4); // claims 1000 bytes
            const partial = Buffer.from('short');
            const truncated = Buffer.concat([header, partial]); // only 5 bytes of payload
            const mockDockerContainer = { logs: vi.fn().mockResolvedValue(truncated) };
            const mockWatcher = { dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) } };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'my-container', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            req.params.id = 'c1';
            req.query = {};
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ logs: '' });
        });

        test('should pass timestamps=false when query param is false', async () => {
            const mockLogs = Buffer.alloc(0);
            const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
            const mockWatcher = { dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) } };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'my-container', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            req.params.id = 'c1';
            req.query = { timestamps: 'false' };
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(mockDockerContainer.logs).toHaveBeenCalledWith(
                expect.objectContaining({ timestamps: false }),
            );
        });

        test('should default timestamps to true', async () => {
            const mockLogs = Buffer.alloc(0);
            const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
            const mockWatcher = { dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) } };
            storeContainer.getContainer.mockReturnValue({ id: 'c1', name: 'my-container', watcher: 'local' });
            registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
            req.params.id = 'c1';
            req.query = {};
            res.status = vi.fn().mockReturnThis();
            await containerApi.getContainerLogs(req, res);
            expect(mockDockerContainer.logs).toHaveBeenCalledWith(
                expect.objectContaining({ timestamps: true }),
            );
        });
    });

    describe('deleteContainer', () => {
        test('should return 403 when delete feature is disabled', () => {
            configuration.getServerConfiguration.mockReturnValue({
                feature: { delete: false },
            });
            req.params.id = 'c1';
            containerApi.deleteContainer(req, res);
            expect(res.sendStatus).toHaveBeenCalledWith(403);
        });

        test('should return 404 when container is not found', () => {
            configuration.getServerConfiguration.mockReturnValue({
                feature: { delete: true },
            });
            req.params.id = 'c1';
            storeContainer.getContainer.mockReturnValue(undefined);
            containerApi.deleteContainer(req, res);
            expect(res.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should delete container and return 204', () => {
            configuration.getServerConfiguration.mockReturnValue({
                feature: { delete: true },
            });
            req.params.id = 'c1';
            storeContainer.getContainer.mockReturnValue({ id: 'c1' });
            containerApi.deleteContainer(req, res);
            expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
            expect(res.sendStatus).toHaveBeenCalledWith(204);
        });
    });
});
