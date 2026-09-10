import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const uiDirectory = resolve(import.meta.dirname, '..');

function runTypecheck(directory: string) {
  return new Promise<{ code: number | null; signal: string | null; output: string }>(
    (resolve, reject) => {
      const child = spawn('npm', ['run', 'typecheck', '--', '--pretty', 'false'], {
        cwd: directory,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      // Kill the npm process group, including its shell and compiler, on timeout.
      const deadline = setTimeout(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          reject(error);
        }
      }, 25_000);
      child.on('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.on('close', (code, signal) => {
        clearTimeout(deadline);
        resolve({ code, signal, output });
      });
    },
  );
}

test.each([
  { name: 'valid script and template', script: 'row.name', template: 'row.name', valid: true },
  {
    name: 'nonexistent script property',
    script: 'row.missingScriptField',
    template: 'row.name',
    valid: false,
    missing: 'missingScriptField',
  },
  {
    name: 'nonexistent template property',
    script: 'row.name',
    template: 'row.missingTemplateField',
    valid: false,
    missing: 'missingTemplateField',
  },
])(
  'typecheck enforces $name',
  async ({ script, template, valid, missing }) => {
    const directory = await mkdtemp(join(tmpdir(), 'drydock-ui-typecheck-'));
    try {
      await mkdir(join(directory, 'src'));
      await copyFile(join(uiDirectory, 'package.json'), join(directory, 'package.json'));
      await copyFile(join(uiDirectory, 'tsconfig.json'), join(directory, 'tsconfig.json'));
      await copyFile(join(uiDirectory, 'src/env.d.ts'), join(directory, 'src/env.d.ts'));
      await symlink(join(uiDirectory, 'node_modules'), join(directory, 'node_modules'), 'dir');
      // Keep plain tsc's project nonempty so ignoring the SFC cannot fail with TS18003.
      await writeFile(join(directory, 'src/anchor.ts'), 'export const ready = true;\n');
      await writeFile(
        join(directory, 'src/Fixture.vue'),
        `<script setup lang="ts">\nconst row = { name: 'ready' };\nconst label = ${script};\n</script>\n<template>{{ label }} {{ ${template} }}</template>\n`,
      );

      const result = await runTypecheck(directory);
      expect(result.signal, result.output).toBeNull();
      expect(result.code, result.output).toBe(valid ? 0 : 2);
      if (!valid) {
        expect(result.output).toContain('src/Fixture.vue(');
        expect(result.output).toContain(`error TS2339: Property '${missing}' does not exist`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  35_000,
);
