import type Joi from 'joi';
import { RE2JS } from 're2js';
import { getErrorMessage } from '../../../util/error.js';

export interface ContainerWatchFilterConfiguration {
  containers?: { include?: string; exclude?: string };
  labels?: { include?: string; exclude?: string };
}

interface CompiledRule {
  matches(names: string[], labels: Record<string, string>): boolean;
}

export interface ContainerWatchFilter {
  include: CompiledRule[];
  exclude: CompiledRule[];
}

function compile(pattern: string): RE2JS {
  try {
    return RE2JS.compile(pattern);
  } catch (error: unknown) {
    throw new Error(`Invalid regular expression "${pattern}": ${getErrorMessage(error)}`);
  }
}

/** Joi custom validator: the container name regex must compile with RE2. */
export function validateContainerFilterPattern(pattern: string): string {
  compile(pattern);
  return pattern;
}

function splitLabelPattern(pattern: string): { key: string; valuePattern?: string } {
  const separator = pattern.indexOf('=');
  if (separator === -1) {
    return { key: pattern };
  }
  return { key: pattern.slice(0, separator), valuePattern: pattern.slice(separator + 1) };
}

/** Joi custom validator: `key` or `key=valueRegex`, value regex must compile with RE2. */
export function validateLabelFilterPattern(pattern: string): string {
  const { key, valuePattern } = splitLabelPattern(pattern);
  if (key === '') {
    throw new Error(`Invalid label filter "${pattern}": the label key before "=" is required`);
  }
  if (valuePattern !== undefined) {
    compile(valuePattern);
  }
  return pattern;
}

function nameRule(pattern: string): CompiledRule {
  const regex = compile(pattern);
  return { matches: (names) => names.some((name) => regex.matcher(name).find()) };
}

function labelRule(pattern: string): CompiledRule {
  const { key, valuePattern } = splitLabelPattern(pattern);
  const regex = valuePattern === undefined ? undefined : compile(valuePattern);
  return {
    matches: (_names, labels) => {
      if (!Object.hasOwn(labels, key)) {
        return false;
      }
      return regex ? regex.matcher(String(labels[key])).find() : true;
    },
  };
}

/**
 * Compile the watcher's container filters, or return undefined when none are
 * configured. Patterns are RE2 (linear time), matched unanchored like the
 * dd.tag.include / dd.tag.exclude regexes.
 */
export function buildContainerWatchFilter(
  configuration: ContainerWatchFilterConfiguration,
): ContainerWatchFilter | undefined {
  const include: CompiledRule[] = [];
  const exclude: CompiledRule[] = [];
  if (configuration.containers?.include) include.push(nameRule(configuration.containers.include));
  if (configuration.containers?.exclude) exclude.push(nameRule(configuration.containers.exclude));
  if (configuration.labels?.include) include.push(labelRule(configuration.labels.include));
  if (configuration.labels?.exclude) exclude.push(labelRule(configuration.labels.exclude));
  if (include.length === 0 && exclude.length === 0) {
    return undefined;
  }
  return { include, exclude };
}

/**
 * Decide whether a container is watched.
 *
 * Precedence: an explicit dd.watch label always wins; otherwise a matching
 * exclude filter drops the container; otherwise, when any include filter is
 * configured, the container is watched only if one matches (this replaces
 * watchbydefault); with no filters, watchbydefault decides.
 */
export function shouldWatchContainer(
  watchLabelValue: string | undefined,
  watchByDefault: boolean,
  filter: ContainerWatchFilter | undefined,
  rawNames: string[] | undefined,
  rawLabels: Record<string, string> | undefined,
): boolean {
  if (watchLabelValue !== undefined && watchLabelValue !== '') {
    return watchLabelValue.toLowerCase() === 'true';
  }
  if (!filter) {
    return watchByDefault;
  }
  const names = (rawNames ?? []).map((name) => name.replace(/^\//, ''));
  const labels = rawLabels ?? {};
  if (filter.exclude.some((rule) => rule.matches(names, labels))) {
    return false;
  }
  if (filter.include.length > 0) {
    return filter.include.some((rule) => rule.matches(names, labels));
  }
  return watchByDefault;
}

/** Joi keys for the `containers` and `labels` watcher filter options. */
export function getContainerFilterConfigurationSchema(joi: typeof Joi) {
  return {
    containers: joi.object({
      include: joi.string().custom(validateContainerFilterPattern),
      exclude: joi.string().custom(validateContainerFilterPattern),
    }),
    labels: joi.object({
      include: joi.string().custom(validateLabelFilterPattern),
      exclude: joi.string().custom(validateLabelFilterPattern),
    }),
  };
}
