import { sanitizeSvgPayload } from './svg.js';

describe('icons/svg', () => {
  test('keeps modern local href references and strips legacy xlink href attributes', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="source"><stop offset="0" stop-color="#fff"/></linearGradient><linearGradient id="modern" href="#source"/><linearGradient id="legacy" xlink:href="#source"/></defs><rect width="1" height="1" fill="url(#modern)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain(' href="#source"');
    expect(sanitized).not.toContain('xlink:href');
  });
});
