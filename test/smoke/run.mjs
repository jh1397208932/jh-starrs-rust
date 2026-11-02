/**
 * 纯逻辑烟雾测试运行器：用 Vite SSR 把 `@/` 别名解析为 `src/` 打包每个入口，
 * 再逐个交给 Node 执行；任一入口非零退出即整体失败。
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { build } from "vite";

const root = new URL("../..", import.meta.url).pathname;
const outDir = "tmp/smoke";
const entries = [
  "test/smoke/mindmap-logic.ts",
  "test/smoke/workspace-tree.ts",
  "test/smoke/mindmap-outline.ts",
  "test/smoke/mindmap-connectors.ts",
  "test/smoke/tab-session.ts",
  "test/smoke/frame-summary.ts",
];

for (const [index, entry] of entries.entries()) {
  await build({
    root,
    configFile: false,
    logLevel: "error",
    build: {
      ssr: entry,
      outDir,
      // 只由第一个入口清空产物目录，避免后打的包把前一个删掉。
      emptyOutDir: index === 0,
      minify: false,
      target: "node22",
      rollupOptions: { external: [/^node:/] },
    },
    resolve: { alias: { "@": `${root}src` } },
  });
}

let failed = 0;
for (const entry of entries) {
  const script = path.join(root, outDir, entry.replace(/^test\/smoke\//, "").replace(/\.ts$/, ".js"));
  console.log(`\n▶ node ${path.relative(root, script)}`);
  const result = spawnSync("node", [script], { cwd: root, encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) {
    failed += 1;
    console.log(`✖ ${entry} 退出码 ${result.status}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} 个烟雾测试入口失败`);
  process.exit(1);
}
console.log("\n全部烟雾测试通过");
