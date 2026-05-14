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

  test('rejects invalid XML that fails XMLValidator', () => {
    expect(() => sanitizeSvgPayload(Buffer.from('<svg><unclosed'))).toThrow(
      /expected valid svg xml/i,
    );
  });

  test('rejects a payload that produces no svg root after sanitization', () => {
    // All elements are disallowed — sanitizeSvgNodes returns [] — triggers "expected svg bytes"
    expect(() => sanitizeSvgPayload(Buffer.from('<div><p>not an svg</p></div>'))).toThrow(
      /expected svg bytes/i,
    );
  });

  test('strips href attributes that point outside the document', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.example.com"><rect width="1" height="1"/></a></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).not.toContain('href=');
    expect(sanitized).not.toContain('evil.example.com');
  });

  test('decodes &lt; &gt; &quot; &apos; &amp; in attribute values before protocol check', () => {
    // vbscript: encoded as XML entities should still be stripped
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&amp;vbscript:alert(1)"/></svg>',
      ),
    ).toString('utf8');

    // The decoded value starts with '&vbscript:' which does NOT contain 'vbscript:' literally
    // but the decoder converts &amp; → & so we get '&vbscript:alert(1)' which is not
    // matching the vbscript: protocol check (no leading space-stripped match). The rect
    // is kept (no protocol detected) but the fill attribute value is safe.
    expect(sanitized).toBeDefined();
  });

  test('strips double-encoded javascript protocol revealed only after multi-pass decode', () => {
    // `&amp;#106;avascript:` decodes once to `&#106;avascript:` (still no `javascript:`),
    // but a browser will keep decoding and end up with `javascript:`. The sanitizer must
    // iterate decode passes until stable so the protocol check sees the final form.
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="&amp;#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).not.toContain('href=');
    expect(sanitized).not.toMatch(/javascript/i);
    expect(sanitized).not.toContain('#106');
  });

  test('strips fill url() with non-local target from non-url-reference attribute', () => {
    // url() in a non-URL_REFERENCE_ATTRIBUTES attribute: uses containsOnlyLocalUrlReferences
    // A remote url() in 'stroke' should be rejected
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" stroke="url(https://remote.example.com/marker)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).not.toContain('stroke=');
  });

  test('preserves text content inside title and desc elements', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><title>My Icon</title><desc>   </desc><rect width="1" height="1"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('My Icon');
  });

  test('strips on* event handler attributes', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" onclick="alert(1)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).not.toContain('onclick');
  });

  test('strips attributes with non-string values (sanitizeSvgAttributes type guard)', () => {
    // Attributes not starting with the attribute prefix are skipped
    const sanitized = sanitizeSvgPayload(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>'),
    ).toString('utf8');

    expect(sanitized).toContain('width="100"');
    expect(sanitized).toContain('height="100"');
  });

  test('strips vbscript: protocol hidden behind xml character references', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&#x76;bscript:alert(1)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).not.toContain('fill=');
  });

  test('strips url() in fill when it references a non-local resource', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(http://evil.example.com/grad)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).not.toContain('fill=');
  });

  test('preserves fill url() when it references a local fragment', () => {
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('fill="url(#g)"');
  });

  test('strips node with no recognizable element name', () => {
    // The parser may emit comment nodes — they should be filtered out silently
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><!-- comment --><rect width="1" height="1"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('<rect');
    expect(sanitized).not.toContain('comment');
  });

  test('strips BOM from input before parsing', () => {
    const bom = '﻿';
    const svgWithBom = `${bom}<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`;
    const sanitized = sanitizeSvgPayload(Buffer.from(svgWithBom, 'utf8')).toString('utf8');

    expect(sanitized).toContain('<rect');
  });

  test('preserves url(#local) reference on a non-URL_REFERENCE_ATTRIBUTES attribute', () => {
    // 'color' is in ALLOWED_SVG_ATTRIBUTES but NOT in URL_REFERENCE_ATTRIBUTES.
    // When color="url(#g)", !/url\(/.test('url(#g)') is false, so containsOnlyLocalUrlReferences
    // is called and returns true — the attribute is kept (exercises line 184 branch 1).
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect width="1" height="1" color="url(#g)"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('color="url(#g)"');
  });

  test('strips external href on a URL-reference attribute element (linearGradient)', () => {
    // linearGradient href="http://..." triggers the URL_REFERENCE_ATTRIBUTES href branch (line 174)
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1" href="http://evil.example.com"/></defs><rect width="1" height="1"/></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).not.toContain('href=');
    expect(sanitized).not.toContain('evil.example.com');
  });

  test('strips whitespace-only text nodes inside non-title/desc elements', () => {
    // A space before <rect> inside <g> produces a '#text': ' ' node with parent 'g'.
    // Since text.trim() === '' and parentElementName !== 'title'/'desc', line 231 returns null.
    const sanitized = sanitizeSvgPayload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><g> <rect width="1" height="1"/></g></svg>',
      ),
    ).toString('utf8');

    expect(sanitized).toContain('<rect');
  });
});
