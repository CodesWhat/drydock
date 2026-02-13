import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveConfiguredPathWithinBase, resolveRuntimeRoot } from '../runtime/paths.js';

export type RegistryComponentKind = 'trigger' | 'watcher' | 'registry' | 'authentication' | 'agent';

const DOCUMENTATION_LINKS: Record<RegistryComponentKind, string> = {
  trigger: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/triggers',
  watcher: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/watchers',
  registry: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/registries',
  authentication:
    'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/authentications',
  agent: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/agents',
};

export function resolveComponentRoot(kind: RegistryComponentKind, componentPath: string): string {
  const runtimeRoot = resolveRuntimeRoot();
  return resolveConfiguredPathWithinBase(runtimeRoot, componentPath, {
    label: `${kind} component path`,
  });
}

export function getAvailableProviders(
  basePath: string,
  onError?: (message: string) => void,
): string[] {
  try {
    const runtimeRoot = resolveRuntimeRoot();
    const resolvedPath = resolveConfiguredPathWithinBase(runtimeRoot, basePath, {
      label: `Provider path ${basePath}`,
    });

    return fs
      .readdirSync(resolvedPath)
      .filter((file) => {
        const filePath = path.join(resolvedPath, file);
        return fs.statSync(filePath).isDirectory();
      })
      .sort();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    onError?.(`Unable to load providers under ${basePath}: ${message}`);
    return [];
  }
}

export function resolveComponentModuleSpecifier(componentFileBase: string): string {
  const runtimeRoot = resolveRuntimeRoot();
  const componentFileRelative = path.relative(runtimeRoot, componentFileBase);
  const safeComponentFileBase = resolveConfiguredPathWithinBase(
    runtimeRoot,
    componentFileRelative,
    {
      label: 'Component module path',
    },
  );
  const jsCandidate = `${safeComponentFileBase}.js`;
  if (fs.existsSync(jsCandidate)) {
    return pathToFileURL(jsCandidate).href;
  }

  const tsCandidate = `${safeComponentFileBase}.ts`;
  if (fs.existsSync(tsCandidate)) {
    if (process.env.JEST_WORKER_ID) {
      // ts-jest resolves extensionless local modules in test mode.
      return safeComponentFileBase;
    }
    return pathToFileURL(tsCandidate).href;
  }

  return pathToFileURL(jsCandidate).href;
}

export function getHelpfulErrorMessage(
  kind: RegistryComponentKind,
  provider: string,
  error: string,
  availableProviders: string[],
): string {
  let message = `Error when registering component ${provider} (${error})`;

  if (error.includes('Cannot find module')) {
    const kindDisplay = kind.charAt(0).toUpperCase() + kind.slice(1);
    const envVarPattern = `DD_${kindDisplay.toUpperCase()}_${provider.toUpperCase()}_*`;
    const docLink = DOCUMENTATION_LINKS[kind];

    message = `Unknown ${kind} provider: '${provider}'.`;
    message += `\n  (Check your environment variables - this comes from: ${envVarPattern})`;

    if (availableProviders.length > 0) {
      message += `\n  Available ${kind} providers: ${availableProviders.join(', ')}`;
      message += `\n  For more information, visit: ${docLink}`;
    }
  }

  return message;
}
