import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

const SVG_ATTRIBUTE_PREFIX = '@_';
const SVG_ATTRIBUTES_KEY = ':@';
const SVG_TEXT_KEY = '#text';
const MAX_UNICODE_CODE_POINT = 0x10ffff;

const ALLOWED_SVG_ELEMENTS = new Set([
  'svg',
  'title',
  'desc',
  'defs',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
]);

const ALLOWED_SVG_ATTRIBUTES = new Set([
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'class',
  'clip-path',
  'clip-rule',
  'color',
  'cx',
  'cy',
  'd',
  'fill',
  'fill-opacity',
  'fill-rule',
  'focusable',
  'gradienttransform',
  'gradientunits',
  'height',
  'href',
  'id',
  'mask',
  'offset',
  'opacity',
  'points',
  'preserveaspectratio',
  'r',
  'role',
  'rx',
  'ry',
  'spreadmethod',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'transform',
  'version',
  'viewbox',
  'width',
  'x',
  'x1',
  'x2',
  'xmlns',
  'xmlns:xlink',
  'y',
  'y1',
  'y2',
]);

const SVG_ATTRIBUTE_OUTPUT_NAMES = new Map([
  ['gradienttransform', 'gradientTransform'],
  ['gradientunits', 'gradientUnits'],
  ['preserveaspectratio', 'preserveAspectRatio'],
  ['spreadmethod', 'spreadMethod'],
  ['viewbox', 'viewBox'],
]);

const URL_REFERENCE_ATTRIBUTES = new Set(['clip-path', 'fill', 'href', 'mask', 'stroke']);

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: SVG_ATTRIBUTE_PREFIX,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  commentPropName: '#comment',
  allowBooleanAttributes: false,
});

const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: SVG_ATTRIBUTE_PREFIX,
  format: false,
  suppressEmptyNode: true,
});

type SvgNode = Record<string, unknown>;

const MAX_DECODE_PASSES = 5;

function decodeXmlCharacterReferencesOnce(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);?/giu, (_match, codePointHex: string) => {
      const codePoint = Number.parseInt(codePointHex, 16);
      // c8 ignore next 3: XMLParser pre-processes entities; out-of-range code points are unreachable via parser output
      /* c8 ignore next 3 */
      return Number.isInteger(codePoint) && codePoint <= MAX_UNICODE_CODE_POINT
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&#([0-9]+);?/gu, (_match, codePointDecimal: string) => {
      const codePoint = Number.parseInt(codePointDecimal, 10);
      // c8 ignore next 3: XMLParser pre-processes entities; out-of-range code points are unreachable via parser output
      /* c8 ignore next 3 */
      return Number.isInteger(codePoint) && codePoint <= MAX_UNICODE_CODE_POINT
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&(?:colon);/giu, ':')
    .replace(/&(?:tab);/giu, '\t')
    .replace(/&(?:newline);/giu, '\n')
    .replace(/&(?:amp);/giu, '&')
    .replace(/&(?:lt);/giu, '<')
    .replace(/&(?:gt);/giu, '>')
    .replace(/&(?:quot);/giu, '"')
    .replace(/&(?:apos);/giu, "'");
}

// Iterate decoding until the output is stable so multi-pass encodings like
// `&amp;#106;avascript:` (which a browser will fully decode to `javascript:`)
// can't slip past the protocol check after a single decode pass.
function decodeXmlCharacterReferences(value: string) {
  let current = value;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    const next = decodeXmlCharacterReferencesOnce(current);
    if (next === current) {
      return next;
    }
    current = next;
  }
  return current;
}

function containsUnsafeProtocol(value: string) {
  const decodedValue = Array.from(decodeXmlCharacterReferences(value))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 0x20;
    })
    .join('')
    .toLowerCase();
  return (
    decodedValue.includes('javascript:') ||
    decodedValue.includes('data:') ||
    decodedValue.includes('vbscript:')
  );
}

function containsOnlyLocalUrlReferences(value: string) {
  const decodedValue = decodeXmlCharacterReferences(value);
  const urlReferences = decodedValue.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/giu);
  for (const urlReference of urlReferences) {
    if (!urlReference[2]?.trim().startsWith('#')) {
      return false;
    }
  }
  return true;
}

