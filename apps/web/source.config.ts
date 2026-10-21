import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import remarkCustomHeadingId from "remark-custom-heading-id";

import remarkGithubAlerts from "./src/lib/remark-github-alerts.mjs";
import remarkLiteralIdentifierExpressions from "./src/lib/remark-literal-identifier-expressions.mjs";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkCustomHeadingId, remarkLiteralIdentifierExpressions, remarkGithubAlerts],
  },
});
