#!/usr/bin/env node
/**
 * 星屿 Starris · 配色对比度校验脚本
 * 用法: node scripts/check-contrast.mjs [--check]
 *   默认: 打印全部主题关键对比矩阵 + 基线数据
 *   --check: 按第五轮「明亮清新」验收线输出 PASS/FAIL，不达标退出码 1
 *
 * 验收线（2026-10-21 第五轮，UI-SPEC §5A）:
 *   - light: foreground vs background        >= 12
 *   - light: muted-fg vs background/secondary >= 4.5（取严）
 *   - light: sidebar-muted vs sidebar         >= 4.5
 *   - light: secondary-fg vs secondary        >= 4.5
 *   - light: border/input vs background       >= 1.30
 *   - light: accent-fg vs accent              >= 4.5
 *   - light: sidebar-active-fg vs sidebar-active >= 4.5
 *   - light: primary-fg vs primary            >= 4.5（主按钮文字普通字号 AA）
 *   - light: primary vs background            >= 3.0（色块/图形辨识）
 *   - dark 模式仅打印基线，不参与 --check（本轮未改动）
 * 附: 文字组 RGB max-min（tint 度，目标 <= 4）、primary HSL 饱和度（鲜亮度参考）
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/styles/tokens.css"), "utf8");

/* ---------- 颜色工具 ---------- */
const hex2rgb = (h) => {
  const s = h.replace("#", "");
  const v = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const tint = (rgb) => Math.max(...rgb) - Math.min(...rgb);
const hsl = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map((c) => c / 255);
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  return { s, l };
};
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;

/* ---------- 解析 tokens.css ---------- */
const THEMES = ["sunset", "azure", "midnight", "amber", "forest", "rose", "violet", "graphite"];
const blocks = new Map(); // key: `${theme}|${mode}` -> vars
const parseBlock = (selector, body) => {
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{3,8})/g)) vars[m[1]] = m[2];
  blocks.set(selector, vars);
};
// :root 默认块
const rootMatch = css.match(/^:root \{([\s\S]*?)\n\}/m);
if (rootMatch) parseBlock("root|light", rootMatch[1]);
for (const t of THEMES) {
  const light = css.match(new RegExp(`\\[data-theme="${t}"\\] \\{([\\s\\S]*?)\\n\\}`, "m"));
  const dark = css.match(new RegExp(`\\[data-theme="${t}"\\]\\[data-mode="dark"\\] \\{([\\s\\S]*?)\\n\\}`, "m"));
  if (light) parseBlock(`${t}|light`, light[1]);
  if (dark) parseBlock(`${t}|dark`, dark[1]);
}

/* ---------- 关键对比对 ---------- */
const PAIRS = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["muted-foreground", "secondary"],
  ["secondary-foreground", "secondary"],
  ["border", "background"],
  ["input", "background"],
  ["primary", "background"],
  ["primary-foreground", "primary"],
  ["accent-foreground", "accent"],
  ["sidebar-muted", "sidebar"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-active-fg", "sidebar-active"],
];

const rows = [];
for (const [key, vars] of blocks) {
  const [theme, mode] = key.split("|");
  const rgb = (name) => (vars[name] ? hex2rgb(vars[name]) : null);
  const entry = { theme, mode, ratios: {}, tints: {}, primaryHsl: null, vars };
  for (const [fg, bg] of PAIRS) {
    const a = rgb(fg), b = rgb(bg);
    entry.ratios[`${fg}/${bg}`] = a && b ? ratio(a, b) : null;
  }
  for (const n of ["foreground", "muted-foreground", "secondary-foreground", "sidebar-foreground"]) {
    const c = rgb(n);
    entry.tints[n] = c ? tint(c) : null;
  }
  const p = rgb("primary");
  entry.primaryHsl = p ? hsl(p) : null;
  rows.push(entry);
}
rows.sort((a, b) => THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme) || a.mode.localeCompare(b.mode));

/* ---------- 打印 ---------- */
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n星屿配色对比度矩阵（WCAG lum/ratio 实测）  生成于 ${new Date().toISOString().slice(0, 16)}\n`);
for (const mode of ["light", "dark"]) {
  console.log(`\n===== ${mode.toUpperCase()} =====`);
  console.log(
    pad("theme", 10) +
    ["fg/bg", "mut/bg", "mut/sec", "sec-fg", "border", "input", "pri/bg", "btn字", "acc-fg", "sb-mut", "sb-fg", "act-fg"]
      .map((h) => pad(h, 8)).join("")
  );
  for (const e of rows.filter((x) => x.mode === mode)) {
    const v = e.ratios;
    const line = ["foreground/background", "muted-foreground/background", "muted-foreground/secondary",
      "secondary-foreground/secondary", "border/background", "input/background", "primary/background",
      "primary-foreground/primary", "accent-foreground/accent", "sidebar-muted/sidebar",
      "sidebar-foreground/sidebar", "sidebar-active-fg/sidebar-active"].map((k) => pad(v[k] ? r2(v[k]) : "-", 8));
    const tintStr = Math.max(...Object.values(e.tints).filter((x) => x != null));
    const sat = e.primaryHsl ? Math.round(e.primaryHsl.s * 100) : "-";
    console.log(pad(e.theme, 10) + line.join("") + `  tintMax=${tintStr}  primaryS=${sat}%`);
  }
}

/* ---------- --check 验收 ---------- */
const CHECKS = [
  { name: "fg/bg >= 12", pair: "foreground/background", min: 12 },
  { name: "muted-fg >= 4.5 (对 bg/sec 取严)", pairs: ["muted-foreground/background", "muted-foreground/secondary"], min: 4.5 },
  { name: "sec-fg >= 4.5", pair: "secondary-foreground/secondary", min: 4.5 },
  { name: "border >= 1.30", pair: "border/background", min: 1.3 },
  { name: "input >= 1.30", pair: "input/background", min: 1.3 },
  { name: "btn字 >= 4.5", pair: "primary-foreground/primary", min: 4.5 },
  { name: "primary色块 >= 3.0", pair: "primary/background", min: 3.0 },
  { name: "acc-fg >= 4.5", pair: "accent-foreground/accent", min: 4.5 },
  { name: "sb-muted >= 4.5", pair: "sidebar-muted/sidebar", min: 4.5 },
  { name: "act-fg >= 4.5", pair: "sidebar-active-fg/sidebar-active", min: 4.5 },
];
let fail = 0;
if (process.argv.includes("--check")) {
  console.log("\n===== --check 验收（light · 第五轮明亮清新线）=====");
  for (const t of THEMES) {
    const e = rows.find((x) => x.theme === t && x.mode === "light");
    const bad = [];
    for (const c of CHECKS) {
      const vals = (c.pairs ?? [c.pair]).map((k) => e.ratios[k]).filter((x) => x != null);
      const min = Math.min(...vals);
      if (min < c.min) bad.push(`${c.name}=${r2(min)}`);
    }
    const tintMax = Math.max(...Object.values(e.tints).filter((x) => x != null));
    if (tintMax > 4) bad.push(`文字tint=${tintMax}>4`);
    if (bad.length) { fail++; console.log(`  FAIL  ${pad(t, 10)} ${bad.join("；")}`); }
    else console.log(`  PASS  ${t}`);
  }
  console.log(fail === 0 ? "\n全部主题通过第五轮验收 ✓" : `\n${fail} 个主题未达标 ✗`);
  process.exit(fail === 0 ? 0 : 1);
}
