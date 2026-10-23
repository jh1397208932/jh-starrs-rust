# 星屿 Starris · UX 交互规范（UX_SPEC）

> 版本 v1.0 · 视觉基准：`../设计/starris-design-system.html` · 颜色/字号/间距/圆角/动效一律引用 `src/styles/tokens.css` 令牌，禁止硬编码值。
> 适用：Phase2 纯前端 mock（无后端、无持久化）。所有颜色以令牌名书写（如 `bg-popover`、`text-muted-foreground`、`--space-3`）。

---

## 1. 全局架构

### 1.1 无边框窗口与自定义标题栏（36px）

Tauri `decorations: false`，自绘标题栏：

- **左侧**：macOS 红黄绿三圆点（系统注入区域，预留 `--space-5` 宽度，不做假按钮）；随后是当前「工作空间名 · 活动标签页标题」（`text-caption`，`text-muted-foreground`，超长省略）。
- **中部**：搜索图标按钮（触发 ⌘⇧F 全局搜索，本阶段 toast）。
- **右侧**：主题模式快捷切换（☀/☾，同设置-外观）、最小化/最大化/关闭按钮（本阶段仅最大化/关闭可用，`hover:bg-secondary`）。
- **拖拽区**：标题栏整条加 `data-tauri-drag-region`；内部按钮/交互元素除外（事件 stopPropagation）。
- 背景 `bg-sidebar`，底边 1px `border-border`；文字对比随主题令牌自动满足。

### 1.2 布局分区（自上而下）

```
┌ 标题栏 36px（bg-sidebar，drag-region）
├ 主体 flex row
│  ├ 左侧栏 244px（可折叠至 0，⌘\）—— bg-sidebar，右缘 1px border
│  ├ 内容区 flex-1（bg-background）
│  │   ├ 标签页栏 36px
│  │   ├ 工具栏 40px
│  │   └ 编辑器/画布 flex-1
│  └ 右信息面板 260px（可关闭）—— bg-card，左缘 1px border
└ 状态浮层：Toast（底部居中）、确认弹窗（居中）、各 popover
```

### 1.3 折叠与响应规则（桌面应用，按窗口宽度而非断点）

| 窗口宽度 | 行为 |
|---|---|
| ≥1280px | 左侧栏+右面板默认展开 |
| 1024–1279px | 左侧栏展开、右面板默认关闭（工具栏 ☰ 按钮可开） |
| <1024px | 左侧栏自动折叠为 0，仅剩悬浮展开把手（左缘竖条 hover 出现） |

- 折叠动画：`width` 由容器 transform 呈现，过渡 `--dur-2` + `--ease`，只动 transform/opacity（面板用 translateX 实现，勿 transition width）。
- 折叠状态是 UI 态，本阶段不持久化。

---

## 2. 主界面交互规格

### 2.1 左侧栏（244px，`--sidebar-*` 令牌组）

自上而下：

1. **Logo + 空间名**：logo SVG（`fill=var(--logo-a/b/c)`，最小 16px）+ 空间名（`--text-body`/700）。**点击 → 工作空间切换浮层**（弹窗 A）；hover 背景 `bg-secondary`。
2. **三个快捷钮**（等宽三列，图标 20px + caption 文案，`text-sidebar-muted`）：
   - ☆ 收藏 → 内容区打开「收藏列表」虚拟页（mock）；无收藏时空状态 5.1-b。
   - ✎ 小记 → 新建一个「小记」文档并打开（mock 直接新建标签页）。
   - ＋ 新建 → 新建文档标签页（等同 ⌘N）。
3. **文件夹树**：单层文件夹 + 子项（文档 ▪ / 画板 ✎ / 表格 ⊞ 三种 lucide 图标，16px）。
   - 状态：**选中** = `bg-sidebar-active` + `text-sidebar-active-fg` + 600 字重；**hover** = `bg-secondary`；**展开箭头** ▸/▾ 点击整行切换，子项缩进 `--space-4`。
   - 行高 32px，圆角 `--radius-sm`，文字超长 `text-overflow: ellipsis`。
   - 键盘：树容器可聚焦（`tabindex=0`），↑↓ 在可见项间移动，→ 展开 / ← 折叠，Enter 打开。
