// GitHub renders "> [!WARNING]" blockquotes as alert boxes. The generated
// changelog page copies them verbatim from the root CHANGELOG.md, so without a
// transform the marker shows up as literal text inside a plain blockquote.
// Turn them into fumadocs <Callout> elements instead. CHANGELOG.md itself stays
// untouched, so GitHub keeps rendering its own alerts.
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/u;

const KINDS = {
  NOTE: { type: "info", title: "Note" },
  TIP: { type: "idea", title: "Tip" },
  IMPORTANT: { type: "warn", title: "Important" },
  WARNING: { type: "warn", title: "Warning" },
  CAUTION: { type: "error", title: "Caution" },
};

function attribute(name, value) {
  return { type: "mdxJsxAttribute", name, value };
}

function toCallout(node) {
  const first = node.children?.[0];
  if (first?.type !== "paragraph") {
    return null;
  }
  const lead = first.children?.[0];
  if (lead?.type !== "text") {
    return null;
  }
  const match = MARKER.exec(lead.value);
  if (!match) {
    return null;
  }
  const kind = KINDS[match[1]];
  const rest = lead.value.slice(match[0].length);
  const paragraphChildren = rest
    ? [{ ...lead, value: rest }, ...first.children.slice(1)]
    : first.children.slice(1);
  const children = [
    ...(paragraphChildren.length > 0 ? [{ ...first, children: paragraphChildren }] : []),
    ...node.children.slice(1),
  ];
  return {
    type: "mdxJsxFlowElement",
    name: "Callout",
    attributes: [attribute("type", kind.type), attribute("title", kind.title)],
    children,
  };
}

function visit(node) {
  if (!node.children) {
    return;
  }
  node.children = node.children.map((child) => {
    if (child.type === "blockquote") {
      const callout = toCallout(child);
      if (callout) {
        visit(callout);
        return callout;
      }
    }
    visit(child);
    return child;
  });
}

export default function remarkGithubAlerts() {
  return (tree) => visit(tree);
}
