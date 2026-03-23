import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');

/**
 * Components registered globally in main.ts — these never need local imports.
 * Keep this list in sync with app.component() calls in src/main.ts.
 */
const GLOBAL_COMPONENTS = new Set([
  'AppButton',
  'AppIcon',
  'AppLayout',
  'AppToast',
  'ConfirmDialog',
  'ContainerIcon',
  'CopyableTag',
  'DataCardGrid',
  'DataFilterBar',
  'DataListAccordion',
  'DataTable',
  'DataViewLayout',
  'DetailPanel',
  'EmptyState',
  'ThemeToggle',
  'ToggleSwitch',
  // Vue built-ins
  'RouterLink',
  'RouterView',
  'Teleport',
  'Transition',
  'TransitionGroup',
  'KeepAlive',
  'Suspense',
  'Component',
]);

function collectVueFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectVueFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractTemplate(source: string): string {
  const match = /<template\b[^>]*>([\s\S]*)<\/template>/.exec(source);
  return match?.[1] ?? '';
}

function extractScriptImports(source: string): Set<string> {
  const imports = new Set<string>();
  const defaultImportRe = /import\s+(\w+)\s+from\s+/g;
  const namedImportRe = /import\s+\{([^}]+)\}\s+from\s+/g;
  let match: RegExpExecArray | null;
  while ((match = defaultImportRe.exec(source)) !== null) {
    imports.add(match[1]);
  }
  while ((match = namedImportRe.exec(source)) !== null) {
    for (const name of match[1].split(',')) {
      const trimmed = name
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (trimmed) imports.add(trimmed);
    }
  }
  return imports;
}

function extractTemplateComponents(template: string): Set<string> {
  const components = new Set<string>();
  // Match PascalCase component tags: <AppButton, <StatusDot, etc.
  // Requires at least 2 uppercase-starting words to avoid matching HTML like <Select>
  const tagRe = /<([A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(template)) !== null) {
    components.add(match[1]);
  }
  return components;
}

describe('component imports', () => {
  it('every component used in a template is either imported or globally registered', () => {
    const vueFiles = collectVueFiles(SRC_DIR);
    const offenders: string[] = [];

    for (const filePath of vueFiles) {
      const relPath = relative(process.cwd(), filePath).replaceAll('\\', '/');
      const source = readFileSync(filePath, 'utf8');
      const template = extractTemplate(source);
      if (!template) continue;

      const imports = extractScriptImports(source);
      const usedComponents = extractTemplateComponents(template);

      for (const comp of usedComponents) {
        if (GLOBAL_COMPONENTS.has(comp)) continue;
        if (imports.has(comp)) continue;
        // Skip self-references (component name matches filename)
        const fileName = filePath.split('/').pop()?.replace('.vue', '');
        if (fileName === comp) continue;

        offenders.push(`${relPath}: <${comp}> used but not imported`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
