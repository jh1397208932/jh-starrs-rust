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
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), fontLicenseGuard()],

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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
