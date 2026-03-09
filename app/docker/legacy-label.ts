import { recordLegacyInput } from '../prometheus/compatibility.js';

interface PreferredLabelValueOptions {
  warnedFallbacks?: Set<string>;
  warn?: (message: string) => void;
}

const warnedLegacyLabelFallbacks = new Set<string>();

export function getPreferredLabelValue(
  labels: Record<string, string> | undefined,
  ddKey: string,
  wudKey?: string,
  options: PreferredLabelValueOptions = {},
): string | undefined {
  const ddValue = labels?.[ddKey];
  if (ddValue !== undefined || !wudKey) {
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