function isSafeSvgAttributeValue(attributeName: string, attributeValue: unknown) {
  // c8 ignore next 3: fast-xml-parser always produces string attribute values; defensive guard
  /* c8 ignore next 3 */
  if (typeof attributeValue !== 'string') {
    return false;
  }
  if (containsUnsafeProtocol(attributeValue)) {
    return false;
  }
  if (URL_REFERENCE_ATTRIBUTES.has(attributeName)) {
    if (attributeName === 'href' && !attributeValue.startsWith('#')) {
      return false;
    }
    return containsOnlyLocalUrlReferences(attributeValue);
  }
  return !/url\(/iu.test(attributeValue) || containsOnlyLocalUrlReferences(attributeValue);
}

function sanitizeSvgAttributes(attributes: unknown) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return undefined;
  }

  const sanitizedAttributes: Record<string, string> = {};
  for (const [rawAttributeName, attributeValue] of Object.entries(attributes)) {
    // c8 ignore next 3: fast-xml-parser always prefixes attribute keys with @_; defensive guard
    /* c8 ignore next 3 */
    if (!rawAttributeName.startsWith(SVG_ATTRIBUTE_PREFIX)) {
      continue;
    }

    const attributeName = rawAttributeName.slice(SVG_ATTRIBUTE_PREFIX.length);
    const normalizedAttributeName = attributeName.toLowerCase();
    if (
      normalizedAttributeName.startsWith('on') ||
      !ALLOWED_SVG_ATTRIBUTES.has(normalizedAttributeName) ||
      !isSafeSvgAttributeValue(normalizedAttributeName, attributeValue)
    ) {
      continue;
    }

    const outputAttributeName =
      SVG_ATTRIBUTE_OUTPUT_NAMES.get(normalizedAttributeName) ?? normalizedAttributeName;
    sanitizedAttributes[`${SVG_ATTRIBUTE_PREFIX}${outputAttributeName}`] = attributeValue;
  }

  return Object.keys(sanitizedAttributes).length > 0 ? sanitizedAttributes : undefined;
}

function getSvgNodeElementName(node: SvgNode) {
  return Object.keys(node).find((key) => key !== SVG_ATTRIBUTES_KEY);
}

function sanitizeSvgNode(node: unknown, parentElementName?: string): SvgNode | null {
  // c8 ignore next 3: parser always emits plain objects in the nodes array; defensive guard
  /* c8 ignore next 3 */
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return null;
  }

  const svgNode = node as SvgNode;
  const elementName = getSvgNodeElementName(svgNode);
  // c8 ignore next 3: fast-xml-parser with preserveOrder:true always produces a named key; defensive guard
  /* c8 ignore next 3 */
  if (!elementName) {
    return null;
  }

  if (elementName === SVG_TEXT_KEY) {
    const text = svgNode[SVG_TEXT_KEY];
    // c8 ignore next 3: fast-xml-parser always sets string values for text nodes; defensive guard
    /* c8 ignore next 3 */
    if (typeof text !== 'string') {
      return null;
    }
    if (parentElementName !== 'title' && parentElementName !== 'desc' && text.trim() === '') {
      return null;
    }
    return { [SVG_TEXT_KEY]: text };
  }

  const normalizedElementName = elementName.toLowerCase();
  if (!ALLOWED_SVG_ELEMENTS.has(normalizedElementName)) {
    return null;
  }

  // c8 ignore next 3: fast-xml-parser with preserveOrder:true always puts children in an array; defensive guard
  /* c8 ignore next 3 */
  const children = Array.isArray(svgNode[elementName])
    ? sanitizeSvgNodes(svgNode[elementName], normalizedElementName)
    : [];
  const sanitizedNode: SvgNode = {
    [normalizedElementName]: children,
  };
  const sanitizedAttributes = sanitizeSvgAttributes(svgNode[SVG_ATTRIBUTES_KEY]);
  if (sanitizedAttributes) {
    sanitizedNode[SVG_ATTRIBUTES_KEY] = sanitizedAttributes;
  }
  return sanitizedNode;
}

function sanitizeSvgNodes(nodes: unknown[], parentElementName?: string) {
  return nodes
    .map((node) => sanitizeSvgNode(node, parentElementName))
    .filter((node): node is SvgNode => node !== null);
}

function sanitizeSvgPayload(payload: Buffer) {
  const svgText = payload
    .toString('utf8')
    .replace(/^\uFEFF/u, '')
    .trim();
  if (/<!doctype/i.test(svgText)) {
    throw new Error('Invalid icon payload: svg doctype is not supported');
  }

  const validationResult = XMLValidator.validate(svgText, { allowBooleanAttributes: false });
  if (validationResult !== true) {
    throw new Error('Invalid icon payload: expected valid svg xml');
  }

  const parsedSvg = parser.parse(svgText);
  // c8 ignore next 3: XMLParser with preserveOrder:true always returns an array; defensive guard
  /* c8 ignore next 3 */
  if (!Array.isArray(parsedSvg)) {
    throw new Error('Invalid icon payload: expected svg bytes');
  }

  const sanitizedNodes = sanitizeSvgNodes(parsedSvg);
  if (sanitizedNodes.length !== 1 || !Object.hasOwn(sanitizedNodes[0], 'svg')) {
    throw new Error('Invalid icon payload: expected svg bytes');
  }

  return Buffer.from(builder.build(sanitizedNodes), 'utf8');
}

export { sanitizeSvgPayload };
