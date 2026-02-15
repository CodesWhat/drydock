import * as component from './component.js';

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  const router = component.init('registry');
  return router;
}
