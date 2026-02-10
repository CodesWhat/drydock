// @ts-nocheck
import log from './index.js';

// Mock the configuration module
vi.mock('../configuration', () => ({
    getLogLevel: vi.fn(() => 'info'),
}));

describe('Logger', () => {
    test('should export a pino logger instance', async () => {
        expect(log).toBeDefined();
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
        expect(typeof log.debug).toBe('function');
    });

    test('should have correct logger name', async () => {
        expect(log.bindings().name).toBe('drydock');
    });

    test('should have correct log level', async () => {
        expect(log.level).toBe('info');
    });
});
