// 为使用 t() 的 React 组件补 useI18n 导入与 hook 调用。
import fs from "node:fs";
import ts from "typescript";

const file = process.argv[2];
const source = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const edits = [];
let needsImport = false;

const bodyUsesT = (body) => {
  let found = false;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
};

for (const statement of sf.statements) {
  if (!ts.isFunctionDeclaration(statement) || !statement.name || !/^[A-Z]/.test(statement.name.text)) continue;
  if (!statement.body || !bodyUsesT(statement.body)) continue;
  const text = statement.body.getText(sf);
  if (text.includes("useI18n()")) continue;
  edits.push(statement.body.getStart(sf) + 1);
  needsImport = true;
}

edits.sort((a, b) => b - a);
let output = source;
for (const pos of edits) output = output.slice(0, pos) + "\n  const { t } = useI18n();" + output.slice(pos);

if (needsImport && !output.includes('from "@/lib/i18n"')) {
  const lines = output.split("\n");
  const idx = Math.max(...lines.map((line, index) => (line.startsWith("import ") ? index : -1)));
  lines.splice(idx + 1, 0, 'import { useI18n } from "@/lib/i18n";');
  output = `${lines.join("\n")}\n`;
}
if (edits.length > 0) fs.writeFileSync(file, output);
console.log(`${file}: hooks ${edits.length}`);
