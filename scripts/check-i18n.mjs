// 检查 src 内仍未被 t() 包裹的中文界面文案；仅作为开发期覆盖率探针。
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = "src";
const SKIP = new Set(["src/lib/messages/en-US.ts", "src/mocks/shortcuts.ts"]);
const CJK = /[\u4e00-\u9fff]/;

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const findings = [];
for (const file of walk(ROOT)) {
  if (SKIP.has(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

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
  const report = (node, text) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file, line: line + 1, text: text.trim().replace(/\s+/g, " ") });
  };

  const visit = (node) => {
    if (ts.isJsxText(node) && CJK.test(node.text) && node.text.trim()) {
      report(node, node.text);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CJK.test(node.text) &&
      !insideTranslate(node)
    ) {
      report(node, node.text);
    } else if (ts.isTemplateExpression(node) && CJK.test(node.getText(sf)) && !insideTranslate(node)) {
      report(node, node.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
for (const item of findings) console.log(`${item.file}:${item.line}\t${item.text}`);
console.log(`\n未包裹中文：${findings.length} 处，${new Set(findings.map((item) => item.file)).size} 个文件`);
process.exit(findings.length === 0 ? 0 : 1);
