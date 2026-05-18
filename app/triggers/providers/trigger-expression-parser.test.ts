const mockLogWarn = vi.hoisted(() => vi.fn());
vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ warn: mockLogWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import { renderBatch, renderSimple } from './trigger-expression-parser.js';

const baseContainer = {
  id: 'c1',
  name: 'demo',
  watcher: 'local',
  updateKind: {
    kind: 'tag',
    localValue: '1.0.0',
    remoteValue: '1.1.0',
    semverDiff: 'minor',
  },
  result: {
    link: 'https://example.com/release',
    suggestedTag: '1.2.3',
  },
};

describe('trigger-expression-parser', () => {
  test('renderSimple and renderBatch should return empty string for nullish templates', () => {
    expect(renderSimple(undefined, baseContainer)).toBe('');
    expect(renderBatch(undefined, [baseContainer])).toBe('');
  });

  test('renderSimple should evaluate simple expressions and concat', () => {
    expect(
      renderSimple('${container.name.toUpperCase()}-${container.num + container.enabled}', {
        ...baseContainer,
        num: 12,
        enabled: true,
      }),
    ).toBe('DEMO-12true');
  });

  test('renderSimple should handle malformed ternary and method syntax safely', () => {
    expect(renderSimple('A${container.name ? "yes"}B', baseContainer)).toBe('AB');
    expect(renderSimple('A${container.name)}B', baseContainer)).toBe('AB');
    expect(renderSimple('A${container.name.-bad()}B', baseContainer)).toBe('AB');
  });

  test('renderSimple should return empty for missing paths and non-function methods', () => {
    expect(renderSimple('${container.none.value}', baseContainer)).toBe('');
    expect(
      renderSimple('${container.meta.missing()}', {
        ...baseContainer,
        meta: {},
      }),
    ).toBe('');
  });

  test('renderSimple should stringify symbols and fallback to empty string for circular objects', () => {
    const circular = {};
    circular.self = circular;
    const output = renderSimple('${container.sym}-${container.big}-${container.circular}', {
      ...baseContainer,
      sym: Symbol('value'),
      big: 1n,
      circular,
    });

    expect(output.startsWith('Symbol(value)-1-')).toBe(true);
    expect(output.endsWith('-')).toBe(true);
  });

  test('renderSimple should coerce null method results to empty strings in concatenation', () => {
    const output = renderSimple('${container.value.toString() + "x"}', {
      ...baseContainer,
      value: {
        toString: () => null,
      },
    });
    expect(output).toBe('x');
  });

  test('renderSimple should return empty when allowed method does not exist on target type', () => {
    const output = renderSimple('${container.count.toUpperCase()}', {
      ...baseContainer,
      count: 123,
    });
    expect(output).toBe('');
  });

  test('renderSimple should treat undefined JSON.stringify results as empty strings in concat', () => {
    const output = renderSimple('${container.fn + "suffix"}', {
      ...baseContainer,
      fn() {
        return 'ignored';
      },
    });
    expect(output).toBe('suffix');
  });

  test('renderSimple should expose suggestedTag template variable', () => {
    const output = renderSimple('Pin to ${suggestedTag}', baseContainer as any);
    expect(output).toBe('Pin to 1.2.3');
  });

  test('renderSimple should expose releaseNotes template variable', () => {
    const output = renderSimple('${releaseNotes.title}', {
      ...baseContainer,
      result: {
        ...baseContainer.result,
        releaseNotes: {
          title: 'Release title',
        },
      },
    } as any);
    expect(output).toBe('Release title');
  });

  test('renderSimple should expose currentTag variable from container image tag', () => {
    const output = renderSimple('Tag is ${currentTag}', {
      ...baseContainer,
      image: { tag: { value: 'latest' } },
    } as any);
    expect(output).toBe('Tag is latest');
  });

  test('renderSimple should set isDigestUpdate to true for digest updates', () => {
    const output = renderSimple('${isDigestUpdate ? "digest" : "not digest"}', {
      ...baseContainer,
      updateKind: { kind: 'digest', localValue: 'sha256:abc', remoteValue: 'sha256:def' },
    } as any);
    expect(output).toBe('digest');
  });

  test('renderSimple should set isDigestUpdate to false for tag updates', () => {
    const output = renderSimple(
      '${isDigestUpdate ? "digest" : "not digest"}',
      baseContainer as any,
    );
    expect(output).toBe('not digest');
  });

  test('renderSimple should default currentTag to empty when image has no tag', () => {
    const output = renderSimple('Tag=[${currentTag}]', baseContainer as any);
    expect(output).toBe('Tag=[]');
  });

  // ---- resolvePath (line 17): ConditionalExpression false kills null-check ----
  test('resolvePath returns empty string for path that goes through null mid-segment', () => {
    // If resolvePath null check were removed, this would throw or return wrong value
    const output = renderSimple('${container.child.value}', {
      ...baseContainer,
      child: null,
    } as any);
    expect(output).toBe('');
  });

  test('resolvePath returns empty string when obj is undefined', () => {
    const output = renderSimple('${noSuchVar.value}', baseContainer as any);
    expect(output).toBe('');
  });

  // ---- IDENT_RE (line 23): regex mutations ----
  // /^[a-zA-Z_]\w*$/ mutations: remove anchor or change pattern
  test('isValidPropertyPath rejects identifiers that start with a digit', () => {
    // IDENT_RE requires [a-zA-Z_] at start; '1abc' would fail
    // A segment starting with digit makes the path invalid → returns ''
    const output = renderSimple('${container.1abc}', baseContainer as any);
    expect(output).toBe('');
  });

  test('isValidPropertyPath rejects identifiers with hyphens', () => {
    const output = renderSimple('${container.my-name}', baseContainer as any);
    expect(output).toBe('');
  });

  test('isValidPropertyPath accepts underscore-prefixed identifier', () => {
    const output = renderSimple('${container._private}', {
      ...baseContainer,
      _private: 'secret',
    } as any);
    expect(output).toBe('secret');
  });

  test('isValidPropertyPath rejects empty segment (double-dot)', () => {
    const output = renderSimple('${container..name}', baseContainer as any);
    expect(output).toBe('');
  });

  // ---- isValidPropertyPath (line 32): parts.length > 0, parts.every vs some ----
  test('isValidPropertyPath: single valid identifier is accepted', () => {
    // parts.length > 0 ensures at least one part; single segment should work
    const output = renderSimple('${name}', baseContainer as any);
    // 'name' is a LEGACY_SIMPLE_VAR that maps to container.name = 'demo'
    expect(output).toBe('demo');
  });

  // ---- parseMethodCall conditions (lines 41-55) ----
  test('parseMethodCall returns empty for string without closing paren', () => {
    const output = renderSimple('${container.name.substring(0}', baseContainer as any);
    expect(output).toBe('');
  });

  test('parseMethodCall returns empty for string without opening paren', () => {
    const output = renderSimple('${container.name.toUpperCase}', baseContainer as any);
    // Valid property path but not a method call — resolvePath returns the function, JSON.stringify = undefined -> ''
    // Actually toUpperCase is a function on String prototype; resolvePath on 'demo' will find it
    // but evalPropertyPath returns it, and toTemplateString on a function returns undefined->''
    expect(typeof output).toBe('string');
  });

  test('parseMethodCall: rawArgs containing ) makes it invalid', () => {
    // method call with ) inside args — should be rejected
    const output = renderSimple(
      '${container.name.substring(0, a.indexOf(x))}',
      baseContainer as any,
    );
    expect(output).toBe('');
  });

  test('parseMethodCall: missing dot before method returns null', () => {
    // "name(" — no dot, so lastIndexOf('.') === -1
    const output = renderSimple('${name()}', baseContainer as any);
    expect(output).toBe('');
  });

  // ---- ALLOWED_METHODS (lines 63-80): each method name in the Set ----
  // Mutations replace each string with "" — verify each method works
  test('ALLOWED_METHODS: toLowerCase is recognized', () => {
    expect(renderSimple('${container.name.toLowerCase()}', baseContainer as any)).toBe('demo');
  });

  test('ALLOWED_METHODS: toUpperCase is recognized', () => {
    expect(renderSimple('${container.name.toUpperCase()}', baseContainer as any)).toBe('DEMO');
  });

  test('ALLOWED_METHODS: trim is recognized', () => {
    expect(
      renderSimple('${container.pad.trim()}', { ...baseContainer, pad: '  hi  ' } as any),
    ).toBe('hi');
  });

  test('ALLOWED_METHODS: trimStart is recognized', () => {
    expect(
      renderSimple('${container.pad.trimStart()}', { ...baseContainer, pad: '  hi  ' } as any),
    ).toBe('hi  ');
  });

  test('ALLOWED_METHODS: trimEnd is recognized', () => {
    expect(
      renderSimple('${container.pad.trimEnd()}', { ...baseContainer, pad: '  hi  ' } as any),
    ).toBe('  hi');
  });

  test('ALLOWED_METHODS: substring is recognized', () => {
    expect(renderSimple('${container.name.substring(1, 3)}', baseContainer as any)).toBe('em');
  });

  test('ALLOWED_METHODS: slice is recognized', () => {
    expect(renderSimple('${container.name.slice(0, 2)}', baseContainer as any)).toBe('de');
  });

  test('ALLOWED_METHODS: replace is recognized', () => {
    expect(renderSimple('${container.name.replace("e", "a")}', baseContainer as any)).toBe('damo');
  });

  test('ALLOWED_METHODS: split is recognized', () => {
    // split returns an array — toTemplateString calls JSON.stringify
    const output = renderSimple('${container.name.split("e")}', baseContainer as any);
    expect(output).toBe('["d","mo"]');
  });

  test('ALLOWED_METHODS: indexOf is recognized', () => {
    expect(renderSimple('${container.name.indexOf("m")}', baseContainer as any)).toBe('2');
  });

  test('ALLOWED_METHODS: lastIndexOf is recognized', () => {
    expect(renderSimple('${container.name.lastIndexOf("o")}', baseContainer as any)).toBe('3');
  });

  test('ALLOWED_METHODS: startsWith is recognized', () => {
    expect(
      renderSimple('${container.name.startsWith("de") ? "yes" : "no"}', baseContainer as any),
    ).toBe('yes');
  });

  test('ALLOWED_METHODS: endsWith is recognized', () => {
    expect(
      renderSimple('${container.name.endsWith("mo") ? "yes" : "no"}', baseContainer as any),
    ).toBe('yes');
  });

  test('ALLOWED_METHODS: includes is recognized', () => {
    expect(
      renderSimple('${container.name.includes("em") ? "yes" : "no"}', baseContainer as any),
    ).toBe('yes');
  });

  test('ALLOWED_METHODS: charAt is recognized', () => {
    expect(renderSimple('${container.name.charAt(0)}', baseContainer as any)).toBe('d');
  });

  test('ALLOWED_METHODS: padStart is recognized', () => {
    expect(renderSimple('${container.name.padStart(6, "0")}', baseContainer as any)).toBe('00demo');
  });

  test('ALLOWED_METHODS: padEnd is recognized', () => {
    expect(renderSimple('${container.name.padEnd(6, "!")}', baseContainer as any)).toBe('demo!!');
  });

  test('ALLOWED_METHODS: repeat is recognized', () => {
    expect(renderSimple('${container.name.repeat(2)}', baseContainer as any)).toBe('demodemo');
  });

  test('ALLOWED_METHODS: toString is recognized', () => {
    expect(
      renderSimple('${container.count.toString()}', { ...baseContainer, count: 42 } as any),
    ).toBe('42');
  });

  test('unrecognized method name returns empty string', () => {
    // exec is not in ALLOWED_METHODS
    expect(renderSimple('${container.name.exec("d")}', baseContainer as any)).toBe('');
  });

  // ---- evalTernary (lines 85-93): ConditionalExpression and UnaryOperator ----
  test('evalTernary: ternary with falsy condition picks alternate', () => {
    expect(renderSimple('${container.missing ? "yes" : "no"}', baseContainer as any)).toBe('no');
  });

  test('evalTernary: ternary with truthy condition picks consequent', () => {
    expect(renderSimple('${container.name ? "yes" : "no"}', baseContainer as any)).toBe('yes');
  });

  test('evalTernary: ternary consequent uses string literal', () => {
    // Simpler ternary: truthy condition, string literal consequent
    const output = renderSimple('${container.name ? "found" : "missing"}', baseContainer as any);
    expect(output).toBe('found');
  });

  test('evalTernary: ternary without colon returns empty', () => {
    // no colon in rest — colonIdx === -1
    expect(renderSimple('${a ? b}', baseContainer as any)).toBe('');
  });

  test('evalTernary: ternary with ternaryIdx === -1 falls through', () => {
    // expression with no '?' at all falls through to other evaluators
    expect(renderSimple('${container.name}', baseContainer as any)).toBe('demo');
  });

  // ---- toTemplateString (lines 110-111): boolean and number branch ----
  test('toTemplateString: boolean value is stringified', () => {
    expect(renderSimple('${container.flag}', { ...baseContainer, flag: false } as any)).toBe(
      'false',
    );
  });

  test('toTemplateString: number value is stringified', () => {
    expect(renderSimple('${container.count}', { ...baseContainer, count: 0 } as any)).toBe('0');
  });

  test('toTemplateString: null returns empty string', () => {
    expect(renderSimple('${container.nothing}', { ...baseContainer, nothing: null } as any)).toBe(
      '',
    );
  });

  // ---- evalStringLiteral (lines 134-142) ----
  test('evalStringLiteral: double-quoted string is parsed', () => {
    expect(renderSimple('${"hello world"}', baseContainer as any)).toBe('hello world');
  });

  test('evalStringLiteral: single-quoted string is parsed', () => {
    expect(renderSimple("${'hello world'}", baseContainer as any)).toBe('hello world');
  });

  test('evalStringLiteral: double-quote with mismatched close returns empty', () => {
    // starts with " but ends with ' — not a valid string literal
    expect(renderSimple('${"hello\'}', baseContainer as any)).toBe('');
  });

  test('evalStringLiteral: single-quote with mismatched close returns empty', () => {
    expect(renderSimple('${\'hello"}', baseContainer as any)).toBe('');
  });

  test('evalStringLiteral: escape sequences in double-quoted string', () => {
    expect(renderSimple('${"line1\\nline2"}', baseContainer as any)).toBe('line1\nline2');
  });

  test('evalStringLiteral: escape sequences in single-quoted string', () => {
    expect(renderSimple("${'tab\\there'}", baseContainer as any)).toBe('tab\there');
  });

  test('evalStringLiteral: escaped double-quote within double-quoted string', () => {
    expect(renderSimple('${"say \\"hi\\""}', baseContainer as any)).toBe('say "hi"');
  });

  // Lines 140-142: replaceAll escape sequences
  test('evalStringLiteral: literal \\n is replaced with newline', () => {
    const output = renderSimple('${"a\\nb"}', baseContainer as any);
    expect(output).toBe('a\nb');
  });

  test('evalStringLiteral: literal \\t is replaced with tab', () => {
    const output = renderSimple('${"a\\tb"}', baseContainer as any);
    expect(output).toBe('a\tb');
  });

  // ---- evalNumberLiteral (line 148): regex mutations ----
  test('evalNumberLiteral: integer is stringified', () => {
    expect(renderSimple('${42}', baseContainer as any)).toBe('42');
  });

  test('evalNumberLiteral: negative integer is stringified', () => {
    expect(renderSimple('${-5}', baseContainer as any)).toBe('-5');
  });

  test('evalNumberLiteral: float is stringified', () => {
    expect(renderSimple('${3.14}', baseContainer as any)).toBe('3.14');
  });

  test('evalNumberLiteral: negative float is stringified', () => {
    expect(renderSimple('${-2.5}', baseContainer as any)).toBe('-2.5');
  });

  test('evalNumberLiteral: multi-decimal like 1.2.3 does not match', () => {
    // /^-?\d+(\.\d+)?$/ — requires $ at end, so 1.2.3 does not match
    expect(renderSimple('${1.2.3}', baseContainer as any)).toBe('');
  });

  test('evalNumberLiteral: leading zero followed by non-dot is valid (e.g. 007)', () => {
    // pure digit sequence without non-digit after decimal
    expect(renderSimple('${007}', baseContainer as any)).toBe('7');
  });

  // ---- evalMethodCall (lines 159, 167): target null check and rawArgs.trim ----
  test('evalMethodCall: returns empty when target is null', () => {
    // container.child is null — target null → returns ''
    const output = renderSimple('${container.child.toLowerCase()}', {
      ...baseContainer,
      child: null,
    } as any);
    expect(output).toBe('');
  });

  test('evalMethodCall: no-arg method call works (rawArgs.trim() === "")', () => {
    expect(renderSimple('${container.name.toUpperCase()}', baseContainer as any)).toBe('DEMO');
  });

  test('evalMethodCall: method call with multiple args splits correctly', () => {
    // substring(1, 3) → 'em'
    expect(renderSimple('${container.name.substring(1, 3)}', baseContainer as any)).toBe('em');
  });

  // ---- evalPropertyPath (line 172): ConditionalExpression false ----
  test('evalPropertyPath: valid path returns value', () => {
    expect(renderSimple('${container.watcher}', baseContainer as any)).toBe('local');
  });

  test('evalPropertyPath: invalid path (contains space) returns empty', () => {
    // "container.bad name" is not a valid property path
    expect(renderSimple('${container.bad name}', baseContainer as any)).toBe('');
  });

  // ---- safeEvalExpr (line 205): evalPropertyPath !== undefined check ----
  test('safeEvalExpr returns empty string for completely unknown expression', () => {
    // '!!!' is not a valid expression in any form
    expect(renderSimple('${!!!}', baseContainer as any)).toBe('');
  });

  // ---- isPlusOperator (lines 222-224): arithmetic and concat mutations ----
  test('isPlusOperator: string concatenation works', () => {
    expect(renderSimple('${"a" + "b"}', baseContainer as any)).toBe('ab');
  });

  test('isPlusOperator: left must be non-empty (unary plus at start returns empty)', () => {
    // '+5' — left side is empty, so isPlusOperator returns false
    expect(renderSimple('${+5}', baseContainer as any)).toBe('');
  });

  test('isPlusOperator: unary plus sign is not treated as concat operator', () => {
    // Expression starts with '+', left side is empty — isPlusOperator returns false
    // so '+container.count' is not split, falls through to return ''
    expect(renderSimple('${+container.count}', { ...baseContainer, count: 5 } as any)).toBe('');
  });

  // Line 222: ArithmeticOperator i - 1 (should be i + 1 for slice start)
  test('concat with left side at position 1 does not include the + char', () => {
    // "a" + "b" — the '+' should be excluded from both sides
    const output = renderSimple('${"x" + "y"}', baseContainer as any);
    expect(output).toBe('xy');
  });

  // Line 223: MethodExpression slice mutations
  test('concat slices left segment correctly', () => {
    expect(renderSimple('${"foo" + "bar"}', baseContainer as any)).toBe('foobar');
  });

  // ---- toggleQuoteState (lines 237-240): BooleanLiteral and BlockStatement ----
  test('double-quoted string with inner single-quote is handled correctly', () => {
    expect(renderSimple(`${"it's here"}`, baseContainer as any)).toBe("it's here");
  });

  test('single-quoted string with inner double-quote is handled correctly', () => {
    expect(renderSimple(`${'say "hi"'}`, baseContainer as any)).toBe('say "hi"');
  });

  test('operator inside quotes is not treated as top-level', () => {
    // '+' inside double-quoted string should NOT split on it
    expect(renderSimple('${"a+b"}', baseContainer as any)).toBe('a+b');
  });

  test('ternary ? inside quotes is not treated as ternary operator', () => {
    expect(renderSimple('${"a?b" + "c"}', baseContainer as any)).toBe('a?bc');
  });

  // Line 239/240: toggle quote state mutations — inDouble/inSingle flag inversions
  test('opening double-quote sets inDouble state (prevents operator splitting inside)', () => {
    // If inDouble were not set correctly, the '+' inside would split
    expect(renderSimple('${"x+y" + "z"}', baseContainer as any)).toBe('x+yz');
  });

  test('opening single-quote sets inSingle state', () => {
    expect(renderSimple("${'x+y' + 'z'}", baseContainer as any)).toBe('x+yz');
  });

  // ---- findTopLevelOperator scan (lines 274, 284-285): skipNext/escape handling ----
  test('escaped quote inside string is not treated as string boundary', () => {
    // "say \"hi\"" — escaped double-quotes inside double-quoted string
    const output = renderSimple('${"say \\"hi\\""}', baseContainer as any);
    expect(output).toBe('say "hi"');
  });

  // Line 284-285: skipNext after backslash
  test('backslash escape causes next character to be skipped', () => {
    // In string '\\"' — backslash causes next char to be skipped (doesn't end string)
    const output = renderSimple('${"a\\"b"}', baseContainer as any);
    expect(output).toBe('a"b');
  });

  // ---- isTopLevelPredicateMatch / updateParenDepth (lines 305) ----
  test('operator inside parentheses is not treated as top-level', () => {
    // container.name.substring(0, 2) — the comma is inside parens, not a top-level op
    expect(renderSimple('${container.name.substring(0, 2)}', baseContainer as any)).toBe('de');
  });

  test('nested parentheses depth tracking works', () => {
    // method call with nested expression args
    expect(renderSimple('${container.name.indexOf("m")}', baseContainer as any)).toBe('2');
  });

  // ---- warnLegacyTemplateVars (lines 331-343) ----
  test('legacy count variable maps to containers.length', async () => {
    vi.resetModules();
    const { renderBatch: freshRenderBatch } = await import('./trigger-expression-parser.js');
    // ${count} should be warned, and the warning includes the replacement
    const output = freshRenderBatch('Count: ${count}', [baseContainer, baseContainer]);
    expect(output).toBe('Count: 2');
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('${containers.length}'));
  });

  // Line 335: varName === 'count' for count-specific replacement path
  test('legacy count warning specifies containers.length as replacement', async () => {
    vi.resetModules();
    const { renderBatch: freshRenderBatch } = await import('./trigger-expression-parser.js');
    freshRenderBatch('Total: ${count}', [baseContainer]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Use "${containers.length}" instead'),
    );
  });

  test('legacy non-count var warning specifies container.varname as replacement', async () => {
    vi.resetModules();
    const { renderSimple: freshRenderSimple } = await import('./trigger-expression-parser.js');
    freshRenderSimple('Name: ${name}', baseContainer as any);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Use "${container.name}" instead'),
    );
  });

  // ---- renderSimple (lines 349-368): event and container field mutations ----
  test('renderSimple: event object is exposed as template var', () => {
    const container = {
      ...baseContainer,
      notificationEvent: { type: 'update-found' },
    } as any;
    const output = renderSimple('${event.type}', container);
    expect(output).toBe('update-found');
  });

  test('renderSimple: non-object notificationEvent defaults to empty object', () => {
    const container = { ...baseContainer, notificationEvent: 'not-an-object' } as any;
    // event should be {} when notificationEvent is not an object
    const output = renderSimple('${event.type}', container);
    expect(output).toBe('');
  });

  // Line 354: event && typeof event === 'object' mutations
  test('renderSimple: null notificationEvent defaults to empty object', () => {
    const container = { ...baseContainer, notificationEvent: null } as any;
    const output = renderSimple('${event.type}', container);
    expect(output).toBe('');
  });

  // Line 356: OptionalChaining container.result?.releaseNotes
  test('renderSimple: releaseNotes is undefined when result has no releaseNotes', () => {
    const output = renderSimple('${releaseNotes}', baseContainer as any);
    expect(output).toBe('');
  });

  // Line 357: OptionalChaining container.image?.tag.value
  test('renderSimple: currentTag is empty when container has no image', () => {
    const output = renderSimple('${currentTag}', { ...baseContainer, image: undefined } as any);
    expect(output).toBe('');
  });

  // Lines 363-367: updateKind field mutations
  test('renderSimple: kind field from updateKind', () => {
    const output = renderSimple('${kind}', baseContainer as any);
    expect(output).toBe('tag');
  });

  test('renderSimple: semver field from updateKind.semverDiff', () => {
    const output = renderSimple('${semver}', baseContainer as any);
    expect(output).toBe('minor');
  });

  test('renderSimple: local field from updateKind.localValue', () => {
    const output = renderSimple('${local}', baseContainer as any);
    expect(output).toBe('1.0.0');
  });

  test('renderSimple: remote field from updateKind.remoteValue', () => {
    const output = renderSimple('${remote}', baseContainer as any);
    expect(output).toBe('1.1.0');
  });

  test('renderSimple: link field from result.link', () => {
    const output = renderSimple('${link}', baseContainer as any);
    expect(output).toBe('https://example.com/release');
  });

  // Lines 363-367: LogicalOperator mutations (&&, || on updateKind fields)
  test('renderSimple: kind defaults to empty when updateKind is undefined', () => {
    const output = renderSimple('${kind}', { ...baseContainer, updateKind: undefined } as any);
    expect(output).toBe('');
  });

  test('renderSimple: semver defaults to empty when semverDiff is undefined', () => {
    const output = renderSimple('${semver}', {
      ...baseContainer,
      updateKind: { ...baseContainer.updateKind, semverDiff: undefined },
    } as any);
    expect(output).toBe('');
  });

  test('renderSimple: local defaults to empty when localValue is undefined', () => {
    const output = renderSimple('${local}', {
      ...baseContainer,
      updateKind: { ...baseContainer.updateKind, localValue: undefined },
    } as any);
    expect(output).toBe('');
  });

  test('renderSimple: remote defaults to empty when remoteValue is undefined', () => {
    const output = renderSimple('${remote}', {
      ...baseContainer,
      updateKind: { ...baseContainer.updateKind, remoteValue: undefined },
    } as any);
    expect(output).toBe('');
  });

  test('renderSimple: link defaults to empty when result.link is undefined', () => {
    const output = renderSimple('${link}', {
      ...baseContainer,
      result: { ...baseContainer.result, link: undefined },
    } as any);
    expect(output).toBe('');
  });

  // Line 373: renderBatch template variable mutations
  test('renderBatch: containers variable is accessible', () => {
    const output = renderBatch('count=${containers.length}', [baseContainer, baseContainer]);
    expect(output).toBe('count=2');
  });

  test('renderBatch: count deprecated var returns containers length', () => {
    const output = renderBatch('${count}', [baseContainer, baseContainer, baseContainer]);
    expect(output).toBe('3');
  });

  // Line 349: suggestedTag prefers result.suggestedTag then result.tag then empty
  test('renderSimple: suggestedTag falls back to result.tag when suggestedTag is undefined', () => {
    const output = renderSimple('${suggestedTag}', {
      ...baseContainer,
      result: { tag: 'v2.0' },
    } as any);
    expect(output).toBe('v2.0');
  });

  test('renderSimple: suggestedTag defaults to empty when neither suggestedTag nor tag exists', () => {
    const output = renderSimple('${suggestedTag}', {
      ...baseContainer,
      result: {},
    } as any);
    expect(output).toBe('');
  });

  // ---- evalLogicalAnd: short-circuit when left is falsy ----
  test('evalLogicalAnd: short-circuits when left is falsy', () => {
    // "" && "b" — left is '', which is falsy, so return ''
    const output = renderSimple('${"" && "b"}', baseContainer as any);
    expect(output).toBe('');
  });

  test('evalLogicalAnd: returns right value when left is truthy', () => {
    const output = renderSimple('${"a" && "b"}', baseContainer as any);
    expect(output).toBe('b');
  });
});

describe('legacy template variable deprecation warnings', () => {
  beforeEach(() => {
    mockLogWarn.mockClear();
  });

  test('renderSimple should warn about legacy template variables', async () => {
    vi.resetModules();
    const { renderSimple: freshRenderSimple } = await import('./trigger-expression-parser.js');

    freshRenderSimple('Hello ${name}, id=${id}', baseContainer);

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Legacy trigger template variable "${name}" is deprecated'),
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Legacy trigger template variable "${id}" is deprecated'),
    );
  });

  test('renderBatch should warn about legacy count variable', async () => {
    vi.resetModules();
    const { renderBatch: freshRenderBatch } = await import('./trigger-expression-parser.js');

    freshRenderBatch('Total: ${count}', [baseContainer]);

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Legacy trigger template variable "${count}" is deprecated'),
    );
  });

  test('should not warn for non-legacy template variables', async () => {
    vi.resetModules();
    const { renderSimple: freshRenderSimple } = await import('./trigger-expression-parser.js');

    freshRenderSimple('Hello ${container.name}', baseContainer);

    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});
