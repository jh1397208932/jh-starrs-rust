// 将指定文件中的中文展示文案包裹为 t()/JSX 表达式；逻辑比较与注释不处理。
import fs from "node:fs";
import ts from "typescript";

const file = process.argv[2];
if (!file) {
  console.error("用法: node scripts/i18n-wrap.mjs <file>");
  process.exit(1);
}
const source = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const CJK = /[\u4e00-\u9fff]/;
const edits = [];

const insideTranslate = (node) => {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "t") {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const inLogic = (node) => {
  const parent = node.parent;
  if (!parent) return false;
  if (
    ts.isCallExpression(parent) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    ["includes", "startsWith", "endsWith", "indexOf", "match", "replace", "split"].includes(
      parent.expression.name.text,
    )
  ) {
    return true;
  }
  if (ts.isBinaryExpression(parent)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "t") {
    return false;
  }
  return false;
};

const wrap = (text) => `t(${JSON.stringify(text)})`;

function visit(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (CJK.test(node.text) && !insideTranslate(node) && !inLogic(node)) {
      if (ts.isJsxAttribute(node.parent)) {
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `{${wrap(node.text)}}` });
      } else {
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: wrap(node.text) });
      }
    }
  } else if (ts.isJsxText(node) && CJK.test(node.text) && node.text.trim()) {
    const raw = node.getText(sf);
    const trimmed = raw.trim();
    const start = node.getStart(sf) + raw.indexOf(trimmed);
    edits.push({ start, end: start + trimmed.length, text: `{${wrap(trimmed)}}` });
  }
  ts.forEachChild(node, visit);
}
visit(sf);

edits.sort((a, b) => b.start - a.start);
let output = source;
for (const edit of edits) {
  output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
}
fs.writeFileSync(file, output);
console.log(`${file}: 替换 ${edits.length} 处`);
