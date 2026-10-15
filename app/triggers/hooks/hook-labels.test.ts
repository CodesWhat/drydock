import { isHookLabelKey } from './hook-labels.js';

describe('isHookLabelKey', () => {
  test.each(['dd.hook.pre', 'dd.hook.post', 'dd.hook.pre.abort', 'dd.hook.timeout'])(
    'treats %s as a lifecycle hook label',
    (key) => {
      expect(isHookLabelKey(key)).toBe(true);
    },
  );

  test.each([
    'dd.watch',
    'dd.hook',
    'dd.hooks.pre',
    'wud.hook.pre',
    'DD.HOOK.PRE',
    'x.dd.hook.pre',
    '',
  ])('does not treat %s as a lifecycle hook label', (key) => {
    expect(isHookLabelKey(key)).toBe(false);
  });
});