4. **底部「更多」按钮**：`⋯ 更多` + `⌘J` kbd 徽标（`.kbd` 样式），上缘 1px dashed `border-border` 分隔。点击 → 更多菜单（弹窗 B），从按钮上方弹出。

### 2.2 标签页栏（36px）

- 标签 = 类型徽标（文档/画板/表格，badge-doc / badge-board 样式，11.5px）+ 标题（最长 160px 省略）+ 关闭 ×。
- **激活标签** = `bg-accent` + `text-accent-foreground`；非激活 `text-muted-foreground`，hover `bg-secondary`。
- 关闭 ×：默认 `opacity .5`，hover 标签时 1；点击只关该标签（不弹确认；有未保存改动时 toast「已自动保存，标签已关闭」）。
- `＋ 新建`：幽灵图标按钮，点击同 ⌘N。
- **溢出**：横向滚动（`overflow-x: auto`，隐藏滚动条），不换行不缩窄；滚轮在栏上可横滚。

### 2.3 工具栏（40px，标签栏之下）

左→右：类型徽标（文档=badge-doc / 画板=badge-board）＋ 标题（画板视图显示）｜flex-1 弹性空隙｜`✓ 已自动保存`（`text-muted-foreground`，caption）｜☆ 收藏（toggle，已收藏换填充色 `--primary`）｜☰ 目录（文档视图显示，点击→大纲面板弹窗）｜大纲 ▮｜分享 ⇪（→弹窗 C）｜打印 ⎙（本阶段 toast「已触发打印」）。

### 2.4 编辑器区（Tiptap 3.32，已持久化）

- 结构：类型徽标 +「输入 / 唤起命令」→ 标题（`--text-display`）→ meta 行（字数/创建/最近编辑/保存状态）→ 正文（15.5px/1.78，52px 手柄走廊，走廊包含在可编辑区 padding 内）。
- 正文从 `doc_load` 读取根 doc `{"type":"doc","content":[...]}`，1s 防抖保存；保存状态：本地自动保存 / 有未保存更改 / 正在保存 / 已保存 / 保存失败·重试。
- 气泡菜单：B/I/U/S/Code、颜色/高亮、链接、上下标、清除格式；右键菜单：行内格式、颜色、块类型、对齐、插入、表情、表格上下文；Slash 菜单：304px、分组 + 说明、↑↓/Enter/Esc。
- 块样式：标题 H1–H3、引用、代码块、表格、图片缩放、折叠块、任务列表、占位符；块手柄自绘定位，块拖拽使用 PointerEvent + 自绘 3px 主色落点线与源块淡化；官方 Dropcursor 仅用于图片/文件原生拖放。
- 回车新块清空行内样式；列表继续列表、标题尾进入正文；切换标签/空间前 flush。

### 2.5 画板视图（excalidraw 占位）

- 工具栏：画布顶部居中浮动条（`bg-popover` + `border` + `shadow-md`，圆角 `--radius`），工具项 32px 方块，激活 `bg-accent`+`text-accent-foreground`。
- 左侧属性面板（描边/背景色板、描边宽度、边角、透明度滑杆）、右侧组件库面板（分类 chips + 组件卡片网格）均为静态 mock，可显示可关闭（×）。
- 底部居中缩放条：－ / 100% / ＋ / 撤销 / 重做（本阶段仅 UI，缩放不实现）。

### 2.6 右信息面板（260px，`bg-card`）

- **三个 tab**（信息 / 反链 / 相关）：分段控件样式——容器 `bg-muted` 圆角 pill，激活段 `bg-card` + `shadow-sm` + 650 字重（对应原型 `.seg`）。
- **信息 tab 字段列表**（kv 行：label 左 `text-muted-foreground`、值右 `text-foreground`，值超长省略）：字数 / 创建时间 / 最近更新 / 所在知识库 / 存储位置 / 引用关系（`N 条反链`）。
- **反链 / 相关 tab**：列表项（标题 + 所在知识库 caption）；无数据时进入空状态 5.1-c。
- **底部统计**：上缘 1px `border` 分隔，主色圆点 + `知识库名 · N 字`（caption）。

