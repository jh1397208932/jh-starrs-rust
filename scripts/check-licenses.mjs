#!/usr/bin/env node
/**
 * 第三方依赖许可证门禁（AGENTS.md 合规要求：不允许 GPL/AGPL/商业授权/许可不明产品）。
 *
 * 检查范围：
 * 1. node_modules 全部已安装包（含嵌套/scope 包）；
 * 2. Cargo 依赖（cargo metadata --offline）；
 * 3. dist 产物中的字体文件（与 vite.config.ts 的字体白名单一致）。
 *
 * 判定规则：
 * - 任一 OR 分支为宽松许可（MIT/Apache/BSD/ISC/OFL 等）→ 通过；
 * - 仅弱 copyleft（MPL/EPL/LGPL/CDDL）→ 警告（开源，无“必须开源本项目”义务）；
 * - 强 copyleft（GPL/AGPL/SSPL/BUSL）、非商业、UNLICENSED、专有、许可不明 → 失败。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_EXT = /\.(woff2?|ttf|otf|eot)$/i;
// 与 vite.config.ts fontLicenseGuard 保持一致
const ALLOWED_FONT_MARKERS = ["assistant", "virgil", "nunito", "lilita", "cascadia", "comicshanns", "xiaolai"];
const UNCONFIRMED_FONT_MARKERS = ["excalifont"];
const DENIED_FONT_MARKERS = ["liberation"];

const PERMISSIVE = [
  /^MIT$/i,
  /^MIT-0$/i,
  /^ISC$/i,
  /^Apache-2\.0$/i,
  /^Apache-2\.0 WITH LLVM-exception$/i,
  /^BSD-[23]-Clause$/i,
  /^0BSD$/i,
  // Boost Software License 1.0：宽松许可，可商用；与 BUSL（Business Source License）无关。
  /^BSL-1\.0$/i,
  /^Zlib$/i,
  /^Unlicense$/i,
  /^CC0-1\.0$/i,
  /^OFL-1\.1$/i,
  /^Unicode-3\.0$/i,
  /^Python-2\.0$/i,
  /^WTFPL$/i,
  /^CC-BY-4\.0$/i,
];
const WEAK = [/LGPL/i, /MPL/i, /EPL/i, /CDDL/i, /CPL/i];
const STRONG = [/AGPL/i, /(^|[^L])GPL/i, /SSPL/i, /BUSL/i, /CC-BY-NC/i, /UNLICENSED/i, /PROPRIETARY/i, /COMMERCIAL/i];

const LICENSE_FILE_NAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "license",
  "license.md",
  "license.txt",
  "LICENSE-MIT",
  "LICENSE-APACHE",
];

const counts = new Map();
const failures = [];
const warnings = [];
let scanned = 0;

function record(license, item) {
  counts.set(license, (counts.get(license) ?? 0) + 1);
  const kind = classifyExpression(license);
  if (kind === "strong" || kind === "unknown") failures.push(item);
  else if (kind === "weak") warnings.push(item);
}

function classifyToken(raw) {
  const token = raw.trim().replace(/^\(+/, "").replace(/\)+$/, "");
  if (!token) return "unknown";
  if (WEAK.some((pattern) => pattern.test(token))) return "weak";
  if (STRONG.some((pattern) => pattern.test(token))) return "strong";
  if (PERMISSIVE.some((pattern) => pattern.test(token))) return "permissive";
  return "unknown";
}

function classifyExpression(raw) {
  // Cargo/npm 生态常用 “MIT/Apache-2.0” 或 “Apache-2.0 / MIT” 表示 OR，先统一。
  const expression = String(raw)
    .replace(/[()]/g, " ")
    .replace(/\s*\/\s*/g, " OR ");
  const alternatives = expression.split(/\s+OR\s+/i);
  const kinds = alternatives.map((alternative) => {
    const conjuncts = alternative.split(/\s+AND\s+/i).map(classifyToken);
    if (conjuncts.includes("strong")) return "strong";
    if (conjuncts.includes("weak")) return "weak";
    if (conjuncts.includes("unknown")) return "unknown";
    return "permissive";
  });
  if (kinds.includes("permissive")) return "permissive";
  if (kinds.includes("weak")) return "weak";
  if (kinds.includes("unknown")) return "unknown";
  return "strong";
}

