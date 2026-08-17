export const expectedActionPins = new Map([
  ['actions/cache', 'actions/cache@caa296126883cff596d87d8935842f9db880ef25  # v5.1.0'],
  ['actions/checkout', 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803  # v6.1.0'],
  [
    'actions/dependency-review-action',
    'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0',
  ],
  [
    'actions/download-artifact',
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c  # v8.0.1',
  ],
  ['actions/setup-node', 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38  # v6.5.0'],
  [
    'actions/upload-artifact',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a  # v7.0.1',
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
