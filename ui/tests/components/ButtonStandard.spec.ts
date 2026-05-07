import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');

const ALLOWED_RAW_BUTTON_FILES = new Set([
  'src/components/AppButton.vue',
  'src/components/AppIconButton.vue',
  'src/components/AppTabBar.vue',
  'src/components/ThemeToggle.vue',
  'src/components/ToggleSwitch.vue',
]);

function getVisibleText(source: string): string {
  const dom = new JSDOM(`<body>${source}</body>`);
  const { document, Node } = dom.window;

  function isTemplateElement(node: Node): node is HTMLTemplateElement {
    return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'TEMPLATE';
  }

  function collectText(node: Node): string {
    let text = '';

    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      if (isTemplateElement(child)) {
        text += collectText(child.content);
        continue;
      }

      text += collectText(child);
    }

    return text;
  }

  return collectText(document.body).replace(/\s+/g, '').trim();
}

function collectVueFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectVueFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('button standard', () => {
  it('uses AppButton as the shared button primitive across Vue templates', () => {
    const vueFiles = collectVueFiles(SRC_DIR);
    const offenders: string[] = [];

    for (const filePath of vueFiles) {
      const relPath = relative(process.cwd(), filePath).replaceAll('\\', '/');
      if (ALLOWED_RAW_BUTTON_FILES.has(relPath)) {
        continue;
      }

      const source = readFileSync(filePath, 'utf8');
      if (/<button\b/.test(source)) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('uses AppIconButton for standalone icon-only AppButton interactions', () => {
    const vueFiles = collectVueFiles(SRC_DIR);
    const offenders: string[] = [];

    for (const filePath of vueFiles) {
      const relPath = relative(process.cwd(), filePath).replaceAll('\\', '/');
      const source = readFileSync(filePath, 'utf8');
      const buttonBlocks: string[] = source.match(/<AppButton\b[\s\S]*?<\/AppButton>/g) ?? [];
      const hasIconOnlyAppButton = buttonBlocks.some((block) => {
        const inner = block.replace(/^<AppButton\b[\s\S]*?>/, '').replace(/<\/AppButton>$/, '');

        if (!/<AppIcon\b/.test(inner)) {
          return false;
        }

        const visibleContent = getVisibleText(inner);
        return visibleContent.length === 0;
      });

      if (hasIconOnlyAppButton) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps container AppButtons on shared size variants', () => {
    const vueFiles = collectVueFiles(join(SRC_DIR, 'components/containers'));
    const offenders: string[] = [];

    for (const filePath of vueFiles) {
      const relPath = relative(process.cwd(), filePath).replaceAll('\\', '/');
      const source = readFileSync(filePath, 'utf8');
      const buttonBlocks: string[] = source.match(/<AppButton\b[\s\S]*?<\/AppButton>/g) ?? [];
      const hasUnspecifiedSizeButton = buttonBlocks.some((block) =>
        /\bsize=["']none["']/.test(block),
      );

      if (hasUnspecifiedSizeButton) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps dashboard and security AppButtons on shared size variants', () => {
    const targetFiles = [
      ...collectVueFiles(join(SRC_DIR, 'views/dashboard')),
      join(SRC_DIR, 'views/SecurityView.vue'),
    ];
    const offenders: string[] = [];

    for (const filePath of targetFiles) {
      const relPath = relative(process.cwd(), filePath).replaceAll('\\', '/');
      const source = readFileSync(filePath, 'utf8');
      const buttonBlocks: string[] = source.match(/<AppButton\b[\s\S]*?<\/AppButton>/g) ?? [];
      const hasUnspecifiedSizeButton = buttonBlocks.some((block) =>
        /\bsize=["']none["']/.test(block),
      );

      if (hasUnspecifiedSizeButton) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
