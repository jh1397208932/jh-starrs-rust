<div align="center">
  <img src="src-tauri/icons/icon.png" width="112" alt="星屿 Starris" />
  <h1>星屿 Starris</h1>
  <p><strong>本地优先的一体化知识工作台</strong></p>
  <p>文档 · 画板 · 思维导图 · 表格 / 流程图 · 附件 · 全文检索 · 可选 AI 协作</p>
  <p>
    <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?logo=windows&logoColor=white" />
    <img alt="macOS" src="https://img.shields.io/badge/macOS-12%2B-000000?logo=apple&logoColor=white" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" />
    <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-B7410E?logo=rust&logoColor=white" />
  </p>
  <img src="docs/设计/2026-10-27-README-001/图片/doc-editor.png" width="92%" alt="星屿主界面" />
</div>

---

## 星屿是什么

星屿是一款运行在本机的桌面知识库。文档、画板、思维导图、表格、流程图和附件都放在同一个工作区里，用同一棵树管理；所有内容保存在你自己的磁盘上，不需要账号，也不依赖云端。

适合个人知识管理、产品与设计资料整理、会议和项目记录，以及希望把资料留在本机、同时愿意让 AI 辅助整理的人。

## 功能

### 写作

- 块级富文本编辑器：标题、列表、待办、引用、代码块、表格、图片、Emoji、折叠块、目录。
- 斜杠菜单插入内容，块手柄拖拽排序，自动保存；支持文档内查找与全文检索。
- 收藏、信息面板、反向链接、知识网络、历史版本回看与恢复。
- 外部修改检测：内容在别处被改动时提示，不会静默覆盖。

### 画板

- 常用图形、文本、连线、便签、自由绘制与图片。
- 组件库导入与管理，一键插入；支持全屏放映。
- 导出 PNG / SVG / Excalidraw。

### 思维导图

- 8 种结构：左右平衡、逻辑图（左 / 右）、组织架构（上 / 下）、树状图、时间轴、鱼骨图。
- 分支彩虹配色、多套画布主题；主题边框 12 色、四种形状、三档粗细与填充。
- 备注、标签、超链接、图片、优先级 / 进度 / 旗标等标记、贴纸。
- 自由主题、关系线、外框、概要、自动编号、大纲视图、搜索定位、拖拽换父与排序。
- 导入导出 XMind、FreeMind、OPML、Markdown、原生无损文件与 PNG / SVG。

### 附件与检索

- 附件可上传、预览、下载、重命名；相同文件自动去重，支持回收站与容量统计。
- 全局搜索（标题 + 正文）、快速跳转、最近使用与收藏页。
- 文档、画板、思维导图、表格 / 流程图和附件共用同一棵文件树。

### 导入导出与模板

- 文档导出 Markdown / HTML / Word / PDF；整库连同附件打包导出。
- 导入 Markdown、Word、XMind 与 Excalidraw；支持批量导入。
- 文档另存为模板，从模板快速创建内容。

### 个性化与数据安全

- 多套主题配色，浅色 / 深色；简体中文与 English 即时切换。
- 快捷键可开关、可改键，冲突提示；侧栏、标签页、单实例窗口。
- 回收站、文档历史、工作区备份与恢复。
- 数据默认保存在用户主目录下的 `.starris/rust`，可用 `STARRIS_HOME` 指定其他位置。

### AI 协作（可选）

- 客户端内置 MCP 服务：打开星屿即可被 AI 工具连接，关闭即停止，只监听本机。
- 三档写入权限（只读 / 需人工确认 / 可编辑），高风险操作强制待审，所有写入可审计。
- AI 提出的修改先进入待审区，你确认后才真正落库。

## 界面预览

<div align="center">
  <img src="docs/设计/2026-10-27-README-001/图片/board.png" width="49%" alt="画板" />
  <img src="docs/设计/2026-10-27-README-001/图片/mindmap.png" width="49%" alt="思维导图" />
</div>

## 安装

### Windows 10 / 11

1. 从发布页下载 `Starris_<版本>_x64-setup.exe`。
2. 运行安装程序，按提示完成安装；Windows 10/11 通常已内置 WebView2，缺失时安装程序会按需下载引导器。
3. 首次启动若 SmartScreen 提示「未知发布者」，选择「更多信息 → 仍要运行」（当前构建未做代码签名）。
4. 首次启动会引导创建一个本地工作区：选择一个空文件夹即可。

### macOS 12+

1. 从发布页下载 `.dmg`，打开后将「星屿」拖入「应用程序」。
2. 首次启动若提示「无法验证开发者」，前往「系统设置 → 隐私与安全性」允许打开。
3. 首次启动选择或创建一个空文件夹作为工作区。

> 当前主要维护 macOS 与 Windows 两个平台；Linux 可自行从源码构建，尚未做发布级验收。

## 从源码编译

### 环境要求

| 依赖 | Windows | macOS |
|---|---|---|
| Node.js | 22 LTS 及以上 | 22 LTS 及以上 |
| 包管理器 | npm（随 Node 安装） | npm |
| Rust | stable，支持 edition 2024（建议 1.85+） | 同左 |
| 原生工具链 | Visual Studio Build Tools（使用 C++ 的桌面开发）+ Windows SDK | Xcode Command Line Tools |
| 运行时 | WebView2 Runtime（Windows 10/11 通常已内置） | 系统 WebKit |

### 开发运行

```bash
git clone <仓库地址>
cd jh-starrs-rust
npm install
npm run tauri dev
```

首次运行会在 `src-tauri/target/` 下编译 Rust 依赖，耗时取决于机器性能。

### 构建安装包

