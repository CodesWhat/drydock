export type LlmsLink = { title: string; url: string; note?: string };

export type LlmsTxtInput = {
  name: string;
  description: string;
  docs: LlmsLink[];
  comparisons: LlmsLink[];
  project: LlmsLink[];
};

function section(heading: string, links: LlmsLink[]): string[] {
  if (links.length === 0) return [];
  return [
    `## ${heading}`,
    "",
    ...links.map((link) => `- [${link.title}](${link.url})${link.note ? `: ${link.note}` : ""}`),
    "",
  ];
}

/** Builds /llms.txt (llmstxt.org format) from links the caller already resolved. */
export function buildLlmsTxt({
  name,
  description,
  docs,
  comparisons,
  project,
}: LlmsTxtInput): string {
  return [
    `# ${name}`,
    "",
    `> ${description}`,
    "",
    ...section("Docs", docs),
    ...section("Comparisons", comparisons),
    ...section("Project", project),
  ]
    .join("\n")
    .trimEnd()
    .concat("\n");
}
