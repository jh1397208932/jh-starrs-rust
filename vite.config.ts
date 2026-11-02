import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { fileURLToPath } from "node:url";
const host = process.env.TAURI_DEV_HOST;

/**
 * 生产构建只允许已知开源字体（OFL/MIT/MIT 字体）。
 * 白名单与 scripts/check-licenses.mjs 保持一致；未列入的字体资产直接剔除，
 * 避免 GPL/旧字体 EULA/许可不明的字体随安装包分发。
 */
const ALLOWED_FONT_MARKERS = [
  "assistant",
  "virgil",
  "nunito",
  "lilita",
  "cascadia",
  "comicshanns",
  "xiaolai",
];

function fontLicenseGuard(): Plugin {
  return {
    name: "starris-font-license-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "asset" || !/\.(woff2?|ttf|otf|eot)$/i.test(fileName)) continue;
        const lower = fileName.toLowerCase();
        if (ALLOWED_FONT_MARKERS.some((marker) => lower.includes(marker))) continue;
        delete bundle[fileName];
        this.warn(`[font-license-guard] 已从构建产物移除未列入开源白名单的字体：${fileName}`);
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 生产构建：去掉 console/debugger（含第三方库的调试输出），关闭 sourcemap 与体积统计，
  // 由 esbuild 压缩 + 现有代码分包换取更小产物体积；开发态保留日志与源码映射。
  const isProduction = mode === "production";
  return {
    plugins: [react(), tailwindcss(), fontLicenseGuard()],

    build: isProduction
      ? {
          // Vite 8 默认用 Oxc 压缩（Rolldown），比 esbuild 路径更小且无需额外依赖。
          minify: "oxc",
          cssMinify: true,
          sourcemap: false,
          reportCompressedSize: false,
          // 大型第三方库（Excalidraw / Tiptap）按需分包后仍会有 >500KB 的单块，属预期。
          chunkSizeWarningLimit: 1600,
        }
      : undefined,

  // 预构建 Tauri 包：懒加载的插件包若在运行中被首次发现，Vite 会整页 reload，
  // 冲掉标签页等内存状态（真机 E2E 因此在新建思维导图后丢失标签页）。
  optimizeDeps: {
    include: ["@tauri-apps/api", "@tauri-apps/plugin-dialog", "@tauri-apps/plugin-opener"],
  },

  // 路径别名 @/ → src/（与 tsconfig paths 同步，AGENTS.md §3.7）
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      // 4. tmp/ 是黑盒测试与导出的落盘目录；被监听到会触发 HMR / 整页重载，冲掉运行中的标签页
      ignored: ["**/src-tauri/**", "**/tmp/**", "**/dist/**"],
    },
  },
  };
});
