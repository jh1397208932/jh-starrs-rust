/**
 * 打包并运行思维导图基准。
 *
 * 用 Vite SSR 构建把 `@/` 别名解析为 `src/`，产物为独立 ESM 文件后用 Node 执行。
 */

import { build } from "vite";

const root = new URL("../..", import.meta.url).pathname;

await build({
  root,
  configFile: false,
  logLevel: "error",
  build: {
    ssr: "test/bench/mindmap-bench.ts",
    outDir: "tmp/bench",
    emptyOutDir: true,
    minify: false,
    target: "node22",
    rollupOptions: {
      external: [/^node:/],
    },
  },
  resolve: {
    alias: {
      "@": `${root}src`,
    },
  },
});