---

## 3. 弹窗清单

通用规则：所有弹窗背景遮罩 = `foreground` 32% 透明 + 轻微 backdrop-blur；容器 `bg-popover` + `border` + `shadow-lg` + `radius-lg`；入出场 `--dur-2`/`--ease`（opacity + scale .98→1）；**Esc 一律关闭**；遮罩点击可关（首启向导除外）；打开时焦点移入弹窗首个可交互元素，关闭后焦点归还触发者。

| # | 弹窗 | 触发 | 尺寸 | 结构要点 | 关闭 |
|---|---|---|---|---|---|
| A | **工作空间切换浮层** | 点击左栏 logo/空间名 | 280px 锚定弹出（popover，非模态） | 「工作空间」组：头像块（首字 + `bg-primary` 圆角方块）+ 名称 + mono 路径；分隔线；「知识库」组：主色圆点 + 名称 + 描述；分隔线；▤ 新建知识库；⚙ 管理（→弹窗 H） | Esc / 点击外部 |
| B | **更多菜单** | 左栏底部 ⋯ / ⌘J | 260px 锚定弹出 | ⚙ 设置（→弹窗 C）；提示行（六个 tab 名 caption）；sep；▤ 模板库、▦ 组件库（均 toast「本阶段未实现」）；sep；⬇ 全部导出、⬆ 导入文档（toast）；sep；🏪 备份与恢复（toast） | Esc / 点击外部 |
| C | **设置** | 更多菜单 / ⌘, | 720×480 居中模态 | 左导航列（160px：通用/外观/快捷键/存储/云同步/关于，激活 `bg-accent`）+ 右内容区。**外观**：浅/深两张预览卡（激活 `border-primary`+✓）+ 9 主题色板网格（雾光青/晴空蓝/星澜紫/暖砂金/苔屿绿/樱雾粉/暮霭紫/石墨灰/晨光橙；点击即换 `data-theme`，当前项 border-primary + 「使用中」badge-solid）；**快捷键**：行列表（名称 + `.kbd` 组合键，点击开始录制——本阶段仅展示）；**存储**：工作区路径卡 + 附件管理器（活跃/逻辑大小/物理占用/唯一对象四格统计、big/pack/死字节摘要、逻辑目录输入 + 选择文件上传 + 含已删除/刷新、附件行含名称/目录/MIME/哈希摘要/时间/大小/校验/导出/删除二次确认；空/加载/错误状态）；通用/云同步/关于：静态说明占位 | Esc / 右上 × / 底部「完成」 |
| D | **创建工作空间（首启向导）** | 首次启动自动 / 工作空间切换浮层「＋」 | 420px 居中模态，**无 × 遮罩不可关** | logo + 标题 + 说明；存储方式二选卡（本地文件=激活态 accent，云同步=可点但选中后 toast「暂未支持」）；空间名称 Input（校验：非空、不以空格开头，错误 `border-destructive` + `field-err`）；存储位置行（只读路径 + 「选择文件夹…」按钮 toast）；空间头像色点行（6 色，选中 outline-primary）；底部主按钮「创建工作空间」（校验通过才可用，disabled `opacity .5`） | 仅「创建工作空间」成功后关闭 |
| E | **新建知识库** | 切换浮层「新建知识库」/ 管理弹窗 | 400px 居中模态 | 标题「新建知识库」；名称 Input（同 D 校验）；描述 Textarea（选填）；底部：取消（ghost）+ 创建（primary） | Esc / × / 取消 |
| F | **知识库管理** | 切换浮层「管理」 | 560×400 居中模态 | 顶部：当前空间名（caption）+「＋ 新建知识库」（→弹窗 E）；表格：名称/描述/文档数/操作（名称列 hl 行 = `bg-accent` + 主色圆点标记「当前」）；操作列 ⋯ → 行内小菜单（重命名 toast / 删除 → 确认弹窗，destructive 按钮） | Esc / × |
| G | **工作空间管理** | 切换浮层「管理工作空间」 | 560×400 居中模态 | 与 F 同构：空间列表（头像块+名称+路径），当前项 badge「当前」；操作 ⋯：切换 / 删除（确认弹窗，当前空间禁删 toast 提示） | Esc / × |
| H | **分享与导出** | 工具栏 ⇪ | 460px 居中模态 | 文档摘要卡（`bg-accent`：📄标题 + 知识库/字数/时间 caption）；两个选项卡行（border 包裹，右 ↗）：「导出为 Markdown」「发布到云」——点击均 toast「已触发 ⌘E 导出（mock）」；底部「关闭」ghost | Esc / × / 关闭 |
| I | **Slash 命令菜单** | 编辑器内键入 `/`（空白/中文标点后） | 304px 锚定编辑器光标 | 顶部「插入内容」+ `/` 键帽；分组：基础（正文/H1-H3）、列表（无序/有序/任务）、块（引用/代码/折叠/分隔线）、插入（表格 3×3/图片/表情）；输入即过滤；项 = 26px 图标块 + 名称 + 说明；激活项 `bg-accent`；底部 ↑↓/Enter/Esc 提示 | Esc / 点击项 / 插入完成 |

