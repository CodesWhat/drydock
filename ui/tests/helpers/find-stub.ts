import type { VueWrapper } from '@vue/test-utils';
import type { Component } from 'vue';

type StubWrapper = VueWrapper<any>;
type Finder = { findComponent: (selector: Component) => unknown };

/**
 * findComponent for locally defined stub components. @vue/test-utils 2.5.1
 * types a bare `Component` selector as a wrapper with no props, so `.props(name)`
 * rejects every key. This returns a VueWrapper that keeps `.props()` and `.vm`.
 */
export function findStub(wrapper: Finder, stub: unknown): StubWrapper {
  return wrapper.findComponent(stub as Component) as StubWrapper;
}
