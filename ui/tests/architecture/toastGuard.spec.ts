import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_SRC_ROOT = resolve(__dirname, '../../src');

// Update progress and outcomes come from the operations store; the global
// update toast turns them into terminal toasts. Everything else that emits a
// toast is direct feedback for a non-update action, or a request
// acknowledgement, and is allowlisted per file below.
const LIFECYCLE_FILES = new Set([
  'composables/useToast.ts',
  'components/AppToast.vue',
  'composables/useGlobalUpdateToast.ts',
  'stores/operations.ts',
  // The toast store is the host's backing state, not an emitter.
  'stores/toast.ts',
]);
const GLOBAL_UPDATE_TOAST = 'composables/useGlobalUpdateToast.ts';

// Ratchet: `max` is the exact current count of toast calls. Adding a call
// fails, and so does removing one without lowering the number here.
const ALLOWLIST: Record<string, { max: number; reason: string }> = {
  'components/containers/ContainerUpdateDialog.vue': {
    max: 5,
    reason:
      'dialog-local validation warnings, update request accepted/stale acknowledgements and request failure',
  },
  'views/ApprovalsView.vue': {
    max: 10,
    reason:
      'approve, reject and defer action feedback, plus bulk decision results and partial failures',
  },
  'views/DashboardView.vue': {
    max: 9,
    reason: 'update request acknowledgements and pre-flight blockers from dashboard actions',
  },
  'views/ImagesView.vue': { max: 4, reason: 'image prune feedback' },
  'views/NotificationOutboxView.vue': { max: 4, reason: 'outbox requeue and discard feedback' },
  'views/containers/useContainerActions.ts': {
    max: 31,
    reason:
      'container action feedback (start/stop/scan/recheck/delete/cancel) and update request acknowledgements and rejections',
  },
  'views/containers/useContainerBackups.ts': { max: 2, reason: 'backup rollback feedback' },
  'views/containers/useContainerPolicy.ts': { max: 2, reason: 'update policy save feedback' },
  'views/containers/useContainerPreview.ts': { max: 1, reason: 'preview request failure' },
  'views/containers/useContainerTriggers.ts': { max: 2, reason: 'trigger run feedback' },
};

// Terminal-outcome keys that only the lifecycle layer may use. These two sites
// predate the gate: they report a rejected request, not a store outcome.
const LIFECYCLE_KEY_EXEMPTIONS: Record<string, { max: number; reason: string }> = {
  'components/containers/ContainerUpdateDialog.vue': {
    max: 1,
    reason: 'update request rejected by the API, never reaches the operations store',
  },
  'views/containers/useContainerActions.ts': {
    max: 1,
    reason: 'bulk update request threw before any operation was accepted',
  },
};

// Update-lifecycle wording in a literal toast message.
const LIFECYCLE_WORDING =
  /\bupdate[ds]?\s+(has\s+|was\s+)?(started|succeeded|successful(ly)?|failed|queued|cancell?ed)\b/i;

const TOAST_METHODS = ['success', 'error', 'warning', 'warn', 'info', 'addToast'];
const METHOD_ALT = TOAST_METHODS.join('|');
// `.success(`, `.error(` ... or a computed member call such as `[kind](` / `['error'](`.
const CALLEE = `(?:\\.\\s*(?:${METHOD_ALT})|\\[[^\\]]*\\])\\s*\\(`;

const blank = (value: string) => value.replaceAll(/[^\n]/g, ' ');

