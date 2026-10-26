export const expectedActionPins = new Map([
  ['actions/cache', 'actions/cache@caa296126883cff596d87d8935842f9db880ef25  # v5.1.0'],
  ['actions/checkout', 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803  # v6.1.0'],
  [
    'actions/dependency-review-action',
    'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0',
  ],
  [
    'actions/download-artifact',
    'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333  # v8.0.2',
  ],
  ['actions/setup-node', 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38  # v6.5.0'],
  [
    'actions/upload-artifact',
    'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9  # v7.0.2',
  ],
  ['nick-fields/retry', 'nick-fields/retry@ad984534de44a9489a53aefd81eb77f87c70dc60  # v4.0.0'],
]);

export function expectedActionUse(actionName: string): string {
  const pin = expectedActionPins.get(actionName);
  if (!pin) {
    throw new Error(`No expected pin configured for ${actionName}`);
  }
  return pin.split('  # ')[0];
}
