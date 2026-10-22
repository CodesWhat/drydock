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
    max: 6,
    reason: 'approve, reject and defer action feedback',
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

function findToastCalls(rawSource: string): ToastCall[] {
  const { code: source, text } = maskSource(rawSource);
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

function usesLifecycleMessage(call: ToastCall, keys: string[]): boolean {
  if (keys.some((key) => call.args.includes(key))) return true;
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

  it('flags lifecycle keys and wording in call arguments only', () => {
    const keys = ['containersView.toast.updated'];
    expect(
      usesLifecycleMessage({ args: `t('containersView.toast.updated', { name })` }, keys),
    ).toBe(true);
    expect(usesLifecycleMessage({ args: `'Update failed for web'` }, keys)).toBe(true);
    expect(usesLifecycleMessage({ args: `'Updated policy saved'` }, keys)).toBe(false);
    expect(usesLifecycleMessage({ args: `t('approvalsView.toast.approved')` }, keys)).toBe(false);
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

  it('keeps update lifecycle outcome toasts inside the lifecycle layer', () => {
    const keys = lifecycleKeys();
    expect(keys.length).toBeGreaterThan(0);
    const hits = new Map<string, number>();
    for (const file of outside) {
      const n = findToastCalls(sources.get(file)!).filter((call) =>
        usesLifecycleMessage(call, keys),
      ).length;
      if (n > 0) hits.set(file, n);
    }
    const actual = Object.fromEntries([...hits].sort());
    const expected = Object.fromEntries(
      Object.entries(LIFECYCLE_KEY_EXEMPTIONS).map(([file, { max }]) => [file, max]),
    );
    expect(actual).toEqual(expected);
  });

  it('gives every allowlist entry a reason', () => {
    for (const entry of [...Object.values(ALLOWLIST), ...Object.values(LIFECYCLE_KEY_EXEMPTIONS)]) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
