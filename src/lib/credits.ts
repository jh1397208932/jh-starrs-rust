/**
 * 「关于」页的第三方开源清单与上游项目。
 *
 * 许可证与仓库地址逐条取自 `node_modules/<包>/package.json` 与
 * `cargo metadata`，并由 `scripts/check-licenses.mjs` 在每次构建时复核；
 * 这里只维护「用途」与分组，不写未核对的许可声明。
 */

export interface Credit {
  /** 组件名（不翻译） */
  name: string;
  /** SPDX 标识或权利声明（不翻译） */
  license: string;
  /** 上游仓库（不翻译） */
  url: string;
  /** 在本项目中的用途（中文源文案，渲染时过 t()） */
  usedFor: string;
}

export interface CreditGroup {
  id: string;
  title: string;
  items: Credit[];
}

export const APP_ONE_LINER = "把文档、画板与思维导图收进一个本地工作区的知识笔记应用。";

const FRONTEND: Credit[] = [
  {
    name: "React 19",
    license: "MIT",
    url: "https://github.com/facebook/react",
    usedFor: "界面运行时与标签页树",
  },
  {
    name: "Tauri 2",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/tauri-apps/tauri",
    usedFor: "桌面壳、IPC 与原生窗口（含 dialog / opener / single-instance 插件）",
  },
  {
    name: "TypeScript",
    license: "Apache-2.0",
    url: "https://github.com/microsoft/TypeScript",
    usedFor: "前后端类型（构建期）",
  },
  {
    name: "Vite",
    license: "MIT",
    url: "https://github.com/vitejs/vite",
    usedFor: "前端构建与开发服务（构建期）",
  },
  {
    name: "Tailwind CSS 4",
    license: "MIT",
    url: "https://github.com/tailwindlabs/tailwindcss",
    usedFor: "设计令牌与原子样式（构建期）",
  },
  {
    name: "Radix UI Primitives",
    license: "MIT",
    url: "https://github.com/radix-ui/primitives",
    usedFor: "无障碍对话框、下拉、选择器、标签页、开关与提示",
  },
  {
    name: "Motion",
    license: "MIT",
    url: "https://github.com/motiondivision/motion",
    usedFor: "进场退场、浮窗与手势动效",
  },
  {
    name: "lucide-react",
    license: "ISC",
    url: "https://github.com/lucide-icons/lucide",
    usedFor: "图标集",
  },
  {
    name: "Tiptap 3 + ProseMirror",
    license: "MIT",
    url: "https://github.com/ueberdosis/tiptap",
    usedFor: "文档编辑器、块模型与全部官方扩展",
  },
  {
    name: "lowlight / highlight.js",
    license: "MIT",
    url: "https://github.com/highlightjs/highlight.js",
    usedFor: "代码块语法高亮",
  },
  {
    name: "Excalidraw",
    license: "MIT",
    url: "https://github.com/excalidraw/excalidraw",
    usedFor: "画板编辑器与 .excalidraw 组件库",
  },
  {
    name: "React Flow (xyflow)",
    license: "MIT",
    url: "https://github.com/xyflow/xyflow",
    usedFor: "思维导图画布、缩放与连线交互",
  },
  {
    name: "clsx",
    license: "MIT",
    url: "https://github.com/lukeed/clsx",
    usedFor: "类名拼接",
  },
  {
    name: "tailwind-merge",
    license: "MIT",
    url: "https://github.com/dcastil/tailwind-merge",
    usedFor: "Tailwind 冲突类合并",
  },
  {
    name: "class-variance-authority",
    license: "Apache-2.0",
    url: "https://github.com/joe-bell/cva",
    usedFor: "组件变体（shadcn 风格）",
  },
];

