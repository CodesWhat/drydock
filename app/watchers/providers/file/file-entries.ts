import parse from 'parse-docker-image-name';
import { RE2JS } from 're2js';
import yaml from 'yaml';
import { getErrorMessage } from '../../../util/error.js';
import { ddTagExclude, ddTagFamily, ddTagInclude, ddTagTransform } from '../docker/label.js';

/** One validated entry of the image list file. */
export interface FileImageEntry {
  /** Unique within the file; names the synthetic container. */
  name: string;
  /** The image reference as written, e.g. `ghcr.io/org/app:1.4`. */
  image: string;
  /** `dd.*` labels, values coerced to strings. */
  labels: Record<string, string>;
}

/**
 * The file as a whole could not be used. `errors` carries one line per problem, each naming
 * the entry it belongs to, so a single reload reports every mistake rather than the first.
 */
export class FileImageListError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'FileImageListError';
  }
}

const ENTRY_KEYS = new Set(['image', 'name', 'labels', 'tag']);
const TAG_KEYS = new Set(['include', 'exclude', 'transform', 'family']);
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const TAG_FAMILIES = new Set(['strict', 'loose']);

const TAG_FIELD_LABELS: Record<string, string> = {
  include: ddTagInclude,
  exclude: ddTagExclude,
  transform: ddTagTransform,
  family: ddTagFamily,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why an image reference is unusable, or undefined when it is fine. */
function getImageReferenceProblem(reference: string): string | undefined {
  if (/\s/.test(reference)) {
    return `image "${reference}" must not contain whitespace`;
  }
  if (reference.includes('@')) {
    return `image "${reference}" is digest-pinned; reference a tag instead, such as name:1.2.3`;
  }
  if (!parse(reference).path) {
    return `image "${reference}" is not a valid image reference`;
  }
  return undefined;
}

function defaultEntryName(parsedPath: string): string {
  return parsedPath.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
}

function validateLabels(
  rawLabels: unknown,
  problems: string[],
): Record<string, string> | undefined {
  if (rawLabels === undefined) {
    return {};
  }
  if (!isPlainObject(rawLabels)) {
    problems.push('labels must be a map of dd.* label names to values');
    return undefined;
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawLabels)) {
    if (!key.startsWith('dd.')) {
      problems.push(`label "${key}" is not allowed, only dd.* labels apply`);
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      labels[key] = String(value);
      continue;
    }
    problems.push(`label "${key}" must be a string, number or boolean`);
  }
  return labels;
}

function mergeTagFields(rawTag: unknown, labels: Record<string, string>, problems: string[]): void {
  if (rawTag === undefined) {
    return;
  }
  if (!isPlainObject(rawTag)) {
    problems.push('tag must be a map with include, exclude, transform or family');
    return;
  }
  for (const [field, value] of Object.entries(rawTag)) {
    if (!TAG_KEYS.has(field)) {
      problems.push(`unknown tag field "${field}"`);
      continue;
    }
    if (typeof value !== 'string' || value === '') {
      problems.push(`tag.${field} must be a non-empty string`);
      continue;
    }
    const label = TAG_FIELD_LABELS[field];
    if (labels[label] !== undefined) {
      problems.push(`tag.${field} and the ${label} label are both set`);
      continue;
    }
    labels[label] = value;
  }
}

function validateTagLabels(labels: Record<string, string>, problems: string[]): void {
  for (const label of [ddTagInclude, ddTagExclude]) {
    const pattern = labels[label];
    if (pattern === undefined) {
      continue;
    }
    try {
      RE2JS.compile(pattern);
    } catch (error: unknown) {
      problems.push(`${label} is not a valid regular expression (${getErrorMessage(error)})`);
    }
  }
  const family = labels[ddTagFamily];
  if (family !== undefined && !TAG_FAMILIES.has(family)) {
    problems.push(`${ddTagFamily} must be strict or loose, got "${family}"`);
  }
}

function validateEntry(rawEntry: unknown): { entry?: FileImageEntry; problems: string[] } {
  const problems: string[] = [];
  const candidate = typeof rawEntry === 'string' ? { image: rawEntry } : rawEntry;
  if (!isPlainObject(candidate)) {
    return { problems: ['must be an image string or a map with an image field'] };
  }
  for (const key of Object.keys(candidate)) {
    if (!ENTRY_KEYS.has(key)) {
      problems.push(`unknown field "${key}"`);
    }
  }

  let parsedPath: string | undefined;
  const image = candidate.image;
  if (typeof image !== 'string' || image === '') {
    problems.push('image is required and must be a string');
  } else {
    const imageProblem = getImageReferenceProblem(image);
    if (imageProblem) {
      problems.push(imageProblem);
    } else {
      parsedPath = parse(image).path;
    }
  }

  let name: string | undefined;
  if (candidate.name === undefined) {
    name = parsedPath === undefined ? undefined : defaultEntryName(parsedPath);
  } else if (typeof candidate.name !== 'string' || !NAME_PATTERN.test(candidate.name)) {
    problems.push(
      'name must start with a letter or digit and use only letters, digits, ".", "_" and "-"',
    );
  } else {
    name = candidate.name;
  }

  const labels = validateLabels(candidate.labels, problems);
  if (labels) {
    mergeTagFields(candidate.tag, labels, problems);
    validateTagLabels(labels, problems);
  }

  if (problems.length > 0 || name === undefined || labels === undefined) {
    return { problems };
  }
  return { entry: { name, image: image as string, labels }, problems };
}

/**
 * Parse and validate the contents of an image list file.
 *
 * The result is all or nothing: any bad entry makes the whole file unusable, so a typo never
 * silently drops an image from the watch list. Throws `FileImageListError` listing every
 * problem found.
 */
export function parseImageListFile(content: string): FileImageEntry[] {
  let document: unknown;
  try {
    document = yaml.parse(content);
  } catch (error: unknown) {
    throw new FileImageListError([`invalid YAML (${getErrorMessage(error)})`]);
  }
  if (document === null || document === undefined) {
    throw new FileImageListError(['the file is empty; use "[]" for an empty list']);
  }
  if (!Array.isArray(document)) {
    throw new FileImageListError(['the file must contain a YAML list of images']);
  }

  const errors: string[] = [];
  const entries: FileImageEntry[] = [];
  const seenNames = new Set<string>();
  for (const [index, rawEntry] of document.entries()) {
    const { entry, problems } = validateEntry(rawEntry);
    const where = `entry ${index + 1}`;
    for (const problem of problems) {
      errors.push(`${where}: ${problem}`);
    }
    if (!entry) {
      continue;
    }
    if (seenNames.has(entry.name)) {
      errors.push(`${where}: name "${entry.name}" is already used, set a unique name`);
      continue;
    }
    seenNames.add(entry.name);
    entries.push(entry);
  }
  if (errors.length > 0) {
    throw new FileImageListError(errors);
  }
  return entries;
}
