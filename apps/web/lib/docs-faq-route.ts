export function isFaqSlug(slug?: readonly string[]): boolean {
  return slug?.at(-1) === "faq";
}
