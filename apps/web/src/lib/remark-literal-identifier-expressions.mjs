// Docs prose quotes UI string templates such as "{column} - hidden to fit".
// MDX treats a bare {identifier} as a JS expression, the identifier is undefined
// at render time, and the page 500s with a ReferenceError. Render bare
// identifiers as literal text instead. {/* comments */} and real expressions
// (member access, calls, literals) are left alone.
const IDENTIFIER = /^\s*[A-Za-z_$][\w$]*\s*$/u;

function isBareIdentifierExpression(node) {
  return (
    (node.type === "mdxTextExpression" || node.type === "mdxFlowExpression") &&
    IDENTIFIER.test(node.value ?? "")
  );
}

function visit(node) {
  if (!node.children) {
    return;
  }
  node.children = node.children.map((child) => {
    if (isBareIdentifierExpression(child)) {
      const text = { type: "text", value: `{${child.value}}` };
      return child.type === "mdxFlowExpression" ? { type: "paragraph", children: [text] } : text;
    }
    visit(child);
    return child;
  });
}

export default function remarkLiteralIdentifierExpressions() {
  return (tree) => visit(tree);
}
