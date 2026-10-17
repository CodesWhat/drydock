/** Namespace inventory used by the locale completeness gate. */
export function missingNamespaces(
  source: readonly string[],
  translated: readonly string[],
): string[] {
  const available = new Set(translated);
  return source.filter((namespace) => !available.has(namespace));
}
