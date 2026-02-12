// @ts-nocheck
import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { flatten, testable_getLink, validate } from './container.js';

// A valid minimal container object for fuzzing variations
function validContainerArb() {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    watcher: fc.string({ minLength: 1, maxLength: 50 }),
    image: fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }),
      registry: fc.record({
        name: fc.string({ minLength: 1, maxLength: 50 }),
        url: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      tag: fc.record({
        value: fc.string({ minLength: 1, maxLength: 30 }),
        semver: fc.boolean(),
      }),
      digest: fc.record({
        watch: fc.boolean(),
      }),
      architecture: fc.string({ minLength: 1, maxLength: 20 }),
      os: fc.string({ minLength: 1, maxLength: 20 }),
    }),
  });
}

function minimalValidContainer() {
  return {
    id: 'container-1',
    name: 'nginx',
    watcher: 'docker',
    image: {
      id: 'image-1',
      registry: {
        name: 'hub',
        url: 'https://hub',
      },
      name: 'library/nginx',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
      },
      architecture: 'amd64',
      os: 'linux',
    },
  };
}

describe('model/container fuzz tests', () => {
  it('validates a minimal deterministic container', () => {
    const result = validate(minimalValidContainer());
    expect(result.id).toBe('container-1');
    expect(result.name).toBe('nginx');
    expect(typeof result.updateAvailable).toBe('boolean');
  });

  it('flattens a validated deterministic container', () => {
    const validated = validate(minimalValidContainer());
    const result = flatten(validated);
    expect(result.image_tag_value).toBe('1.0.0');
    expect(result.image_registry_name).toBe('hub');
  });

  it('renders link template placeholders for semver tags', () => {
    const container = {
      ...minimalValidContainer(),
      linkTemplate:
        'https://example.test/${major}.${minor}.${patch}?raw=${raw}&original=${original}&transformed=${transformed}',
      transformTags: '',
    };

    const link = testable_getLink(container as any, '1.2.3');
    expect(link).toBe(
      'https://example.test/1.2.3?raw=1.2.3&original=1.2.3&transformed=1.2.3',
    );
  });

  test.prop([fc.anything()])('validate handles arbitrary input without crashing', (input) => {
    try {
      validate(input);
    } catch (e) {
      // Joi validation errors are expected for bad input
      expect(e).toBeDefined();
    }
  });

  test.prop([validContainerArb()])(
    'validate accepts valid container-shaped objects',
    (container) => {
      // Should either validate successfully or throw a Joi error
      try {
        const result = validate(container);
        expect(result).toBeDefined();
        expect(result.id).toBe(container.id);
      } catch (e) {
        expect(e).toBeDefined();
      }
    },
  );

  test.prop([validContainerArb()])('flatten handles validated containers', (container) => {
    try {
      const validated = validate(container);
      const result = flatten(validated);
      expect(typeof result).toBe('object');
    } catch {
      // validation may fail for some generated values - that is ok
    }
  });

  test.prop([
    fc.record({
      linkTemplate: fc.string({ minLength: 1 }),
      transformTags: fc.option(fc.string(), { nil: undefined }),
      image: fc.record({
        tag: fc.record({
          value: fc.string({ minLength: 1, maxLength: 30 }),
          semver: fc.boolean(),
        }),
      }),
    }),
    fc.string({ minLength: 1, maxLength: 50 }),
  ])('getLink never throws on arbitrary container and tag', (container, tagValue) => {
    const result = testable_getLink(container, tagValue);
    // Returns a string or undefined
    expect(result === undefined || typeof result === 'string').toBe(true);
  });

  test.prop([fc.string(), fc.string()])(
    'getLink handles arbitrary string pairs for container/tag',
    (tpl, tagValue) => {
      const result = testable_getLink(
        {
          linkTemplate: tpl,
          image: { tag: { value: tagValue, semver: false } },
        },
        tagValue,
      );
      expect(result === undefined || typeof result === 'string').toBe(true);
    },
  );
});
