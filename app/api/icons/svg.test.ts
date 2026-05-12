import { sanitizeSvgPayload } from './svg.js';

describe('icons/svg', () => {
  test('strips javascript protocol values hidden behind xml character references', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="url(&#x6a;ava&#x73;cript&#58;alert(1))"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('<rect width="1" height="1"/>');
    expect(sanitized).not.toContain('fill=');
    expect(sanitized).not.toMatch(/javascript/i);
  });

  test('strips data protocol values from fill attributes', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('<rect width="1" height="1"/>');
    expect(sanitized).not.toContain('fill=');
    expect(sanitized).not.toMatch(/data:/i);
  });

  test('strips non-local url references from clip path attributes', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" clip-path="url(https://example.com/clip.svg#shape)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('<rect width="1" height="1"/>');
    expect(sanitized).not.toContain('clip-path=');
    expect(sanitized).not.toContain('https://example.com');
  });

  test('rejects svg payloads with doctypes', () => {
    expect(() =>
      sanitizeSvgPayload(
        Buffer.from(
          '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><title>&xxe;</title></svg>',
        ),
      ),
    ).toThrow(/doctype is not supported/i);
  });

  test('strips disallowed foreign object elements and their children', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="1" height="1"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject><rect width="1" height="1"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('<rect width="1" height="1"/>');
    expect(sanitized).not.toContain('foreign');
    expect(sanitized).not.toContain('script');
    expect(sanitized).not.toContain('alert');
  });

  test('round trips viewBox with camel case output', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>'),
    ).toString('utf8');

    expect(sanitized).toContain('viewBox="0 0 24 24"');
    expect(sanitized).not.toContain('viewbox=');
  });

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
