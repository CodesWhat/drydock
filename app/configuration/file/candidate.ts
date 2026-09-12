import {
  configFileInterpolatedKeys,
  configFileSources,
  ddEnvVars,
  replaceSecrets,
} from '../index.js';
import { buildCandidateEnvAndDiff, ddEnvKeyToSection, RELOADABLE_SECTIONS } from './diff.js';

/** Resolve a private candidate before validation; never substitute live state across I/O. */
export async function resolveCandidateEnvAndDiff(
  fileLayer: Record<string, string>,
  interpolatedKeys: ReadonlySet<string> = new Set(),
) {
  const current = { ...ddEnvVars };
  const { candidateEnv, candidateSources } = buildCandidateEnvAndDiff(fileLayer, interpolatedKeys);
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DD_') && key.endsWith('__FILE') && value !== undefined) {
      candidateEnv[key] = value;
      candidateSources[key] = 'env';
    }
  }
  const resolvedSources = new Map(Object.entries(candidateSources));
  const resolvedInterpolatedKeys = new Set(interpolatedKeys);
  for (const key of Object.keys(candidateEnv)) {
    if (!key.endsWith('__FILE')) continue;
    const baseKey = key.slice(0, -'__FILE'.length);
    resolvedSources.set(baseKey, candidateSources[key]);
    resolvedSources.delete(key);
    if (resolvedInterpolatedKeys.delete(key)) resolvedInterpolatedKeys.add(baseKey);
  }
  try {
    await replaceSecrets(candidateEnv);
  } catch {
    throw new Error('Unable to resolve configuration secret files');
  }
  const changed = [...new Set([...Object.keys(current), ...Object.keys(candidateEnv)])]
    .filter((key) => current[key] !== candidateEnv[key])
    .sort();
  const sourceChanges = [
    ...new Set([
      ...Object.keys(configFileSources),
      ...resolvedSources.keys(),
      ...configFileInterpolatedKeys,
      ...resolvedInterpolatedKeys,
    ]),
  ].filter(
    (key) =>
      configFileSources[key] !== resolvedSources.get(key) ||
      configFileInterpolatedKeys.has(key) !== resolvedInterpolatedKeys.has(key),
  );
  const sections = new Set(
    changed.map(ddEnvKeyToSection).filter((section) => section !== undefined),
  );
  return {
    candidateEnv,
    candidateSources: Object.fromEntries(resolvedSources),
    interpolatedKeys: resolvedInterpolatedKeys,
    applyKeys: [...new Set([...changed, ...sourceChanges])].sort(),
    diff: {
      changed,
      reload: [...sections].filter((section) => RELOADABLE_SECTIONS.has(section)).sort(),
      restart: [...sections].filter((section) => !RELOADABLE_SECTIONS.has(section)).sort(),
    },
  };
}
