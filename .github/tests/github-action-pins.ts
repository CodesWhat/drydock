export const expectedActionPins = new Map([
  ['actions/cache', 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9  # v6.1.0'],
  ['actions/checkout', 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1'],
  [
    'actions/dependency-review-action',
    'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0',
  ],
  [
    'actions/download-artifact',
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c  # v8.0.1',
  ],
  ['actions/setup-node', 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020  # v7.0.0'],
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