const BACKEND: Credit[] = [
  {
    name: "rusqlite",
    license: "MIT",
    url: "https://github.com/rusqlite/rusqlite",
    usedFor: "SQLite 驱动（bundled）",
  },
  {
    name: "SQLite",
    license: "Public Domain",
    url: "https://sqlite.org",
    usedFor: "工作区数据库引擎",
  },
  {
    name: "serde / serde_json",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/serde-rs/serde",
    usedFor: "IPC 与文档结构序列化",
  },
  {
    name: "uuid",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/uuid-rs/uuid",
    usedFor: "v7 节点与对象主键",
  },
  {
    name: "chrono",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/chronotope/chrono",
    usedFor: "时间戳与备份命名",
  },
  {
    name: "thiserror",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/dtolnay/thiserror",
    usedFor: "统一错误类型",
  },
  {
    name: "blake3",
    license: "CC0-1.0 OR Apache-2.0",
    url: "https://github.com/BLAKE3-team/BLAKE3",
    usedFor: "附件内容寻址哈希",
  },
  {
    name: "xxhash-rust",
    license: "BSL-1.0",
    url: "https://github.com/DoumanAsh/xxhash-rust",
    usedFor: "附件 pack 索引哈希",
  },
  {
    name: "mime_guess",
    license: "MIT",
    url: "https://github.com/abonander/mime_guess",
    usedFor: "附件类型探测",
  },
  {
    name: "office_oxide",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/yfedoseev/office_oxide",
    usedFor: "Word 文档导入",
  },
  {
    name: "docx-rs",
    license: "MIT",
    url: "https://github.com/bokuweb/docx-rs",
    usedFor: "Word 文档导出",
  },
  {
    name: "pulldown-cmark",
    license: "MIT",
    url: "https://github.com/raphlinus/pulldown-cmark",
    usedFor: "Markdown 解析与块切分",
  },
  {
    name: "printpdf",
    license: "MIT",
    url: "https://github.com/fschutt/printpdf",
    usedFor: "PDF 导出",
  },
  {
    name: "image",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/image-rs/image",
    usedFor: "位图缩放与 PNG / JPEG 编码",
  },
  {
    name: "zip",
    license: "MIT",
    url: "https://github.com/zip-rs/zip2",
    usedFor: "XMind 与 Word 容器读写",
  },
  {
    name: "quick-xml",
    license: "MIT",
    url: "https://github.com/tafia/quick-xml",
    usedFor: "FreeMind、OPML 与 docx 的 XML 解析",
  },
  {
    name: "html-escape",
    license: "MIT",
    url: "https://github.com/magiclen/html-escape",
    usedFor: "HTML 导出转义",
  },
  {
    name: "base64",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/marshallpierce/rust-base64",
    usedFor: "图片内联与导出编码",
  },
  {
    name: "percent-encoding",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/servo/rust-url",
    usedFor: "文件路径与资源编码",
  },
  {
    name: "libc",
    license: "MIT OR Apache-2.0",
    url: "https://github.com/rust-lang/libc",
    usedFor: "读取磁盘剩余空间（statvfs）",
  },
  {
    name: "axum",
    license: "MIT",
    url: "https://github.com/tokio-rs/axum",
    usedFor: "本机 MCP HTTP 服务",
  },
  {
    name: "tokio",
    license: "MIT",
    url: "https://github.com/tokio-rs/tokio",
    usedFor: "异步运行时（与 Tauri 共用）",
  },
];

const FONTS: Credit[] = [
  {
    name: "Plus Jakarta Sans",
    license: "SIL OFL 1.1",
    url: "https://fonts.google.com/specimen/Plus+Jakarta+Sans",
    usedFor: "标题字体",
  },
  {
    name: "Inter",
    license: "SIL OFL 1.1",
    url: "https://github.com/rsms/inter",
    usedFor: "正文字体",
  },
  {
    name: "JetBrains Mono",
    license: "SIL OFL 1.1",
    url: "https://github.com/JetBrains/JetBrainsMono",
    usedFor: "等宽与路径展示",
  },
  {
    name: "Excalidraw 随包字体",
    license: "见各自仓库",
    url: "https://github.com/excalidraw/excalidraw",
    usedFor: "画板手写风格（Virgil、Assistant、Nunito、Lilita、Cascadia、Comic Shanns、晓来）",
  },
];

/** 折叠区里的完整清单：按「前端 / 后端 / 字体」分组。 */
export const CREDIT_GROUPS: CreditGroup[] = [
  { id: "frontend", title: "前端与界面", items: FRONTEND },
  { id: "backend", title: "桌面后端与格式", items: BACKEND },
  { id: "font", title: "字体", items: FONTS },
];
