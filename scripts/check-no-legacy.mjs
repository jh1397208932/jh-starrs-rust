#!/usr/bin/env node
/**
 * 无历史数据原则守卫（AGENTS.md §9）。
 *
 * 扫描产品代码里是否重新出现迁移链、结构自愈、已下线节点类型分支、
 * 加载期修复标记或旧导图版本写入；命中即失败。
 *
 * 先剥注释再匹配，避免正/负判据读到自己写的说明文字。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["src-tauri/src", "src"];
const SKIP = [/integration_tests\.rs$/, /\.test\.[cm]?[jt]sx?$/, /(^|\/)test\//];

const RULES = [
  { name: "迁移链（MIGRATION_V…）", pattern: /\bMIGRATION_V\d+/ },
  {
    name: "结构自愈（needs_initialization / repair_schema / REQUIRED_STRUCTURES）",
    pattern: /\bneeds_initialization\b|\brepair_schema\w*\b|\bREQUIRED_STRUCTURES\b/,
  },
  { name: "已下线节点类型 4/5 的分支", pattern: /node_type\s*(?:==|!=|===|!==)\s*[45]\b/ },
  {
    name: "已下线节点类型的 match 分支",
    pattern: /\b(?:2\s*\|\s*4|4\s*\|\s*2|3\s*\|\s*5|5\s*\|\s*3)\b/,
  },
  { name: "DocLoadResult 携带加载期修复标记", pattern: /\bDocLoadResult\b[\s\S]{0,600}?\bnormalized\b/ },
  { name: "写旧版导图 content", pattern: /\bschemaVersion\s*[:=]\s*1\b/ },
  { name: "导图主题写 auto", pattern: /\btheme\s*[:=]\s*"auto"/ },
];

/** 去掉行注释与块注释（保留换行，行号不漂）。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + " ".repeat(match.length - prefix.length));
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.name === "node_modules" || entry.name === "target") continue;
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(rs|ts|tsx|mjs|cjs)$/.test(entry.name) && !SKIP.some((rule) => rule.test(full))) {
      files.push(full);
    }
  }
  return files;
}

function scan(source) {
  const code = stripComments(source);
  const hits = [];
  for (const rule of RULES) {
    const match = code.match(rule.pattern);
    if (match) {
      const line = code.slice(0, match.index).split("\n").length;
      hits.push({ name: rule.name, line });
    }
  }
  return hits;
}

// 自对照：正例必须命中、反例必须放行，否则判据本身失效。
const CONTROLS = [
  { source: "let x = MIGRATION_V10_TO_V11;", expect: true },
  { source: "if node.needs_initialization() {}", expect: true },
  { source: "if node_type != 4 { return; }", expect: true },
  { source: "match t { 2 | 4 => doc(), _ => {} }", expect: true },
  { source: "// MIGRATION_V10 在注释里不算\nlet ok = 1;", expect: false },
  { source: 'let version = SCHEMA_VERSION; if version == 2 { ok(); }', expect: false },
];
for (const control of CONTROLS) {
  const hit = scan(control.source).length > 0;
  if (hit !== control.expect) {
    console.error(`守卫自检失败：${JSON.stringify(control.source)} 期望 ${control.expect}，实际 ${hit}`);
    process.exit(1);
  }
}

const violations = [];
for (const target of TARGETS) {
  const directory = path.join(ROOT, target);
  if (!fs.existsSync(directory)) continue;
  for (const file of walk(directory)) {
    const source = fs.readFileSync(file, "utf8");
    for (const hit of scan(source)) {
      violations.push(`${path.relative(ROOT, file)}:${hit.line}  ${hit.name}`);
    }
  }
}

if (violations.length > 0) {
  console.error("发现违反「无历史数据原则」的代码：");
  for (const item of violations) console.error(`  - ${item}`);
  process.exit(1);
}
console.log("无历史数据守卫：通过（未发现迁移链/自愈/旧类型分支/旧版本写入）。");
