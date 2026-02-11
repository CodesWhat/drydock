// @ts-nocheck
import { getEntries } from './buffer.js';

vi.mock('../configuration', () => ({
    getLogLevel: vi.fn(() => 'info'),
}));

/**
 * Tests for the bufferStream Writable defined in log/index.ts.
 * We import the logger module to trigger creation of the Writable,
 * then exercise it by logging through pino, which writes to the stream.
 */
describe('Logger bufferStream integration', () => {
    let logger;

    beforeEach(async () => {
        const mod = await import('./index.js');
        logger = mod.default;
    });

    test('should buffer log entries when logger writes', async () => {
        // Fill some entries so we can look for a unique message
        const marker = `test-marker-${Date.now()}`;
        logger.info({ component: 'test-comp' }, marker);

        // pino writes asynchronously via the stream; give it a tick
        await new Promise((r) => setTimeout(r, 50));

        const entries = getEntries({ tail: 1000 });
        const found = entries.find((e) => e.msg === marker);
        expect(found).toBeDefined();
        expect(found.component).toBe('test-comp');
        expect(found.level).toBe('info');
    });

    test('should default component to logger name when component is not set', async () => {
        const marker = `no-comp-${Date.now()}`;
        logger.warn(marker);

        await new Promise((r) => setTimeout(r, 50));

        const entries = getEntries({ tail: 1000 });
        const found = entries.find((e) => e.msg === marker);
        expect(found).toBeDefined();
        // Should fall back to the logger name 'drydock'
        expect(found.component).toBe('drydock');
    });

    test('should map pino numeric levels to labels', async () => {
        const marker = `level-test-${Date.now()}`;
        logger.error(marker);

        await new Promise((r) => setTimeout(r, 50));

        const entries = getEntries({ tail: 1000 });
        const found = entries.find((e) => e.msg === marker);
        expect(found).toBeDefined();
        expect(found.level).toBe('error');
    });

    test('should handle entries with empty msg', async () => {
        // Logging with only metadata, no message string
        logger.info({ component: 'empty-msg' }, '');

        await new Promise((r) => setTimeout(r, 50));

        const entries = getEntries({ tail: 1000 });
        const found = entries.find((e) => e.component === 'empty-msg');
        expect(found).toBeDefined();
        expect(found.msg).toBe('');
    });
});
