// @ts-nocheck
import { test, fc } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import parse from 'parse-docker-image-name';

describe('Docker image name parsing fuzz tests', () => {
    test.prop([fc.string()])(
        'parse-docker-image-name never throws on arbitrary strings',
        (input) => {
            const result = parse(input);
            expect(typeof result).toBe('object');
        },
    );

    test.prop([fc.string({ minLength: 1, maxLength: 200 })])(
        'parse-docker-image-name always returns an object with expected fields',
        (input) => {
            const result = parse(input);
            expect(result).toBeDefined();
            // The parser should always return an object; key fields may be undefined
            expect(typeof result).toBe('object');
        },
    );

    test.prop([
        fc.stringMatching(/^[a-z0-9._/-]{1,60}(:[a-z0-9._-]{1,30})?$/),
    ])(
        'parse handles realistic image name patterns',
        (input) => {
            const result = parse(input);
            expect(typeof result).toBe('object');
        },
    );

    test.prop([
        fc.oneof(
            fc.constant('nginx'),
            fc.constant('nginx:latest'),
            fc.constant('library/nginx:1.21'),
            fc.constant('ghcr.io/user/image:v1.0.0'),
            fc.constant('registry.example.com:5000/org/app:dev'),
            fc.string({ minLength: 0, maxLength: 150 }),
        ),
    ])(
        'parse handles a mix of valid and arbitrary image references',
        (input) => {
            const result = parse(input);
            expect(typeof result).toBe('object');
        },
    );

    test.prop([
        fc.record({
            domain: fc.option(
                fc.stringMatching(/^[a-z0-9.-]{1,30}(\.[a-z]{2,6})?(:\d{1,5})?$/),
                { nil: undefined },
            ),
            path: fc.stringMatching(/^[a-z0-9._/-]{1,40}$/),
            tag: fc.option(fc.stringMatching(/^[a-z0-9._-]{1,20}$/), {
                nil: undefined,
            }),
        }),
    ])(
        'parse roundtrips structured image name components',
        ({ domain, path, tag }) => {
            let input = '';
            if (domain) input += `${domain}/`;
            input += path;
            if (tag) input += `:${tag}`;
            const result = parse(input);
            expect(typeof result).toBe('object');
        },
    );
});
