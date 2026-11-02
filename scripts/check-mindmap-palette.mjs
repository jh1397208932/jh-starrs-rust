#!/usr/bin/env node
/**
 * 思维导图分支配色门禁：艳丽度 + 对比度。
 *
 * 唯一来源：`src/features/mindmap/mindmap.css` 的 `--mindmap-branch-*` 与强度变量，
 * 以及 `src/styles/tokens.css` 的中性与文字色；不在脚本里抄第二份色值。
 *
 * 判据：
 *  - WCAG 1.4.11 非文本对比：节点描边 vs 卡片底 ≥ 3.0（light / dark 各算一遍）
 *  - WCAG 1.4.3 正文对比：节点文字 vs 节点填充 ≥ 4.5
 *  - 艳丽度：分支色 HSV 饱和度 ≥ 45%（"边框太浅"的直接口径）
 *
 * 用法：node scripts/check-mindmap-palette.mjs
 * 退出码：0 全部达标；1 有任一项不达标。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mindmapCss = readFileSync(join(root, "src/features/mindmap/mindmap.css"), "utf8");
const tokensCss = readFileSync(join(root, "src/styles/tokens.css"), "utf8");

/* ---------- 颜色工具 ---------- */
const hex2rgb = (hex) => {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16));
};
const rgb2hex = (rgb) =>
  `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const channelLum = (value) => {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
const ratio = (a, b) => {
  const [high, low] = [lum(a), lum(b)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
};
/** CSS `color-mix(in srgb, a weight%, b)`：在 sRGB 分量上线性插值。 */
const mix = (a, b, weightPercent) => {
  const weight = weightPercent / 100;
  return a.map((value, index) => value * weight + b[index] * (1 - weight));
};
const saturation = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};

/* ---------- 解析变量 ---------- */
const readBlock = (css, selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`找不到选择器块：${selector}`);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
};
const readHexVars = (block, prefix) => {
  const found = [...block.matchAll(new RegExp(`--${prefix}-(\\d+):\\s*(#[0-9a-fA-F]{3,6});`, "g"))];
  if (found.length === 0) throw new Error(`找不到变量：--${prefix}-*`);
  return found.sort((left, right) => Number(left[1]) - Number(right[1])).map((match) => match[2]);
};
const readPercentVar = (block, name) => {
  const match = block.match(new RegExp(`--${name}:\\s*([\\d.]+)%`));
  if (!match) throw new Error(`找不到百分比变量：--${name}`);
  return Number(match[1]);
};
const readOneHex = (css, selector, name) => {
  const block = readBlock(css, selector);
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`));
  if (!match) throw new Error(`${selector} 缺少 --${name}`);
  return match[1];
};

const branches = readHexVars(readBlock(mindmapCss, ".mindmap-workspace"), "mindmap-branch");
const borderStrength = readPercentVar(readBlock(mindmapCss, ".mindmap-workspace"), "mindmap-border-strength");
const fillStrength = readPercentVar(readBlock(mindmapCss, ".mindmap-workspace"), "mindmap-fill-strength");

const modes = ["light", "dark"].map((mode) => {
  const selector = mode === "light" ? ":root" : '[data-mode="dark"]';
  return {
    mode,
    card: readOneHex(tokensCss, selector, "card"),
    foreground: readOneHex(tokensCss, selector, "foreground"),
    border: readOneHex(tokensCss, selector, "border"),
  };
});

/* ---------- 校验 ---------- */
const MIN_BRANCH_SATURATION = 0.45;
const MIN_BORDER_CONTRAST = 3.0;
const MIN_TEXT_CONTRAST = 4.5;

let failed = 0;
const fail = (message) => {
  failed += 1;
  console.log(`FAIL ${message}`);
};

console.log(`分支色 ${branches.length} 个 · 描边强度 ${borderStrength}% · 填充强度 ${fillStrength}%\n`);
for (const branch of branches) {
  const branchRgb = hex2rgb(branch);
  const sat = saturation(branchRgb);
  if (sat < MIN_BRANCH_SATURATION) {
    fail(`${branch} 饱和度 ${(sat * 100).toFixed(1)}% < ${MIN_BRANCH_SATURATION * 100}%（不够艳丽）`);
  }
  for (const mode of modes) {
    const card = hex2rgb(mode.card);
    const border = mix(branchRgb, hex2rgb(mode.border), borderStrength);
    const fill = mix(branchRgb, card, fillStrength);
    const borderContrast = ratio(border, card);
    const textContrast = ratio(hex2rgb(mode.foreground), fill);
    const ok = borderContrast >= MIN_BORDER_CONTRAST && textContrast >= MIN_TEXT_CONTRAST;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${mode.mode.padEnd(5)} ${branch} 描边 ${rgb2hex(border)} 对比 ${borderContrast.toFixed(2)}` +
        ` · 填充 ${rgb2hex(fill)} 文字对比 ${textContrast.toFixed(2)} · 饱和 ${(sat * 100).toFixed(1)}%`,
    );
    if (borderContrast < MIN_BORDER_CONTRAST) {
      fail(`${branch} ${mode.mode} 描边对比 ${borderContrast.toFixed(2)} < ${MIN_BORDER_CONTRAST}`);
    }
    if (textContrast < MIN_TEXT_CONTRAST) {
      fail(`${branch} ${mode.mode} 文字对比 ${textContrast.toFixed(2)} < ${MIN_TEXT_CONTRAST}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n思维导图配色门禁：${failed} 项不达标`);
  process.exit(1);
}
console.log("\n思维导图配色门禁：通过");
