// 列出代码中 t("...") 使用但英文词典缺失的键。
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const dictSource = fs.readFileSync("src/lib/messages/en-US.ts", "utf8");
const dictFile = ts.createSourceFile("en-US.ts", dictSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const known = new Set();
const collectDict = (node) => {
  if (
    ts.isPropertyAssignment(node) &&
    (ts.isStringLiteral(node.name) ||
      ts.isNoSubstitutionTemplateLiteral(node.name) ||
      ts.isIdentifier(node.name))
  ) {
    known.add(node.name.text);
  }
  ts.forEachChild(node, collectDict);
};
collectDict(dictFile);

const used = new Map();
for (const file of walk("src")) {
  if (file.includes("/messages/")) continue;
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments.length > 0 &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      const key = node.arguments[0].text;
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(file);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const missing = [...used.keys()].filter((key) => !known.has(key)).sort();
for (const key of missing) {
  console.log(`${key}\t${[...new Set(used.get(key))].join(", ")}`);
}
console.log(`\nt() 键 ${used.size} 个；缺失英文 ${missing.length} 个；词典 ${known.size} 条`);