// Same-length views of a source file. `text` has comments blanked (including
// Vue `<!-- -->`); `code` additionally has string and template-literal text
// blanked, so neither a `'//'` nor `"toast.error("` inside a string can skew
// matching. Indexes line up between the two.
function maskSource(source: string): { code: string; text: string } {
  let code = '';
  let text = '';
  // 'tpl' = inside a template literal; a number = brace depth inside `${ }`.
  const stack: Array<'tpl' | number> = [];
  const keep = (chunk: string) => {
    code += chunk;
    text += chunk;
  };
  const skipComment = (end: string, from: number) => {
    const close = source.indexOf(end, from);
    const stop = close === -1 ? source.length : close + end.length;
    const chunk = blank(source.slice(from, stop));
    code += chunk;
    text += chunk;
    return stop;
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const top = stack.at(-1);
    if (top === 'tpl') {
      if (ch === '\\') {
        code += blank(source.slice(i, i + 2));
        text += source.slice(i, i + 2);
        i += 2;
      } else if (ch === '`') {
        keep(ch);
        stack.pop();
        i++;
      } else if (ch === '$' && source[i + 1] === '{') {
        keep('${');
        stack.push(0);
        i += 2;
      } else {
        code += blank(ch);
        text += ch;
        i++;
      }
      continue;
    }
    if (source.startsWith('<!--', i)) {
      i = skipComment('-->', i);
    } else if (source.startsWith('/*', i)) {
      i = skipComment('*/', i);
    } else if (source.startsWith('//', i) && source[i - 1] !== ':') {
      const eol = source.indexOf('\n', i);
      const stop = eol === -1 ? source.length : eol;
      const chunk = blank(source.slice(i, stop));
      code += chunk;
      text += chunk;
      i = stop;
    } else if (ch === "'" || ch === '"') {
      keep(ch);
      i++;
      // Single-line only, so a stray apostrophe in Vue template text can't swallow the file.
      while (i < source.length && source[i] !== ch && source[i] !== '\n') {
        const width = source[i] === '\\' ? 2 : 1;
        code += blank(source.slice(i, i + width));
        text += source.slice(i, i + width);
        i += width;
      }
      if (source[i] === ch) {
        keep(ch);
        i++;
      }
    } else if (ch === '`') {
      keep(ch);
      stack.push('tpl');
      i++;
    } else {
      if (typeof top === 'number') {
        if (ch === '{') stack[stack.length - 1] = top + 1;
        else if (ch === '}') {
          if (top === 0) stack.pop();
          else stack[stack.length - 1] = top - 1;
        }
      }
      keep(ch);
      i++;
    }
  }
  return { code, text };
}

interface ToastCall {
  args: string;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Text between the parens of a call, given the index just after the `(`.
function readArgs(source: string, start: number): string {
  let depth = 1;
  let quote: string | undefined;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

function collectBindings(source: string): { objectNames: Set<string>; functionNames: Set<string> } {
  const objectNames = new Set<string>();
  const functionNames = new Set<string>();

  // const toast = useToast();  /  const notify = useToast();
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useToast\(\)/g,
  )) {
    objectNames.add(match[1]!);
  }
  // const { success, error: fail } = useToast();
  for (const match of source.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*useToast\(\)/g)) {
    for (const part of match[1]!.split(',')) {
      const [key, alias] = part.split(':').map((piece) => piece.trim());
      if (key && TOAST_METHODS.includes(key)) functionNames.add(alias || key);
    }
  }
  // const alias = toast;  (follow aliases of known toast objects)
  for (let changed = true; changed; ) {
    changed = false;
    for (const match of source.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[;\n]/g,
    )) {
      if (objectNames.has(match[2]!) && !objectNames.has(match[1]!)) {
        objectNames.add(match[1]!);
        changed = true;
      }
    }
  }
  return { objectNames, functionNames };
}

function findToastCalls(rawSource: string): ToastCall[] {
  const { code: source, text } = maskSource(rawSource);
  const { objectNames, functionNames } = collectBindings(source);

  const patterns: RegExp[] = [new RegExp(`\\buseToast\\(\\)\\s*${CALLEE}`, 'g')];
  if (objectNames.size > 0) {
    const names = [...objectNames].map(escapeRegExp).join('|');
    patterns.push(new RegExp(`\\b(?:${names})\\s*${CALLEE}`, 'g'));
  }
  if (functionNames.size > 0) {
    const names = [...functionNames].map(escapeRegExp).join('|');
    patterns.push(new RegExp(`(?<![.\\w$])(?:${names})\\s*\\(`, 'g'));
  }

  const calls: ToastCall[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      calls.push({ args: readArgs(text, match.index + match[0].length) });
    }
  }
  // Direct use of the backing store (e.g. useToastStore().add(...)).
  for (const match of source.matchAll(/\buseToastStore\(\)\s*\.\s*add\s*\(/g)) {
    calls.push({ args: readArgs(text, match.index + match[0].length) });
  }
  return calls;
}

