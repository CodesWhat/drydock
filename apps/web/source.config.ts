import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import remarkCustomHeadingId from "remark-custom-heading-id";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkCustomHeadingId],
  },
});
