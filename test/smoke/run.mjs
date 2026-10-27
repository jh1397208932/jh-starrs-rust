/** 用 Vite SSR 打包纯逻辑烟雾测试后交给 Node 执行。 */
import { build } from "vite";

const root = new URL("../..", import.meta.url).pathname;

await build({
  root,
  configFile: false,
  logLevel: "error",
  build: {
    ssr: "test/smoke/mindmap-logic.ts",
    outDir: "tmp/smoke",
    emptyOutDir: true,
    minify: false,
    target: "node22",
    rollupOptions: { external: [/^node:/] },
  },
  resolve: { alias: { "@": `${root}src` } },
});