function referencesToast(rawSource: string): boolean {
  return /from\s+['"](?:@|\.\.?)\/(?:[\w./-]*\/)?(?:composables\/useToast|stores\/toast)['"]/.test(
    maskSource(rawSource).text,
  );
}

const sourceFiles = globSync('**/*.{ts,vue}', { cwd: UI_SRC_ROOT, exclude: ['**/*.d.ts'] });
const sources = new Map(
  sourceFiles.map((file) => [file, readFileSync(resolve(UI_SRC_ROOT, file), 'utf8')]),
);

function lifecycleKeys(): string[] {
  const keys = new Set<string>();
  for (const match of maskSource(sources.get(GLOBAL_UPDATE_TOAST)!).text.matchAll(
    /\bt\(\s*['"]([\w.]+)['"]/g,
  )) {
    keys.add(match[1]!);
  }
  return [...keys].filter((key) => key.startsWith('containersView.toast.'));
}

// Outside the lifecycle layer a toast binding may only be the receiver of a
// direct call (`toast.x(...)` / `toast[k](...)`), so every emission stays
// visible to the counts above. Returns one description per offending use.
function findBindingMisuse(rawSource: string): string[] {
  const { code: original } = maskSource(rawSource);
  // Imports are fine; blank them so the bare `useToast` name is only seen in real uses.
  let code = original.replaceAll(/\bimport\b[^;]*?\bfrom\s*['"][^'"]*['"]/g, (m) => blank(m));
  const problems: string[] = [];
  const receiver = new RegExp(`^\\s*${CALLEE}`);

  // useToast() may only be bound by a declaration or be called on directly.
  for (const match of code.matchAll(/\buseToast\b(?!\s*\()/g)) {
    problems.push(`useToast referenced without being called at index ${match.index}`);
  }
  for (const match of code.matchAll(/\buseToast\s*\(\s*\)/g)) {
    const before = code.slice(0, match.index);
    const after = code.slice(match.index + match[0].length);
    const declared = /\b(?:const|let|var)\s+(?:[A-Za-z_$][\w$]*|\{[^}]*\})\s*=\s*$/.test(before);
    if (!declared && !receiver.test(after)) {
      problems.push(`useToast() used as a value at index ${match.index}`);
    }
  }

  const { objectNames, functionNames } = collectBindings(code);
  // Blank the declarations themselves, then every remaining use must be a call receiver.
  code = code.replaceAll(
    /\b(?:const|let|var)\s+(?:[A-Za-z_$][\w$]*|\{[^}]*\})\s*=\s*useToast\s*\(\s*\)/g,
    (m) => blank(m),
  );
  for (const name of objectNames) {
    const pattern = new RegExp(`(?<![.\\w$])${escapeRegExp(name)}(?![\\w$])`, 'g');
    for (const match of code.matchAll(pattern)) {
      if (!receiver.test(code.slice(match.index + name.length))) {
        problems.push(`toast binding "${name}" used as a value at index ${match.index}`);
      }
    }
  }
  for (const name of functionNames) {
    const pattern = new RegExp(`(?<![.\\w$])${escapeRegExp(name)}(?![\\w$])(?!\\s*\\()`, 'g');
    for (const match of code.matchAll(pattern)) {
      problems.push(`toast function "${name}" used as a value at index ${match.index}`);
    }
  }
  return problems;
}

function countLifecycleKeys(rawSource: string, keys: string[]): number {
  const { text } = maskSource(rawSource);
  return keys.reduce(
    (total, key) =>
      total + (text.match(new RegExp(`['"\`]${escapeRegExp(key)}['"\`]`, 'g'))?.length ?? 0),
    0,
  );
}

function usesLifecycleWording(call: ToastCall): boolean {
  const literals = call.args.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
  return literals.some((literal) => LIFECYCLE_WORDING.test(literal));
}

describe('toast architecture guard: detector', () => {
  it('flags a member call on a useToast() result', () => {
    const source = `const toast = useToast();\ntoast.success('Saved');\ntoast.error('x', 'y');`;
    expect(findToastCalls(source)).toHaveLength(2);
  });

  it('flags a call chained directly on useToast()', () => {
    expect(findToastCalls(`useToast().warning('Careful');`)).toHaveLength(1);
  });

  it('flags destructured calls, including renamed ones', () => {
    const source = `const { success, error: fail, dismissToast } = useToast();\nsuccess('a');\nfail('b');\ndismissToast(1);`;
    expect(findToastCalls(source)).toHaveLength(2);
  });

  it('flags calls through an aliased variable', () => {
    const source = `const notify = useToast();\nconst again = notify;\nnotify.info('a');\nagain.warning('b');`;
    expect(findToastCalls(source)).toHaveLength(2);
  });

  it('flags the backing store', () => {
    expect(findToastCalls(`useToastStore().add({ title: 'x' });`)).toHaveLength(1);
  });

  it('captures the message arguments', () => {
    const source = `const toast = useToast();\ntoast.error(t('a.b', { n: (1) }), msg);`;
    expect(findToastCalls(source)[0]?.args).toBe(`t('a.b', { n: (1) }), msg`);
  });

  it('ignores lookalikes that are not toasts', () => {
    const source = [
      `const logger = makeLogger();`,
      `logger.success('done');`,
      `console.error('boom');`,
      `const { error } = useSomethingElse();`,
      `error('nope');`,
      `const toastLabel = 'toast.success(x)';`,
      `function success(v: string) { return v; }`,
      `success('local helper');`,
    ].join('\n');
    expect(findToastCalls(source)).toEqual([]);
  });

  it('counts computed member calls', () => {
    const source = `const toast = useToast();\ntoast[kind]('a');\ntoast['error']('b');\nuseToast()['info']('c');`;
    expect(findToastCalls(source)).toHaveLength(3);
  });

  it('ignores Vue HTML comments', () => {
    const source = `const toast = useToast();\n<!-- toast.error('a') -->\ntoast.success('b');`;
    expect(findToastCalls(source)).toHaveLength(1);
  });

  it('ignores toast calls written inside strings and template literals', () => {
    const source = [
      `const toast = useToast();`,
      `const a = "toast.error(";`,
      `const b = 'toast.success(x)';`,
      'const c = `toast.info(${1})`;',
    ].join('\n');
    expect(findToastCalls(source)).toEqual([]);
  });

  it('still counts a real call after a string containing //', () => {
    const source = `const toast = useToast();\nconst u = '//'; toast.error('x');\nconst v = \`a//\${n}\`; toast.info('y');`;
    expect(findToastCalls(source)).toHaveLength(2);
  });

  it('keeps message arguments readable after masking strings', () => {
    const source = `const toast = useToast();\ntoast.error('Update failed // really');`;
    expect(findToastCalls(source)[0]?.args).toBe(`'Update failed // really'`);
  });

  it('ignores toast calls in comments', () => {
    const source = `const toast = useToast();\n// toast.success('a')\n/* toast.error('b') */`;
    expect(findToastCalls(source)).toEqual([]);
  });

  it('counts lifecycle keys anywhere in a file, including laundered through a variable', () => {
    const keys = ['containersView.toast.updated', 'containersView.toast.updateFailed'];
    const laundered = `const m = t('containersView.toast.updated', { name });\ntoast.success(m);`;
    expect(countLifecycleKeys(laundered, keys)).toBe(1);
    expect(countLifecycleKeys(`const k = "containersView.toast.updateFailed";`, keys)).toBe(1);
    expect(countLifecycleKeys(`t('containersView.toast.updateFailedWithReason')`, keys)).toBe(0);
    expect(countLifecycleKeys(`// t('containersView.toast.updated')`, keys)).toBe(0);
    expect(countLifecycleKeys(`t('approvalsView.toast.approved')`, keys)).toBe(0);
  });

  it('flags lifecycle wording in literal call arguments', () => {
    expect(usesLifecycleWording({ args: `'Update failed for web'` })).toBe(true);
    expect(usesLifecycleWording({ args: `'Updated policy saved'` })).toBe(false);
  });

  it.each([
    ['passed as an argument', `const toast = useToast();\nshowFailure(toast);`],
    ['put in an object', `const toast = useToast();\nhelper({ toast });`],
    ['put in an array', `const toast = useToast();\nconst all = [toast];`],
    ['returned', `const toast = useToast();\nfunction get() { return toast; }`],
    ['reassigned to another name', `const toast = useToast();\nconst other = toast;`],
    ['useToast() passed to a helper', `helper(useToast());`],
    ['useToast() returned', `function get() { return useToast(); }`],
    ['useToast passed by reference', `helper(useToast);`],
    ['destructured function passed on', `const { success } = useToast();\nhelper(success);`],
    ['aliased binding passed on', `const notify = useToast();\nrun(notify);`],
  ])('flags a toast binding %s', (_label, source) => {
    expect(findBindingMisuse(source)).not.toEqual([]);
  });

  it.each([
    ['member calls', `const toast = useToast();\ntoast.success('a');\ntoast.error('b');`],
    ['computed member calls', `const toast = useToast();\ntoast[kind]('a');\ntoast['error']('b');`],
    ['chained useToast()', `useToast().warning('a');\nuseToast()['info']('b');`],
    [
      'destructured calls',
      `const { success, error: fail } = useToast();\nsuccess('a');\nfail('b');`,
    ],
    ['an import of the composable', `import { useToast } from '../composables/useToast';`],
    ['mentions in comments and strings', `// helper(toast)\nconst s = 'helper(useToast())';`],
    ['an unrelated variable named like a field', `const x = { toast: 1 };\nfoo(x.toast);`],
  ])('allows %s', (_label, source) => {
    expect(findBindingMisuse(source)).toEqual([]);
  });

  it('detects import references to the toast composable and store', () => {
    expect(referencesToast(`import { useToast } from '../composables/useToast';`)).toBe(true);
    expect(referencesToast(`import { useToast } from '@/composables/useToast';`)).toBe(true);
    expect(referencesToast(`import { useToastStore } from '@/stores/toast';`)).toBe(true);
    expect(referencesToast(`// import { useToast } from '../composables/useToast';`)).toBe(false);
  });
});

describe('toast architecture guard: ui/src', () => {
  const counts = new Map<string, number>();
  const outside = sourceFiles.filter((file) => !LIFECYCLE_FILES.has(file));
  for (const file of outside) {
    const source = sources.get(file)!;
    const calls = findToastCalls(source);
    if (calls.length > 0 || referencesToast(source)) counts.set(file, calls.length);
  }

  it('only allowlisted files emit or import toasts outside the lifecycle layer', () => {
    const offenders = [...counts.keys()].filter((file) => !(file in ALLOWLIST));
    expect(offenders).toEqual([]);
  });

  it('keeps each allowlisted file at exactly its recorded count', () => {
    const drift = Object.entries(ALLOWLIST)
      .map(([file, { max }]) => ({ file, max, actual: counts.get(file) ?? 0 }))
      .filter(({ max, actual }) => actual !== max);
    expect(drift).toEqual([]);
  });

  it('hands toast bindings to nobody outside the lifecycle layer', () => {
    const offenders = outside.flatMap((file) =>
      findBindingMisuse(sources.get(file)!).map(
        (problem) => `${file}: ${problem}. Call toast where the binding is created instead.`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps update lifecycle outcome keys inside the lifecycle layer', () => {
    const keys = lifecycleKeys();
    expect(keys.length).toBeGreaterThan(0);
    const hits: Record<string, number> = {};
    for (const file of outside) {
      const n = countLifecycleKeys(sources.get(file)!, keys);
      if (n > 0) hits[file] = n;
    }
    const expected = Object.fromEntries(
      Object.entries(LIFECYCLE_KEY_EXEMPTIONS).map(([file, { max }]) => [file, max]),
    );
    expect(hits).toEqual(expected);
  });

  it('keeps update lifecycle wording out of toast messages outside the lifecycle layer', () => {
    const offenders = outside.filter((file) =>
      findToastCalls(sources.get(file)!).some(usesLifecycleWording),
    );
    expect(offenders).toEqual([]);
  });

  it('gives every allowlist entry a reason', () => {
    for (const entry of [...Object.values(ALLOWLIST), ...Object.values(LIFECYCLE_KEY_EXEMPTIONS)]) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