---

## 4. 快捷键表

| 快捷键 | 功能 | 本阶段行为 |
|---|---|---|
| ⌘N | 新建文档 | ✅ 实装（新标签页 + 树中插入 mock 项） |
| ⌘K | 快速跳转 | 🔶 toast「已触发 ⌘K 快速跳转（mock）」 |
| ⌘⇧F | 全局搜索 | 🔶 toast「已触发 ⌘⇧F 全局搜索（mock）」 |
| ⌘, | 打开设置 | ✅ 实装（弹窗 C） |
| ⌘W | 关闭当前标签页 | ✅ 实装 |
| ⌘S | 保存当前文档 | ✅ 实装（工具栏状态闪「✓ 已保存」toast） |
| ⌘D | 收藏/取消收藏 | ✅ 实装（toggle 星标 + toast） |
| ⌘\ | 显示/隐藏左侧栏 | ✅ 实装（折叠动画） |
| ⌘P | 全屏放映当前画板 | 🔶 toast「已触发 ⌘P 放映（mock）」 |
| ⌘J | 更多菜单 | ✅ 实装（弹窗 B） |
| Esc | 关闭弹窗/浮层 | ✅ 实装 |
| / | 编辑器内 slash 菜单 | ✅ 实装（弹窗 I） |

实现说明：⌘K/⌘⇧F/⌘P 统一走 `showMockToast(label)`；toast 文案格式「已触发 {快捷键} {功能名}（mock）」。

---

## 5. 空状态与反馈

### 5.1 四种空状态（结构 = glyph 34px opacity .4 + 标题 body/700 + 说明 caption + 引导按钮）

