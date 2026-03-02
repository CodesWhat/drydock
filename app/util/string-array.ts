export interface UniqStringsOptions {
  trim?: boolean;
  removeEmpty?: boolean;
  sortComparator?: (left: string, right: string) => number;
}

export function uniqStrings(values: unknown, options: UniqStringsOptions = {}): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const { trim = false, removeEmpty = false, sortComparator } = options;
  let strings = values.filter((value): value is string => typeof value === 'string');

  if (trim) {
    strings = strings.map((value) => value.trim());
  }

  if (removeEmpty) {
    strings = strings.filter((value) => value.length > 0);
  }

  const uniqueValues = Array.from(new Set(strings));
  if (sortComparator) {
    uniqueValues.sort(sortComparator);
  }

  return uniqueValues;
}
