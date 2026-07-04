import { recordLegacyInput } from '../prometheus/compatibility.js';

interface PreferredLabelValueOptions {
  warnedFallbacks?: Set<string>;
  warn?: (message: string) => void;
  // Callers migrated from `dd.* || wud.*` (which also falls through to the
  // wud.* value on an explicit empty string) need that same behavior here,
  // not the default `??`-style "only fall through when absent" semantics.
  // Off by default so every other call site keeps its original behavior.
  treatEmptyAsAbsent?: boolean;
}

const warnedLegacyLabelFallbacks = new Set<string>();

export function getPreferredLabelValue(
  labels: Record<string, string> | undefined,
  ddKey: string,
  wudKey?: string,
  options: PreferredLabelValueOptions = {},
): string | undefined {
  const ddValue = labels?.[ddKey];
  const ddIsAbsent = ddValue === undefined || (options.treatEmptyAsAbsent && ddValue === '');
  if (!ddIsAbsent || !wudKey) {
    return ddValue;
  }

  const wudValue = labels?.[wudKey];
  if (wudValue === undefined) {
    return undefined;
  }

  recordLegacyInput('label', wudKey);
  const warned = options.warnedFallbacks ?? warnedLegacyLabelFallbacks;
  if (!warned.has(wudKey)) {
    warned.add(wudKey);
    options.warn?.(
      `Legacy Docker label "${wudKey}" is deprecated. Please migrate to "${ddKey}" before removal in v1.6.0.`,
    );
  }

  return wudValue;
}