| 场景 | glyph | 标题 | 说明 | 引导动作 |
|---|---|---|---|---|
| a. 空文档（编辑器无内容） | ✦ | 从一个想法开始 | 输入 / 唤起命令，或拖入 Markdown 文件 | 「＋ 新建文档」主按钮 |
| b. 无收藏 | ☆ | 还没有收藏 | 点击文档工具栏的 ☆ 即可收藏到这里 | 「⌘D 收藏当前文档」次按钮 |
| c. 无反链/无相关 | ⛓ | 暂无反向链接 | 在其他文档中 `[[引用]] 本文档后显示 | 切到「信息」tab ghost 链接 |
| d. 无搜索结果 | ⌕ | 没有找到匹配项 | 试试更短的关键词 | 无按钮（仅文案） |

### 5.2 Toast 规范

- **位置**：底部居中，距底 `--space-6`；**时长**：3s 自动消失；同一时刻最多 1 条，新 toast 替换旧的。
- 样式：`bg-popover` + `border` + `shadow-lg` + `radius`，内含主色圆形 ✓（成功）或 `bg-destructive`（失败）+ 文案（13.5px）+ 可选 kbd 徽标。
- 类型：成功（✓ 主色 tick）、失败（destructive tick）、mock 触发（✓ + kbd）。不提供关闭按钮（3s 即逝）。
- 触发点：⌘S/⌘D/导出/导入/备份/未实现功能、删除确认成功等。

### 5.3 删除确认弹窗（复用规格）

小模态 320px：标题（「删除知识库/工作空间 X？」）+ 说明（destructive 提示语）+ 按钮：取消（ghost，默认焦点）+ 删除（destructive）。Esc = 取消；Enter = 执行删除。

### 5.4 Mock 数据约定（附录）

所有列表数据用 `src/mocks/*.ts` 常量数组，不接存储。字段建议：

```ts
// Workspace: { id, name, path, avatarColor, isCurrent }
// KnowledgeBase: { id, workspaceId, name, description, docCount, isCurrent }
// NodeItem(树节点/文档): { id, kbId, parentId | null, title, kind: 'doc'|'board'|'table', updatedAt, wordCount, starred }
// TabItem: { id, nodeRef, kind, title, isActive }
```

- 至少 1 个工作空间（含 2 个知识库、6–8 个节点，覆盖三种 kind 与一颗子树）；时间戳写死字符串（如 `2026-10-15 16:32`）。
- 组件一律从 mock 常量取数渲染，保证「新建/删除」在本阶段仅操作内存数组。

---

## 6. 无障碍与键盘

1. **焦点环**：所有可交互元素 `:focus-visible` 使用 `ring-ring`（`outline: 2px solid var(--ring); outline-offset: 2px`），禁止移除 outline 且不补环。
2. **焦点顺序**：从左到右、从上到下与视觉一致；弹窗打开时焦点圈定在弹窗内（focus trap），关闭归还触发元素。
3. **Esc**：关闭一切浮层/弹窗/菜单（首启向导 D 除外）；Esc 在菜单内先取消高亮再二次关闭可简化为一次关闭。
4. **方向键导航**：更多菜单/slash 菜单/工作空间切换浮层内 ↑↓ 移动高亮、Enter 确认；树内规则见 2.1-3；设置左导航 ↑↓ 切 tab。
5. **删除类操作**（删知识库/工作空间/标签页批量清空）一律先弹确认弹窗（5.3），默认焦点在「取消」。
6. **ARIA**：树 = `role="tree"/"treeitem"` + `aria-expanded`；tab 组 = `role="tablist"/"tab"` + `aria-selected`；弹窗 = `role="dialog"` + `aria-modal="true"` + `aria-labelledby`；图标按钮必须有 `aria-label`（如「关闭标签页」「分享」）。
7. **对比度**：文字只用 `--foreground`/`--muted-foreground` 两级（12px 以上才用 muted）；选中态遵循 accent 公式；深浅模式由令牌自动保证，组件不写 `prefers-color-scheme`。
8. **动效降级**：`@media (prefers-reduced-motion: reduce)` 下禁用全部 transition/animation（同原型做法）。
9. **触控/指针**：桌面鼠标为主；所有可点击目标 ≥ 24×24px，图标按钮实际热区 32px。

## 11. 文档图片块与附件块（2026-10-22）

- 图片块：左/中/右对齐，选中 2px 主色环 + 左右缩放柄，上方 27px 按钮浮条（对齐 + 下载）；预览加载/失败/超大均有占位与下载兜底。
- 附件块：卡片（210px，图标+名称+大小）与长条（全宽，图标左置）两种形态；组级对齐；逐项下载/移除；选中时浮条提供对齐与形态切换。
- 浮条定位基准：横向中心对齐**块的实际内容**（图片本体/卡片组），不是正文行中心；卡片形态下外壳收缩到卡片组宽度，长条形态铺满。
- 外部文件拖放：从访达拖入的文件按落点插入正文（图片→图片块，其余→附件块）；落点在正文容器外不写入文档。真机下拖放不经过网页 `drop` 事件，由 Tauri webview 事件提供绝对路径。
- 文件图标：折角页面 + 类型色 + 扩展名标签；类型色全部来自语义令牌；卡片 56×68、长条 36×44。
- 上传：Slash/右键文件选择走路径上传；粘贴/拖放走 raw bytes 上传；编辑器头部显示上传中提示；文档 JSON 只保存 attachmentId 与展示元数据。