```bash
# Windows：NSIS 安装程序（.exe）
npm run package:win

# macOS：当前架构 DMG
npm run package:dmg

# macOS：Intel + Apple Silicon 通用 DMG
# 首次需执行：rustup target add x86_64-apple-darwin
npm run package:dmg:universal
```

构建产物位于 `src-tauri/target/release/bundle/`。

### 质量检查

```bash
npm run check          # 前端静态检查（Biome）
npm run typecheck      # TypeScript 类型检查
npm run test:backend   # Rust 后端测试
npm run check:licenses # 第三方许可证门禁
```

## 快速上手

1. **创建工作区**：首次启动新建工作区，选择空文件夹；之后可在侧栏切换或管理。
2. **新建内容**：在知识库中新建文件夹、文档、画板、表格、流程图、思维导图或附件。
3. **写作**：进入文档直接输入；输入 `/` 打开插入菜单，内容自动保存。
4. **画板**：选择画板后使用顶部工具与组件库；放映模式可全屏展示。
5. **思维导图**：`Tab` 新建子主题、`Enter` 新建同级主题；页头切换结构与配色。
6. **检索**：全局搜索、快速跳转、文档内查找都在快捷键中随时可用。
7. **备份**：整个工作区目录可直接复制；应用内「更多 → 备份与恢复」也可导出 / 恢复。
8. **连接 AI（可选）**：设置 → AI 协作 → MCP 服务，复制地址与令牌填入 AI 工具：

```jsonc
{
  "mcpServers": {
    "starris": {
      "type": "http",
      "url": "http://127.0.0.1:47821/mcp",
      "headers": { "Authorization": "Bearer <在设置中复制的令牌>" }
    }
  }
}
```

### 常用快捷键

| 操作 | Windows / Linux | macOS |
|---|---|---|
| 新建内容 | `Ctrl+N` | `⌘N` |
| 更多菜单 | `Ctrl+J` | `⌘J` |
| 打开设置 | `Ctrl+,` | `⌘,` |
| 全局搜索 / 快速跳转 | `Ctrl+Shift+F` / `Ctrl+K` | `⌘⇧F` / `⌘K` |
| 收藏 / 取消收藏 | `Ctrl+D` | `⌘D` |
| 立即保存 | `Ctrl+S` | `⌘S` |
| 收起 / 展开侧栏 | `Ctrl+\` | `⌘\` |
| 关闭当前标签 | `Ctrl+W` | `⌘W` |
| 放映当前画板 | `Ctrl+P` | `⌘P` |

> 快捷键可在「设置 → 快捷键」查看、改键或整体关闭。

## 数据与隐私

- 所有内容保存在本地，不上传云端；断网也能使用。
- 工作区是普通文件夹，可直接备份、拷贝或迁移。
- 日志只记录运行状态与错误类别，不写文档正文与敏感数据。
- AI 协作默认关闭写权限；开启后所有写入都会进入待审或审计流程。

## 开源声明

星屿以源码公开的方式维护，欢迎阅读、试用、提交 Issue 与 Pull Request。

本项目站在许多优秀开源项目的肩膀上，感谢它们的作者与社区：

| 项目 | 用途 |
|---|---|
| [Tauri 2](https://tauri.app/) / [Rust](https://www.rust-lang.org/) | 桌面应用框架与本地后端 |
| [React 19](https://react.dev/) / [TypeScript](https://www.typescriptlang.org/) / [Vite](https://vite.dev/) | 界面与构建 |
| [Tailwind CSS 4](https://tailwindcss.com/) / [Radix UI](https://www.radix-ui.com/) | 样式系统与无障碍基础组件 |
| [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) | 文档编辑器 |
| [Excalidraw](https://excalidraw.com/) | 画板引擎 |
| [React Flow](https://reactflow.dev/) | 思维导图画布 |
| [Motion](https://motion.dev/) / [Lucide](https://lucide.dev/) | 动效与图标 |
| [SQLite](https://sqlite.org/) / [rusqlite](https://github.com/rusqlite/rusqlite) | 本地数据库 |
| [axum](https://github.com/tokio-rs/axum) / [Tokio](https://tokio.rs/) | 本机 AI 服务 |
| [serde](https://serde.rs/) / [zip](https://github.com/zip-rs/zip2) / [quick-xml](https://github.com/tafia/quick-xml) | 序列化与 Office / XMind 解析 |
| [printpdf](https://github.com/fschutt/printpdf) / [docx-rs](https://github.com/cstkingkey/docx-rs) / [office_oxide](https://crates.io/crates/office_oxide) | PDF / Word 导出与导入 |
| [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) / [image](https://github.com/image-rs/image) | Markdown 与图片处理 |
| [BLAKE3](https://github.com/BLAKE3-team/BLAKE3) / [xxHash](https://github.com/Cyan4973/xxHash) | 附件去重与索引哈希 |

第三方依赖的版权与许可证归各自作者所有，完整清单与审查结论见 [第三方依赖许可证审查](docs/开发/第三方依赖许可证审查.md)。

> 说明：仓库当前尚未附带 `LICENSE` 文件；正式对外分发或再发布衍生版本前，请以维护者补充的许可证文件为准。

## 贡献

- 提交问题前请先搜索现有 Issue，并尽量附上系统版本、复现步骤与日志（`~/.starris/rust/logs/starris.log`）。
- 提交代码前请确保 `npm run check`、`npm run typecheck`、`npm run test:backend` 通过。
- 开发约定、目录结构与测试说明见 [docs/开发](docs/开发/README.md)。

<div align="center">
  <sub>星屿 Starris · 把知识留在自己的岛上</sub>
</div>
