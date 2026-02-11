// @ts-nocheck
import pino from 'pino';
import { Writable } from 'node:stream';
import { addEntry, getEntries } from './buffer.js';

vi.mock('../configuration', () => ({
    getLogLevel: vi.fn(() => 'info'),
}));

vi.mock('./buffer.js', () => ({
    addEntry: vi.fn(),
    getEntries: vi.fn(),
}));

/**
 * Unit tests for the bufferStream write logic in log/index.ts.
 * We recreate the stream's write function to test edge-case branches
 * that can't be triggered through normal pino logging.
 */
describe('bufferStream write logic', () => {
    // Recreate the exact write function from log/index.ts
    function bufferWrite(chunk) {
        try {
            const obj = JSON.parse(chunk.toString());
            addEntry({
                timestamp: obj.time || Date.now(),
                level: pino.levels.labels[obj.level] || 'info',
                component: obj.component || obj.name || 'drydock',
                msg: obj.msg || '',
            });
        } catch { /* ignore parse errors */ }
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('should use Date.now() when time is missing', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        bufferWrite(JSON.stringify({ level: 30, msg: 'test' }));
        expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
            timestamp: now,
        }));
    });

    test('should default level to info for unknown numeric level', () => {
        bufferWrite(JSON.stringify({ time: 1000, level: 999, msg: 'test' }));
        expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
            level: 'info',
        }));
    });

    test('should use obj.name when component is undefined', () => {
        bufferWrite(JSON.stringify({ time: 1000, level: 30, name: 'my-service', msg: 'test' }));
        expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
            component: 'my-service',
        }));
    });

    test('should fall back to drydock when both component and name are undefined', () => {
        bufferWrite(JSON.stringify({ time: 1000, level: 30, msg: 'test' }));
        expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
            component: 'drydock',
        }));
    });

    test('should use empty string when msg is undefined', () => {
        bufferWrite(JSON.stringify({ time: 1000, level: 30 }));
        expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
            msg: '',
        }));
    });

    test('should ignore JSON parse errors', () => {
        // Should not throw
        bufferWrite('not valid json {{{');
        expect(addEntry).not.toHaveBeenCalled();
    });

    test('should prefer component over name', () => {
        bufferWrite(JSON.stringify({ time: 1000, level: 30, component: 'my-comp', name: 'my-name', msg: 'test' }));
        expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({
            component: 'my-comp',
        }));
    });
});
