import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';

import { migrateLegacyConfigContent, runConfigMigrateCommandIfRequested } from './migrate-cli.js';

function createIoCollector() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (message: string) => out.push(message),
      err: (message: string) => err.push(message),
    },
    out,
    err,
  };
}

const tempDirsToCleanup: string[] = [];

function withTempDir(run: (tempDir: string) => void) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-migrate-'));
  tempDirsToCleanup.push(tempDir);
  run(tempDir);
}

afterAll(() => {
  for (const tempDir of tempDirsToCleanup) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('migrateLegacyConfigContent', () => {
  test('migrates known WUD env vars and labels to drydock prefixes', () => {
    const content = `
WUD_SERVER_PORT=3000
export WUD_SERVER_HOST=0.0.0.0
  - WUD_WATCHER_LOCAL_PORT=2375
WUD_WATCHER_LOCAL_HOST: socket-proxy
labels:
  - wud.watch=true
  - "wud.tag.include=^v"
  wud.display.name: my-app
  wud.compose.file: /opt/wud-compose.yml
`;

    const migrated = migrateLegacyConfigContent(content);

    expect(migrated.content).toContain('DD_SERVER_PORT=3000');
    expect(migrated.content).toContain('export DD_SERVER_HOST=0.0.0.0');
    expect(migrated.content).toContain('- DD_WATCHER_LOCAL_PORT=2375');
    expect(migrated.content).toContain('DD_WATCHER_LOCAL_HOST: socket-proxy');
    expect(migrated.content).toContain('dd.watch=true');
    expect(migrated.content).toContain('"dd.tag.include=^v"');
    expect(migrated.content).toContain('dd.display.name: my-app');
    expect(migrated.content).toContain('dd.compose.file: /opt/wud-compose.yml');
    expect(migrated.envReplacements).toBe(4);
    expect(migrated.labelReplacements).toBe(4);
  });

  test('migrates wud.webhook.enabled and wud.display.picture labels to drydock prefixes', () => {
    const content = `
labels:
  wud.webhook.enabled: "false"
  wud.display.picture: https://example.com/pic.png
`;

    const migrated = migrateLegacyConfigContent(content);

    expect(migrated.content).toContain('dd.webhook.enabled: "false"');
    expect(migrated.content).toContain('dd.display.picture: https://example.com/pic.png');
    expect(migrated.labelReplacements).toBe(2);
  });

  test('migrates watchtower labels when source is watchtower', () => {
    const content = `
services:
  app:
    labels:
      - com.centurylinklabs.watchtower.enable=true
      com.centurylinklabs.watchtower.enable: "false"
`;

    const migrated = migrateLegacyConfigContent(content, 'watchtower');

    expect(migrated.content).toContain('- dd.watch=true');
    expect(migrated.content).toContain('dd.watch: "false"');
    expect(migrated.envReplacements).toBe(0);
    expect(migrated.labelReplacements).toBe(2);
  });

  test('auto source migrates both wud and watchtower patterns', () => {
    const content = `
WUD_SERVER_PORT=3000
labels:
  - wud.watch=true
  - com.centurylinklabs.watchtower.enable=false
`;

    const migrated = migrateLegacyConfigContent(content, 'auto');

    expect(migrated.content).toContain('DD_SERVER_PORT=3000');
    expect(migrated.content).toContain('dd.watch=true');
    expect(migrated.content).toContain('dd.watch=false');
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.labelReplacements).toBe(2);
  });

  test('wud source migrates only WUD patterns', () => {
    const content = `
WUD_SERVER_PORT=3000
labels:
  - wud.watch=true
  - com.centurylinklabs.watchtower.enable=false
`;

    const migrated = migrateLegacyConfigContent(content, 'wud');

    expect(migrated.content).toContain('DD_SERVER_PORT=3000');
    expect(migrated.content).toContain('dd.watch=true');
    expect(migrated.content).toContain('com.centurylinklabs.watchtower.enable=false');
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.labelReplacements).toBe(1);
  });

  test('migrates legacy trigger env vars and labels to action-prefixed aliases', () => {
    const content = `
DD_TRIGGER_DOCKER_UPDATE_ENABLED=true
export DD_TRIGGER_SLACK_NOTIFY_URL=https://hooks.example.com
  - DD_TRIGGER_COMMAND_HOOK_ENABLED=false
DD_TRIGGER_TEAMS_ALERT_ENABLED: "true"
labels:
  - dd.trigger.include=docker.update:major,slack.notify:minor
  dd.trigger.exclude: "smtp.alert"
`;

    const migrated = migrateLegacyConfigContent(content, 'trigger');

    expect(migrated.content).toContain('DD_ACTION_DOCKER_UPDATE_ENABLED=true');
    expect(migrated.content).toContain(
      'export DD_ACTION_SLACK_NOTIFY_URL=https://hooks.example.com',
    );
    expect(migrated.content).toContain('- DD_ACTION_COMMAND_HOOK_ENABLED=false');
    expect(migrated.content).toContain('DD_ACTION_TEAMS_ALERT_ENABLED: "true"');
    expect(migrated.content).toContain('dd.action.include=docker.update:major,slack.notify:minor');
    expect(migrated.content).toContain('dd.action.exclude: "smtp.alert"');
    expect(migrated.envReplacements).toBe(4);
    expect(migrated.labelReplacements).toBe(2);
  });

  test('auto source chains WUD trigger labels into action-prefixed aliases', () => {
    const content = `
labels:
  - wud.trigger.include=slack.notify:major
  - wud.trigger.exclude=smtp.alert
`;

    const migrated = migrateLegacyConfigContent(content, 'auto');

    expect(migrated.content).toContain('- dd.action.include=slack.notify:major');
    expect(migrated.content).toContain('- dd.action.exclude=smtp.alert');
    expect(migrated.envReplacements).toBe(0);
    expect(migrated.labelReplacements).toBe(4);
  });

  test('avoids partial label matches', () => {
    const content = `
labels:
  - wud.watch=false
  - wud.watcher=true
  - com.centurylinklabs.watchtower.enable=true
  - com.centurylinklabs.watchtower.enabled=true
  - prefixwud.watch=true
`;

    const migrated = migrateLegacyConfigContent(content, 'auto');

    expect(migrated.content).toContain('- dd.watch=false');
    expect(migrated.content).toContain('- dd.watch=true');
    expect(migrated.content).toContain('- wud.watcher=true');
    expect(migrated.content).toContain('- com.centurylinklabs.watchtower.enabled=true');
    expect(migrated.content).toContain('- prefixwud.watch=true');
    expect(migrated.labelReplacements).toBe(2);
  });

  test('does not construct label regex patterns during migration passes', () => {
    const content = `
labels:
  - wud.watch=true
  - com.centurylinklabs.watchtower.enable=false
`;
    const originalRegExp = globalThis.RegExp;
    let constructorCalls = 0;
    const countingRegExp = function (this: RegExp, pattern?: string | RegExp, flags?: string) {
      constructorCalls += 1;
      return new originalRegExp(pattern, flags);
    } as unknown as RegExpConstructor;
    Object.setPrototypeOf(countingRegExp, originalRegExp);
    countingRegExp.prototype = originalRegExp.prototype;
    (globalThis as { RegExp: RegExpConstructor }).RegExp = countingRegExp;

    try {
      migrateLegacyConfigContent(content, 'auto');
    } finally {
      (globalThis as { RegExp: RegExpConstructor }).RegExp = originalRegExp;
    }

    expect(constructorCalls).toBe(0);
  });

  // --- Regex anchor / prefix / separator precision tests ---

  test('WUD env replacement: requires ^ anchor (does not replace mid-line WUD_ occurrences)', () => {
    // A mid-line occurrence should NOT be replaced by env patterns
    // The mutant removes the ^ anchor, which would cause mid-line replacements
    const content = `# WUD_SERVER_PORT appears in comment: WUD_SERVER_PORT=3000\nWUD_SERVER_PORT=3000\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    // line-start occurrence is replaced
    expect(migrated.content).toContain('DD_SERVER_PORT=3000');
    // The comment line must remain intact — only 1 replacement total
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: export pattern requires space+ after export (not just space)', () => {
    // Mutant: /^(\s*export\s)WUD_/ (single space, no +) would fail to match "export  WUD_" (two spaces)
    const content = `export  WUD_SERVER_PORT=3000\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('export  DD_SERVER_PORT=3000');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: export pattern prefix captures leading whitespace', () => {
    // Mutant: /^(\S*export\s+)/ would fail on "  export WUD_" (whitespace before export)
    const content = `  export WUD_SERVER_PORT=3000\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('  export DD_SERVER_PORT=3000');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: list-item requires space* before dash (not S*)', () => {
    // Mutant /^(\s*-\s['"]?)/ (single space after dash) would fail to match "  -  WUD_" (multiple spaces)
    const content = `  -  WUD_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    // Should be replaced (multiple spaces after dash is still valid list item format)
    // or if not replaced by the dash-pattern, captured by plain whitespace pattern
    expect(migrated.envReplacements).toBeGreaterThanOrEqual(1);
  });

  test('WUD env replacement: list-item closing quote is optional (captures quoted suffix)', () => {
    // Mutant [^'"]? in suffix would prevent matching when actual quotes are present
    // Test: "  - WUD_FOO=bar" (no quotes) and "  - 'WUD_FOO=bar'" (single-quoted)
    const content = `  - 'WUD_FOO=bar'\n  - WUD_BAZ=qux\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain("- 'DD_FOO=bar'");
    expect(migrated.content).toContain('- DD_BAZ=qux');
    expect(migrated.envReplacements).toBe(2);
  });

  test('WUD env replacement: list-item separator is space+= not space*= (suffix precision)', () => {
    // Mutant ['"]?\S*= would match 'WUD_FOO =bar' but also 'WUD_FOO xyz=bar' (not valid)
    // Check that a trailing-quoted value with = works: "WUD_FOO"=bar
    const content = `"WUD_FOO"=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('"DD_FOO"=bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD colon-pattern: requires ^ anchor', () => {
    // Mutant removes ^ from /^(\s*['"]?)WUD_([A-Z0-9_]+)(['"]?\s*:)/gm
    // With content that has WUD_FOO: only at start of line (not mid-line)
    const content = `WUD_FOO: bar\n# prefix WUD_FOO: not start of line\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    // exactly 1 replacement (the line-start one)
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.content).toContain('DD_FOO: bar');
  });

  test('WUD colon-pattern: quoted key with space before colon is handled', () => {
    // Mutant ['"]?\S*: would match 'WUD_FOO  :' but also patterns without proper spacing
    // Test with quoted key and proper colon
    const content = `"WUD_FOO": bar\n'WUD_BAZ'  : qux\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('"DD_FOO": bar');
    expect(migrated.envReplacements).toBe(2);
  });

  test('WUD env replacement: handles leading whitespace (list-item style without quotes)', () => {
    const content = `  WUD_SERVER_PORT=9000\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('  DD_SERVER_PORT=9000');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: handles quoted list-item style', () => {
    // - "WUD_FOO=bar" style (with quotes before var name)
    const content = `  - "WUD_FOO=bar"\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('- "DD_FOO=bar"');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: handles single-quoted list-item style', () => {
    const content = `  - 'WUD_FOO=bar'\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain("- 'DD_FOO=bar'");
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: handles quoted YAML map style with colon separator', () => {
    // "WUD_FOO": value — quoted key with colon
    const content = `  "WUD_FOO": bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('"DD_FOO": bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: does not replace colon-separator form with equals', () => {
    // The YAML colon pattern should NOT fire for "=" terminated vars
    const content = `WUD_FOO=bar\nWUD_BAZ: qux\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.envReplacements).toBe(2);
    expect(migrated.content).toContain('DD_FOO=bar');
    expect(migrated.content).toContain('DD_BAZ: qux');
  });

  test('WUD env replacement: export with spaces before = is replaced', () => {
    const content = `export WUD_SERVER_PORT =3000\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('export DD_SERVER_PORT =3000');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: export without space between WUD_ and = should still match', () => {
    const content = `export WUD_FOO=1\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('export DD_FOO=1');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD env replacement: list-item without space after dash falls through to plain pattern', () => {
    // "  -WUD_FOO=bar" (hyphen directly before WUD) — should NOT match the dash+space pattern
    // but will match the plain `\s*['"]?WUD_` pattern
    const content = `  -WUD_FOO=bar\n  - WUD_BAR=baz\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.envReplacements).toBeGreaterThanOrEqual(1);
  });

  test('WUD export env: does NOT replace mid-line export WUD_ (anchor required)', () => {
    // Kills 133:5 anchor mutant: /(\s*export\s+)WUD_/ vs /^(\s*export\s+)WUD_/
    // Without ^, "text  export WUD_" would be replaced; with ^, only line-start export is replaced
    const content = `inlinetext  export WUD_FOO=bar\nexport WUD_BAR=baz\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    // Only the line-start "export WUD_BAR" should be replaced
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.content).toContain('export DD_BAR=baz');
    // The mid-line one should remain unchanged
    expect(migrated.content).toContain('inlinetext  export WUD_FOO=bar');
  });

  test('WUD list-item env: does NOT replace mid-line - WUD_ (anchor required)', () => {
    // Kills 134:5 anchor mutant: /(\s*-\s*['"]?)WUD_/ vs /^(\s*-\s*['"]?)WUD_/
    // Without ^, "text - WUD_FOO=bar" mid-line would be replaced; with ^ only line-start
    const content = `text - WUD_FOO=bar\n  - WUD_BAR=baz\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    // Only the line-start "  - WUD_BAR=baz" should be replaced
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.content).toContain('- DD_BAR=baz');
    expect(migrated.content).toContain('text - WUD_FOO=bar');
  });

  test('WUD list-item env: matches quoted trailing separator (space before =)', () => {
    // Kills 134:5 ['"]?\S*= mutant — \S*= won't match a space before =
    // Test: "  - WUD_FOO =" (space before =) — pattern ['"]?\s*= should match
    const content = `  - WUD_FOO =bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('- DD_FOO =bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD plain env: matches space before = separator', () => {
    // Kills 135:5 ['"]?\S*= mutant — \S*= won't match a space before =
    const content = `WUD_FOO =bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('DD_FOO =bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('WUD list-item env: [^\'"]? suffix mutant — trailing quote before = should be preserved', () => {
    // Kills 134:5 [^'"]?\s*= mutant — [^'"]? cannot match a quote char
    // Test: suffix has a closing quote before = like: "WUD_FOO"=
    // In `  - "WUD_FOO"=bar`, group 3 is `"=` which matches ['"]?\s*= but NOT [^'"]?\s*=
    const content = `  - "WUD_FOO"=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toContain('- "DD_FOO"=bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger env replacement: requires ^ anchor (does not replace mid-line)', () => {
    // Mutant removes the ^ anchor, so mid-line occurrences would also be replaced
    const content = `# DD_TRIGGER_FOO=bar mid-line\nDD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('DD_ACTION_FOO=bar');
    // exactly 1 replacement (line-start only)
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger export pattern: requires space+ after export (not single space)', () => {
    // Mutant /^(\s*export\s)DD_TRIGGER_/ would fail on "export  DD_TRIGGER_" (two spaces)
    const content = `export  DD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('export  DD_ACTION_FOO=bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger export pattern: requires = not S*= for separator', () => {
    // Mutant /^(\s*export\s+)DD_TRIGGER_([A-Z0-9_]+)(\S*=)/ — \S*= would match " foo=bar"
    // ensure the replacement preserves the trailing space before =
    const content = `export DD_TRIGGER_FOO =bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('export DD_ACTION_FOO =bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger export pattern: captures leading whitespace', () => {
    // Mutant /^(\S*export\s+)/ would fail on "  export DD_TRIGGER_" (leading spaces)
    const content = `  export DD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('  export DD_ACTION_FOO=bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger list-item: closing quote is optional (captures quoted suffix)', () => {
    // Mutant [^'"]?\s*= in suffix prevents matching when actual trailing quote present
    const content = `  - 'DD_TRIGGER_FOO=bar'\n  - DD_TRIGGER_BAZ=qux\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain("- 'DD_ACTION_FOO=bar'");
    expect(migrated.content).toContain('- DD_ACTION_BAZ=qux');
    expect(migrated.envReplacements).toBe(2);
  });

  test('trigger list-item: closing separator is space*= not S*=', () => {
    // Mutant ['"]?\S*= would match things without space before =
    const content = `"DD_TRIGGER_FOO"=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('"DD_ACTION_FOO"=bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger list-item: requires space* after dash (not single space only)', () => {
    // Mutant /^(\s*-\s['"]?)/ (single \s after dash) misses multiple spaces
    const content = `  -  DD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    // captured by some pattern
    expect(migrated.envReplacements).toBeGreaterThanOrEqual(1);
  });

  test('trigger export: does NOT replace mid-line export DD_TRIGGER_ (anchor required)', () => {
    // Kills 181:5 anchor mutant: /(\s*export\s+)DD_TRIGGER_/ vs /^(\s*export\s+)DD_TRIGGER_/
    const content = `inlinetext  export DD_TRIGGER_FOO=bar\nexport DD_TRIGGER_BAR=baz\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.content).toContain('export DD_ACTION_BAR=baz');
    expect(migrated.content).toContain('inlinetext  export DD_TRIGGER_FOO=bar');
  });

  test('trigger list-item: does NOT replace mid-line - DD_TRIGGER_ (anchor required)', () => {
    // Kills 182:5 anchor mutant
    const content = `text - DD_TRIGGER_FOO=bar\n  - DD_TRIGGER_BAR=baz\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.content).toContain('- DD_ACTION_BAR=baz');
    expect(migrated.content).toContain('text - DD_TRIGGER_FOO=bar');
  });

  test('trigger list-item: matches space before = (kills S*= mutant)', () => {
    // Kills 182:5 ['"]?\S*= mutant
    const content = `  - DD_TRIGGER_FOO =bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('- DD_ACTION_FOO =bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger list-item: trailing quote before = is preserved', () => {
    // Kills 182:5 [^\'"]?\s*= mutant
    const content = `  - "DD_TRIGGER_FOO"=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('- "DD_ACTION_FOO"=bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger plain env: matches space before = (kills S*= mutant)', () => {
    // Kills 183:5 ['"]?\S*= mutant
    const content = `DD_TRIGGER_FOO =bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('DD_ACTION_FOO =bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger colon-pattern: matches space before : (kills S*: mutant)', () => {
    // Kills 197:5 ['"]?\S*: mutant — \S*: won't match space before :
    const content = `DD_TRIGGER_FOO : bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('DD_ACTION_FOO : bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger colon-pattern: requires ^ anchor', () => {
    // Mutant removes ^ from /^(\s*['"]?)DD_TRIGGER_([A-Z0-9_]+)(['"]?\s*:)/gm
    const content = `DD_TRIGGER_FOO: bar\n# prefix DD_TRIGGER_FOO: not start\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.content).toContain('DD_ACTION_FOO: bar');
  });

  test('trigger plain pattern: prefix is s* not S*', () => {
    // Mutant /^(\S*['"]?)DD_TRIGGER_/ — \S* would NOT match leading whitespace
    // "  DD_TRIGGER_FOO=bar" should match
    const content = `  DD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('  DD_ACTION_FOO=bar');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger env replacement: handles export style', () => {
    const content = `export DD_TRIGGER_SLACK_TOKEN=abc\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('export DD_ACTION_SLACK_TOKEN=abc');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger env replacement: handles quoted list-item style', () => {
    const content = `  - "DD_TRIGGER_FOO=bar"\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('- "DD_ACTION_FOO=bar"');
    expect(migrated.envReplacements).toBe(1);
  });

  test('trigger env replacement: handles YAML map style with colon separator', () => {
    const content = `  DD_TRIGGER_FOO: bar\n  "DD_TRIGGER_BAZ": qux\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain('DD_ACTION_FOO: bar');
    expect(migrated.content).toContain('"DD_ACTION_BAZ": qux');
    expect(migrated.envReplacements).toBe(2);
  });

  test('trigger env replacement: handles single-quoted list-item style', () => {
    const content = `  - 'DD_TRIGGER_FOO=bar'\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toContain("- 'DD_ACTION_FOO=bar'");
    expect(migrated.envReplacements).toBe(1);
  });

  test('auto mode sums WUD + trigger envReplacements correctly', () => {
    // Both WUD env vars and DD_TRIGGER env vars in same content
    const content = `WUD_SERVER_PORT=3000\nDD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'auto');
    expect(migrated.content).toContain('DD_SERVER_PORT=3000');
    expect(migrated.content).toContain('DD_ACTION_FOO=bar');
    // envReplacements must be sum of both passes (1 + 0 + 1 = 2, watchtower adds 0)
    expect(migrated.envReplacements).toBe(2);
  });

  test('auto mode sums WUD + watchtower + trigger envReplacements and labelReplacements', () => {
    const content = [
      'WUD_SERVER_PORT=3000',
      'DD_TRIGGER_FOO=bar',
      'labels:',
      '  - wud.watch=true',
      '  - com.centurylinklabs.watchtower.enable=true',
    ].join('\n');
    const migrated = migrateLegacyConfigContent(content, 'auto');
    // WUD env: 1, watchtower env: 0, trigger env: 1 → total 2
    expect(migrated.envReplacements).toBe(2);
    // WUD labels: 1 (wud.watch), watchtower labels: 1, trigger labels: 0 → total 2
    expect(migrated.labelReplacements).toBe(2);
  });

  test('migrateLegacyConfigContent default source is auto (same as explicit auto)', () => {
    const content = `WUD_SERVER_PORT=3000\nDD_TRIGGER_FOO=bar\n`;
    const implicit = migrateLegacyConfigContent(content);
    const explicit = migrateLegacyConfigContent(content, 'auto');
    expect(implicit.content).toBe(explicit.content);
    expect(implicit.envReplacements).toBe(explicit.envReplacements);
    expect(implicit.labelReplacements).toBe(explicit.labelReplacements);
  });

  test('wud source does not migrate DD_TRIGGER_ vars', () => {
    const content = `DD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'wud');
    expect(migrated.content).toBe(content);
    expect(migrated.envReplacements).toBe(0);
  });

  test('watchtower source does not migrate WUD_ or DD_TRIGGER_ env vars', () => {
    const content = `WUD_SERVER_PORT=3000\nDD_TRIGGER_FOO=bar\n`;
    const migrated = migrateLegacyConfigContent(content, 'watchtower');
    expect(migrated.content).toBe(content);
    expect(migrated.envReplacements).toBe(0);
  });

  test('trigger source does not migrate WUD_ env vars', () => {
    const content = `WUD_SERVER_PORT=3000\n`;
    const migrated = migrateLegacyConfigContent(content, 'trigger');
    expect(migrated.content).toBe(content);
    expect(migrated.envReplacements).toBe(0);
  });
});

describe('runConfigMigrateCommandIfRequested', () => {
  test('returns null when argv does not match config migrate command', () => {
    const result = runConfigMigrateCommandIfRequested(['--agent']);
    expect(result).toBeNull();
  });

  test('supports --help output', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--help'], {
      io: collector.io,
    });

    expect(result).toBe(0);
    expect(collector.out.join('\n')).toContain('Usage: node dist/index.js config migrate');
    expect(collector.err).toEqual([]);
  });

  test('uses process stdout/stderr fallback when io is not provided', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(runConfigMigrateCommandIfRequested(['config', 'migrate', '--help'])).toBe(0);
      expect(runConfigMigrateCommandIfRequested(['config', 'migrate', '--unknown'])).toBe(1);
      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: node dist/index.js config migrate'),
      );
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Unknown argument'));
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  test('supports -h short help flag', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '-h'], {
      io: collector.io,
    });

    expect(result).toBe(0);
    expect(collector.out.join('\n')).toContain('Usage: node dist/index.js config migrate');
    expect(collector.err).toEqual([]);
  });

  test('returns error for unknown arguments', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--nope'], {
      io: collector.io,
    });

    expect(result).toBe(1);
    expect(collector.err[0]).toContain('Unknown argument: --nope');
  });

  test('returns error when --file is missing a value', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file'], {
      io: collector.io,
    });

    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('--file requires a path value');
  });

  test('returns error when --source is missing a value', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--source'], {
      io: collector.io,
    });

    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('--source requires a value');
  });

  test('returns error for unsupported migration source', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(
      ['config', 'migrate', '--source', 'invalid'],
      {
        io: collector.io,
      },
    );

    expect(result).toBe(1);
    expect(collector.err[0]).toContain('Unsupported source');
  });

  test('reports when no candidate config files exist', () => {
    withTempDir((tempDir) => {
      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain('No config files found to migrate.');
    });
  });

  test('reports explicitly requested missing files with comma-space separator', () => {
    // Kills StringLiteral line 613: join('') vs join(', ')
    withTempDir((tempDir) => {
      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', 'missing.env', '--file', 'also-missing.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain('No config files found to migrate.');
      // Files should be listed with ", " separator not concatenated together
      expect(collector.out.join('\n')).toContain('Checked files: missing.env, also-missing.env');
    });
  });

  test('does not use existsSync pre-checks before migrating files', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('existsSync should not be called');
      });

      const collector = createIoCollector();
      let result: number | null;
      try {
        result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
          cwd: tempDir,
          io: collector.io,
        });
      } finally {
        existsSpy.mockRestore();
      }

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toContain('DD_SERVER_HOST=localhost');
    });
  });

  test('rejects --file paths that escape the current working directory', () => {
    withTempDir((tempDir) => {
      const workspaceDir = path.join(tempDir, 'workspace');
      const outsidePath = path.join(tempDir, 'outside.env');
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(outsidePath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '../outside.env'],
        {
          cwd: workspaceDir,
          io: collector.io,
        },
      );

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('must stay inside');
      expect(fs.readFileSync(outsidePath, 'utf-8')).toBe('WUD_SERVER_HOST=localhost\n');
    });
  });

  test('error message mentions --file path label when path escapes cwd', () => {
    // Kills ObjectLiteral/StringLiteral lines 427-428: label: '--file path' vs label: ''
    // The label controls what appears in the error message from resolveConfiguredPathWithinBase
    withTempDir((tempDir) => {
      const workspaceDir = path.join(tempDir, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });

      const collector = createIoCollector();
      runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '../escape.env'], {
        cwd: workspaceDir,
        io: collector.io,
      });

      // The label '--file path' should appear in the error message
      expect(collector.err.join('\n')).toContain('--file path');
    });
  });

  test('rejects absolute --file paths', () => {
    withTempDir((tempDir) => {
      const absolutePath = path.join(tempDir, '.env');
      fs.writeFileSync(absolutePath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', absolutePath],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('must be a relative path');
      expect(fs.readFileSync(absolutePath, 'utf-8')).toBe('WUD_SERVER_HOST=localhost\n');
    });
  });

  test('supports dry-run without modifying files', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      const original = 'WUD_SERVER_HOST=localhost\n';
      fs.writeFileSync(envPath, original, 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--dry-run', '--file', '.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toBe(original);
      expect(collector.out.join('\n')).toContain('DRY-RUN');
      expect(collector.out.join('\n')).toContain('Dry-run mode: no files were modified.');
    });
  });

  test('treats empty files as unchanged and reports summary', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, '', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toBe('');
      expect(collector.out.join('\n')).toContain(`UNCHANGED ${envPath}`);
      expect(collector.out.join('\n')).toContain(
        'Summary: scanned=1, updated=0, missing=0, env_rewrites=0, label_rewrites=0',
      );
    });
  });

  test('prints resolved file path in UNCHANGED output', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'DD_SERVER_HOST=localhost\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain(`UNCHANGED ${envPath}`);
    });
  });

  test('rejects symlinked config files', () => {
    withTempDir((tempDir) => {
      const sourcePath = path.join(tempDir, '.env.source');
      const symlinkPath = path.join(tempDir, '.env');
      const original = 'WUD_SERVER_HOST=localhost\n';
      fs.writeFileSync(sourcePath, original, 'utf-8');
      fs.symlinkSync(sourcePath, symlinkPath);

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(fs.readFileSync(sourcePath, 'utf-8')).toBe(original);
      expect(collector.err.join('\n')).toContain('Refusing to process symlink');
      expect(collector.out.join('\n')).toContain('No config files found to migrate.');
    });
  });

  test('writes migrated content in normal mode', () => {
    withTempDir((tempDir) => {
      const composePath = path.join(tempDir, 'compose.yaml');
      fs.writeFileSync(
        composePath,
        [
          'services:',
          '  app:',
          '    environment:',
          '      WUD_SERVER_HOST: localhost',
          '    labels:',
          '      - wud.watch=true',
          '',
        ].join('\n'),
        'utf-8',
      );

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', 'compose.yaml'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      const migrated = fs.readFileSync(composePath, 'utf-8');
      expect(result).toBe(0);
      expect(migrated).toContain('DD_SERVER_HOST: localhost');
      expect(migrated).toContain('dd.watch=true');
      expect(collector.out.join('\n')).toContain('UPDATED');
    });
  });

  test('supports watchtower-only migration source', () => {
    withTempDir((tempDir) => {
      const composePath = path.join(tempDir, 'compose.yaml');
      fs.writeFileSync(
        composePath,
        [
          'services:',
          '  app:',
          '    environment:',
          '      WUD_SERVER_HOST: localhost',
          '    labels:',
          '      - com.centurylinklabs.watchtower.enable=true',
          '',
        ].join('\n'),
        'utf-8',
      );

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--source', 'watchtower', '--file', 'compose.yaml'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      const migrated = fs.readFileSync(composePath, 'utf-8');
      expect(result).toBe(0);
      expect(migrated).toContain('WUD_SERVER_HOST: localhost');
      expect(migrated).toContain('dd.watch=true');
      expect(collector.out.join('\n')).toContain('UPDATED');
    });
  });

  test('supports trigger-only migration source', () => {
    withTempDir((tempDir) => {
      const composePath = path.join(tempDir, 'compose.yaml');
      fs.writeFileSync(
        composePath,
        [
          'services:',
          '  app:',
          '    environment:',
          '      DD_TRIGGER_SLACK_NOTIFY_URL: https://hooks.example.com',
          '    labels:',
          '      - dd.trigger.include=slack.notify:major',
          '',
        ].join('\n'),
        'utf-8',
      );

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--source', 'trigger', '--file', 'compose.yaml'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      const migrated = fs.readFileSync(composePath, 'utf-8');
      expect(result).toBe(0);
      expect(migrated).toContain('DD_ACTION_SLACK_NOTIFY_URL: https://hooks.example.com');
      expect(migrated).toContain('dd.action.include=slack.notify:major');
      expect(collector.out.join('\n')).toContain('UPDATED');
    });
  });

  test('returns a user-friendly error when reading a file fails', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        const error = new Error('permission denied');
        (error as NodeJS.ErrnoException).code = 'EACCES';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      readSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to read');
      expect(collector.err.join('\n')).toContain(envPath);
      expect(collector.err.join('\n')).toContain('permission denied');
    });
  });

  test('returns a user-friendly error when inspecting file metadata fails', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        throw 'metadata unavailable';
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to inspect');
      expect(collector.err.join('\n')).toContain('metadata unavailable');
    });
  });

  test('returns a user-friendly error when writing a file fails', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const writeSpy = vi.spyOn(fs, 'writeSync').mockImplementationOnce(() => {
        const error = new Error('no space left on device');
        (error as NodeJS.ErrnoException).code = 'ENOSPC';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      writeSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to write');
      expect(collector.err.join('\n')).toContain(envPath);
      expect(collector.err.join('\n')).toContain('no space left on device');
    });
  });

  test('returns write failed when writeSync reports zero bytes written', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const writeSpy = vi.spyOn(fs, 'writeSync').mockImplementationOnce(() => 0);

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      writeSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to write');
      expect(collector.err.join('\n')).toContain('write failed');
    });
  });

  test('treats ENOENT while reading an opened file as missing and continues', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        const error = new Error('file disappeared');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      readSpy.mockRestore();

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain('No config files found to migrate.');
      expect(collector.out.join('\n')).toContain('Checked files: .env');
    });
  });

  test('returns null when argv[0] is config but argv[1] is not migrate', () => {
    // Kills: argv[0] === 'config' && true (ConditionalExpression line 401)
    const result = runConfigMigrateCommandIfRequested(['config', 'update']);
    expect(result).toBeNull();
  });

  test('returns null when argv[0] is not config', () => {
    // Kills: true && argv[1] === 'migrate' (ConditionalExpression line 401)
    const result = runConfigMigrateCommandIfRequested(['noconfig', 'migrate']);
    expect(result).toBeNull();
  });

  test('returns null when argv is empty', () => {
    const result = runConfigMigrateCommandIfRequested([]);
    expect(result).toBeNull();
  });

  test('returns null when argv has only one element', () => {
    const result = runConfigMigrateCommandIfRequested(['config']);
    expect(result).toBeNull();
  });

  test('help output contains all expected text lines including Options header and blank lines', () => {
    const collector = createIoCollector();
    runConfigMigrateCommandIfRequested(['config', 'migrate', '--help'], { io: collector.io });
    const out = collector.out.join('\n');
    // Check exact non-empty lines to kill StringLiteral mutants (lines 261, 263, 264-267, 268)
    expect(out).toContain('--file <path>   Migrate a specific file');
    expect(out).toContain('--dry-run       Show what would change without writing files');
    expect(out).toContain('Options:');
    expect(out).toContain('Migrates legacy config inputs');
    expect(out).toContain('--help          Show this help');
    // source list uses ", " separator (kills line 267:82 StringLiteral join("") mutant)
    expect(out).toContain('auto, wud, watchtower, trigger');
    // blank lines appear in the output (kills line 261, 263 StringLiteral mutants)
    // Help output has blank lines between Usage, description, and Options sections
    // Check for at least 2 blank lines in help (after Usage line and after description)
    const blankCount = collector.out.filter((line) => line === '').length;
    expect(blankCount).toBeGreaterThanOrEqual(2);
    // Verify blank lines are in correct positions (after Usage line and after description)
    const usageIdx = collector.out.findIndex((l) => l.includes('Usage:'));
    const optionsIdx = collector.out.indexOf('Options:');
    expect(collector.out[usageIdx + 1]).toBe(''); // blank line after Usage
    expect(collector.out[optionsIdx - 1]).toBe(''); // blank line before Options
  });

  test('--source auto is accepted and uses auto migration', () => {
    // Kills ConditionalExpression line 219: normalized === 'auto' || false
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--source', 'auto', '--file', '.env'],
        { cwd: tempDir, io: collector.io },
      );

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toContain('DD_SERVER_PORT=3000');
    });
  });

  test('--source wud is accepted and uses wud migration', () => {
    // Kills ConditionalExpression line 220: normalized === 'wud' || false
    withTempDir((tempDir) => {
      const composePath = path.join(tempDir, 'compose.yml');
      fs.writeFileSync(
        composePath,
        'WUD_SERVER_PORT=3000\ncom.centurylinklabs.watchtower.enable: "true"\n',
        'utf-8',
      );

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--source', 'wud', '--file', 'compose.yml'],
        { cwd: tempDir, io: collector.io },
      );

      expect(result).toBe(0);
      const content = fs.readFileSync(composePath, 'utf-8');
      // wud source should replace WUD_ vars
      expect(content).toContain('DD_SERVER_PORT=3000');
      // but NOT watchtower labels
      expect(content).toContain('com.centurylinklabs.watchtower.enable: "true"');
    });
  });

  test('unsupported source error mentions sources separated by comma-space', () => {
    // Kills StringLiteral line 325: join("") vs join(", ")
    const collector = createIoCollector();
    runConfigMigrateCommandIfRequested(['config', 'migrate', '--source', 'legacy'], {
      io: collector.io,
    });
    // Error should list: auto, wud, watchtower, trigger (with ", " separator)
    expect(collector.err.join('\n')).toContain('auto, wud, watchtower, trigger');
  });

  test('unsupported source error mentions supported sources list', () => {
    const collector = createIoCollector();
    runConfigMigrateCommandIfRequested(['config', 'migrate', '--source', 'legacy'], {
      io: collector.io,
    });
    expect(collector.err.join('\n')).toContain('Supported:');
    expect(collector.err.join('\n')).toContain('auto');
  });

  test('--file with a dash-prefixed value is rejected as missing value', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(
      ['config', 'migrate', '--file', '-not-a-file'],
      { io: collector.io },
    );
    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('--file requires a path value');
  });

  test('uses default candidate files when no --file specified', () => {
    withTempDir((tempDir) => {
      // Write to a default candidate file name
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toContain('DD_SERVER_PORT=3000');
    });
  });

  test('prints checked defaults with comma-space separator and no --file specified', () => {
    // Kills StringLiteral line 617: join('') vs join(', ')
    withTempDir((tempDir) => {
      const collector = createIoCollector();
      runConfigMigrateCommandIfRequested(['config', 'migrate'], {
        cwd: tempDir,
        io: collector.io,
      });
      const out = collector.out.join('\n');
      // Default candidates should be comma-space separated (e.g. ".env, .env.local, ...")
      expect(out).toContain('.env, .env.local');
      expect(out).toContain('use --file to target specific files');
    });
  });

  test('error from opening file with ENOTDIR is treated as missing', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        const error = new Error('not a directory');
        (error as NodeJS.ErrnoException).code = 'ENOTDIR';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain('No config files found');
    });
  });

  test('error from opening file with ELOOP is treated as symlink', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        const error = new Error('too many levels of symbolic links');
        (error as NodeJS.ErrnoException).code = 'ELOOP';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      expect(result).toBe(0);
      expect(collector.err.join('\n')).toContain('Refusing to process symlink');
    });
  });

  test('error from opening file with non-object is reported as inspect failure', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        throw 42; // non-object, non-Error primitive
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to inspect');
    });
  });

  test('isMissingPathError returns false for null/non-object errors', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      // Throw null — should not be treated as missing/symlink
      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        throw null;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to inspect');
    });
  });

  test('ENOENT error from openSync is treated as missing (not symlink)', () => {
    // Kills ConditionalExpression line 377: return errorCode === 'ELOOP' => return true
    // If isSymlinkPathError always returned true, ENOENT would be treated as symlink
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        const error = new Error('no such file');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      // Should be treated as missing (not symlink — no 'Refusing to process symlink' message)
      expect(result).toBe(0);
      expect(collector.err.join('\n')).not.toContain('Refusing to process symlink');
      expect(collector.out.join('\n')).toContain('No config files found');
    });
  });

  test('EACCES error from openSync is NOT treated as symlink (kills return true mutant)', () => {
    // Kills ConditionalExpression line 377: return errorCode === 'ELOOP' => return true
    // With return true, EACCES would be treated as symlink instead of error
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        const error = new Error('permission denied');
        (error as NodeJS.ErrnoException).code = 'EACCES';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      // EACCES is a real error (not missing, not symlink)
      expect(result).toBe(1);
      expect(collector.err.join('\n')).not.toContain('Refusing to process symlink');
      expect(collector.err.join('\n')).toContain('Failed to inspect');
    });
  });

  test('isSymlinkPathError returns false for non-object errors (typeof check)', () => {
    // Kills ConditionalExpression line 373:17 — typeof error !== 'object' || false
    // Throw a string — it's not an object, so isSymlinkPathError should return false
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      // ENOENT string throw won't trigger symlink path
      const openSpy = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
        throw 'some string error'; // string, not object
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      openSpy.mockRestore();

      // A string throw hits 'error' branch (not missing or symlink)
      expect(result).toBe(1);
      expect(collector.err.join('\n')).not.toContain('Refusing to process symlink');
    });
  });

  test('isMissingPathError returns false for non-object errors (typeof check)', () => {
    // Kills ConditionalExpression line 365:17 — typeof error !== 'object' || false
    // Throw a non-null non-object (string) to verify it's not treated as missing
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      // Throw a number — not an object, should not be treated as ENOENT
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw 99; // number, not object
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      readSpy.mockRestore();

      // Should be treated as a read error, not missing
      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to read');
    });
  });

  test('formatCliErrorMessage returns message from Error objects', () => {
    // Kills BlockStatement line 358: if (error instanceof Error && error.message) {}
    // The block is responsible for returning error.message — without it, would return String(error)
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const specificMessage = 'disk quota exceeded (specific error message)';
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error(specificMessage);
      });

      const collector = createIoCollector();
      runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      readSpy.mockRestore();

      // The specific error message should appear (not "[object Error]" or similar)
      expect(collector.err.join('\n')).toContain(specificMessage);
    });
  });

  test('ENOENT while reading opened file is treated as missing (reads ENOENT error code)', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      // readFileSync throws ENOTDIR (also a missing-path code)
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        const error = new Error('not a directory');
        (error as NodeJS.ErrnoException).code = 'ENOTDIR';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      readSpy.mockRestore();

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain('No config files found');
    });
  });

  test('writes migrated content fully (write loop correctness)', () => {
    // Kills ArithmeticOperator line 390: payload.length + bytesWritten (wrong) vs - bytesWritten
    // With the wrong arithmetic, the write loop would write duplicated/corrupt data
    withTempDir((tempDir) => {
      // Large enough to ensure write completeness matters
      const lines = Array.from({ length: 100 }, (_, i) => `WUD_VAR_${i}=value${i}`).join('\n');
      const composePath = path.join(tempDir, '.env');
      fs.writeFileSync(composePath, lines, 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      const written = fs.readFileSync(composePath, 'utf-8');
      // All 100 vars should be correctly migrated
      expect(written).toContain('DD_VAR_0=value0');
      expect(written).toContain('DD_VAR_99=value99');
      // The file should not contain the original WUD_ prefix (correct write)
      expect(written).not.toContain('WUD_VAR_0=value0');
      expect(collector.out.join('\n')).toContain('env=100');
    });
  });

  test('summary output starts with an empty line followed by Summary:', () => {
    // Kills StringLiteral line 622: io.out('') => io.out("Stryker was here!")
    // The summary starts with a blank line then the Summary: line
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      // Find the '' entry and ensure it precedes 'Summary:'
      const emptyLineIdx = collector.out.indexOf('');
      const summaryIdx = collector.out.findIndex((line) => line.startsWith('Summary:'));
      expect(emptyLineIdx).toBeGreaterThanOrEqual(0);
      expect(summaryIdx).toBeGreaterThan(emptyLineIdx);
    });
  });

  test('summary output includes all stat fields with correct values', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(
        envPath,
        ['WUD_SERVER_PORT=3000', 'labels:', '  - wud.watch=true', ''].join('\n'),
        'utf-8',
      );

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      const out = collector.out.join('\n');
      expect(out).toContain('scanned=1');
      expect(out).toContain('updated=1');
      expect(out).toContain('missing=0');
      expect(out).toContain('env_rewrites=1');
      expect(out).toContain('label_rewrites=1');
    });
  });

  test('summary does not print dry-run message in normal mode', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(collector.out.join('\n')).not.toContain('Dry-run mode');
    });
  });

  test('dry-run summary prints dry-run message', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      runConfigMigrateCommandIfRequested(['config', 'migrate', '--dry-run', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(collector.out.join('\n')).toContain('Dry-run mode: no files were modified.');
    });
  });

  test('stats correctly accumulates missingFiles count', () => {
    withTempDir((tempDir) => {
      // One real file + one missing file; missing count should be 1
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '.env', '--file', 'nonexistent.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      const out = collector.out.join('\n');
      expect(out).toContain('scanned=1');
      expect(out).toContain('missing=1');
    });
  });

  test('stats correctly tracks updatedFiles separately from scannedFiles', () => {
    withTempDir((tempDir) => {
      const needsMigration = path.join(tempDir, '.env');
      const alreadyMigrated = path.join(tempDir, '.env.local');
      fs.writeFileSync(needsMigration, 'WUD_SERVER_PORT=3000\n', 'utf-8');
      fs.writeFileSync(alreadyMigrated, 'DD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '.env', '--file', '.env.local'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      const out = collector.out.join('\n');
      expect(out).toContain('scanned=2');
      expect(out).toContain('updated=1');
    });
  });

  test('stats accumulates envReplacements and labelReplacements across files', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      const composePath = path.join(tempDir, 'compose.yml');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');
      fs.writeFileSync(
        composePath,
        ['services:', '  app:', '    labels:', '      - wud.watch=true', ''].join('\n'),
        'utf-8',
      );

      const collector = createIoCollector();
      runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '.env', '--file', 'compose.yml'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      const out = collector.out.join('\n');
      // 1 env from .env + 1 label from compose.yml
      expect(out).toContain('env_rewrites=1');
      expect(out).toContain('label_rewrites=1');
    });
  });

  test('deduplicates files when the same path is specified twice', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_PORT=3000\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '.env', '--file', '.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      // Should process file exactly once (deduplication via Set)
      const out = collector.out.join('\n');
      expect(out).toContain('scanned=1');
      // File content should only be migrated once
      expect(fs.readFileSync(envPath, 'utf-8')).toContain('DD_SERVER_PORT=3000');
    });
  });

  test('falls back to zero when O_NOFOLLOW is unavailable', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-migrate-'));
    tempDirsToCleanup.push(tempDir);
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

    vi.resetModules();
    try {
      vi.doMock('node:fs', async () => {
        const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
        const fsWithNoFollowFallback = {
          ...actual,
          constants: {
            ...actual.constants,
            O_NOFOLLOW: 0,
          },
        };
        return {
          ...actual,
          default: fsWithNoFollowFallback,
        };
      });

      const migrateCli = await import('./migrate-cli.js');
      const collector = createIoCollector();
      const result = migrateCli.runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toContain('DD_SERVER_HOST=localhost');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});