function inferLicenseFromFile(packageDir) {
  for (const name of LICENSE_FILE_NAMES) {
    const file = path.join(packageDir, name);
    if (!fs.existsSync(file)) continue;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8").slice(0, 4000).toUpperCase();
    } catch {
      continue;
    }
    if (text.includes("SIL OPEN FONT LICENSE")) return "OFL-1.1";
    if (text.includes("APACHE LICENSE")) return "Apache-2.0";
    if (text.includes("MIT LICENSE") || text.includes("PERMISSION IS HEREBY GRANTED")) return "MIT";
    if (text.includes("ISC LICENSE") || text.includes("PERMISSION TO USE, COPY, MODIFY, AND/OR DISTRIBUTE"))
      return "ISC";
    if (text.includes("REDISTRIBUTION AND USE IN SOURCE AND BINARY")) return "BSD-3-Clause";
    if (text.includes("MOZILLA PUBLIC LICENSE")) return "MPL-2.0";
    if (text.includes("GNU LESSER GENERAL PUBLIC") || text.includes("GNU LIBRARY GENERAL PUBLIC")) return "LGPL";
    if (text.includes("GNU GENERAL PUBLIC LICENSE")) return "GPL";
    return "UNKNOWN (license file)";
  }
  return null;
}

function scanNpm() {
  const root = path.join(ROOT, "node_modules");
  const seenKeys = new Set();
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".bin" || entry.name === ".cache") continue;
      if (entry.name.startsWith("@")) {
        visit(path.join(dir, entry.name));
        continue;
      }
      const packageDir = path.join(dir, entry.name);
      const manifest = path.join(packageDir, "package.json");
      if (!fs.existsSync(manifest)) {
        visit(path.join(packageDir, "node_modules"));
        continue;
      }
      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(manifest, "utf8"));
      } catch {
        continue;
      }
      const name = meta.name ?? entry.name;
      const version = meta.version ?? "?";
      const key = `${name}@${version}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        scanned += 1;
        let license = meta.license;
        if (!license && Array.isArray(meta.licenses)) license = meta.licenses.map((item) => item.type).join(" OR ");
        if (!license) license = inferLicenseFromFile(packageDir) ?? "(none)";
        record(license, `${name}@${version} -> ${license}`);
      }
      const nested = path.join(packageDir, "node_modules");
      if (fs.existsSync(nested)) visit(nested);
    }
  };
  visit(root);
}

function scanCargo() {
  let raw;
  try {
    raw = execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--offline", "--manifest-path", path.join(ROOT, "src-tauri/Cargo.toml")],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    failures.push(`Cargo 许可证扫描失败（cargo metadata --offline）：${error.message}`);
    return;
  }
  const metadata = JSON.parse(raw);
  for (const pkg of metadata.packages) {
    // source 为 null 的是本仓库工作区成员，不是第三方依赖
    if (pkg.source === null) continue;
    scanned += 1;
    const license = pkg.license ?? (pkg.license_file ? `UNKNOWN (file ${path.basename(pkg.license_file)})` : "(none)");
    record(license, `${pkg.name}@${pkg.version} -> ${license}`);
  }
}

function scanDistFonts() {
  const dist = path.join(ROOT, "dist");
  if (!fs.existsSync(dist)) {
    warnings.push("dist 不存在，已跳过产物字体检查（发布前先执行 npm run build）");
    return;
  }
  const stack = [dist];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!FONT_EXT.test(entry.name)) continue;
      const relative = path.relative(ROOT, full);
      const lower = entry.name.toLowerCase();
      if (ALLOWED_FONT_MARKERS.some((marker) => lower.includes(marker))) continue;
      if (UNCONFIRMED_FONT_MARKERS.some((marker) => lower.includes(marker))) {
        failures.push(`产物字体 ${relative} 的许可未在上游明确声明，禁止发布`);
        continue;
      }
      if (DENIED_FONT_MARKERS.some((marker) => lower.includes(marker))) {
        failures.push(`产物字体 ${relative} 属于高风险旧许可字体（Liberation 1.x），禁止发布`);
        continue;
      }
      failures.push(`产物字体 ${relative} 不在开源字体白名单中，禁止发布`);
    }
  }
}

function printSummary() {
  console.log(`许可证扫描：共检查 ${scanned} 个第三方包/依赖`);
  console.log("\n=== 许可分布 ===");
  for (const [license, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${String(count).padStart(5)}  ${license}`);
  }
  if (warnings.length > 0) {
    console.log("\n=== 弱 copyleft（开源；无需开源本项目，但分发时需保留声明）===");
    for (const item of [...new Set(warnings)]) console.log(`WARN  ${item}`);
  }
  if (failures.length > 0) {
    console.log("\n=== 禁止项（GPL/AGPL/商业/许可不明/高风险字体）===");
    for (const item of [...new Set(failures)]) console.log(`FAIL  ${item}`);
  }
  console.log(
    failures.length > 0
      ? `\n许可证门禁：失败（${failures.length} 项），请移除或替换相关依赖后再提交。`
      : `\n许可证门禁：通过${warnings.length > 0 ? `（${warnings.length} 项弱 copyleft 警告）` : ""}。`,
  );
}

scanNpm();
scanCargo();
scanDistFonts();
printSummary();
process.exitCode = failures.length > 0 ? 1 : 0;