const ts = require('typescript');

/**
 * Count explicit `any` type usages in a TypeScript file using the compiler AST.
 * Catches: `: any`, `as any`, `any[]`, `<any>`, `string | any`, etc.
 */
function countAnyTypes(filePath, content) {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  let count = 0;

  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      count++;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return count;
}

module.exports = { countAnyTypes };
