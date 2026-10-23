# 星屿 Starris · UI 设计规范（UI-SPEC）

> 本文件是全项目 UI 开发的唯一权威规范入口。详细令牌定义见 `src/styles/tokens.css`，交互规格见 `docs/ui设计规范/UX_SPEC.md`，令牌使用规则见 `docs/DESIGN_TOKENS.md`。视觉基准原型 `docs/设计/starris-design-system.html` 是第五轮历史基线；**第十一轮「雾光笺」以 `tokens.css` + `app.css` 与本文件为准**。

## 1. 主题体系

- **9 套预设主题**：雾光青 `mist`（默认）/ 晴空蓝 `azure` / 星澜紫 `midnight` / 暖砂金 `amber` / 苔屿绿 `forest` / 樱雾粉 `rose` / 暮霭紫 `violet` / 石墨灰 `graphite` / 晨光橙 `sunset`。
- 每套主题含浅色与深色两组变量；运行时切肤只修改 `<html>` 的 `data-theme` / `data-mode` 两个属性，组件层零改动。
- 品牌三色：`--logo-a`（主岛）/ `--logo-b`（伴屿，accent-fg 深一档）/ `--logo-c`（星，低饱和金），logo SVG 禁止写死色值。
- **第十一轮雾光笺**：所有 light 主题统一「高明度、低饱和、中对比」；文字共用中性墨色（`#1D201F / #626663`，tint ≤ 4）；主题个性只由 `primary / accent / sidebar / wash-1..3` 承担。
- **主题升级**：`appearance.designVersion = 2`；仅在「无版本号且已存主题为旧默认 `sunset`」时一次性迁移到 `mist`，用户选过的其它主题不动。Rust `THEME_NAMES` 必须与前端 `THEME_NAMES` 同为一个 9 项白名单（新增主题要同步改 Rust 常量与单测）。

## 2. 颜色使用规则

| 场景 | 令牌 | 禁止 |
|---|---|---|
| 正文 / 标题 | `--foreground` | 色板外的灰色 |
| 辅助文字（≥12px） | `--muted-foreground` | 更浅的自定灰 |
| 侧栏选中 / hover | `--sidebar-active` 底 + `--sidebar-active-fg` 字 | 侧栏行铺白卡 |
| 主区选中 / 浅调强调 | `--accent` 底 + `--accent-foreground` 字 | 发明第二套高亮 |
| 主按钮（第十一轮扁平浅调） | `--accent` 浅调底 + `--accent-foreground` 字 + `ring-1 ring-primary/20`，hover `primary/15` | 浅色主题 primary 填充白字；内高光/渐变/重投影 |
| 危险操作 | `--destructive` | — |
| 结构线 | `--border` 66%~90% 混透明 | 用 24% 以上的线画普通分隔 |
| 纹理 | `--texture-grain` + `--wash-1/2/3` | 大面积纯色或第二套渐变 |

- **琥珀/主题色不做正文色**：`--primary` 对浅调底的对比不足以承载正文，主色退到图标、描边、指示位；浅调底上的文字一律用 `--accent-foreground`。
- **一屏一个视觉焦点**：主按钮最多一个；空态 CTA 用浅调 + 深字，主色只给图标与描边。
- **工作区入口是透明品牌行**：不允许白底、不允许边框；hover / 展开只用 `--sidebar-active` 55%。
- **快捷入口图标底片**承担主题色（32px，圆角 10，1px `currentColor 16%`），不再画三张白卡。

## 3. 字体与字号

- 字体栈：`system-ui, -apple-system, "PingFang SC", …`（`--font-ui`）；代码/键帽/数字 `--font-mono`；**空态大标题与品牌字标**用宋体编辑感 `--font-display`（`Songti SC / STSong / Noto Serif SC`）。
- 字号阶梯（tokens.css 语义变量）：display 32px/700 · h1 24px/700 · h2 18px/650 · body 15px/400 · caption 12.5px/500；编辑器正文 15.5px/1.78。
- 标题负字距（display -0.4px / h1 -0.3px / h2 -0.2px）；空态眉标用 mono 9.5px + `0.24em` 正字距；正文行高 1.7。

## 4. 空间与形状

- 间距 4px 基数（`--space-1` ~ `--space-8`）。
- 圆角三档：纸面/弹窗 18（`--radius-lg`）· 控件 10（`--radius`）· 徽标/小件 8（`--radius-sm`）；pill 999 仅输入/胶囊类。交互控件一律 10px，禁止同一界面混排多档圆角。
- 关键尺寸：侧栏 244px · 信息浮窗 264px · 顶栏/拖拽带高 `--winbar-h:44px` · 按钮 31/38/44 三档 · 图标 14/16/18 · 工作区品牌行高 44 · 快捷图标底片 32。
- **内容纸面**：`app-sheet` 18px 圆角 + 66% 发丝边 + `--shadow-sheet`，四周留 8px 画框；纸面与侧栏之间不画分隔线。
- **顶栏（单行制）**：标签页 / 所在位置 / 文档操作 / 搜索 / 设置同排；顶栏透明，激活标签 = `bg-card/80` + 发丝 ring + 轻阴影，非激活 hover `bg-card/40`；不再用“无边框药丸”或第二条工具栏。
- **工作区入口**：透明两行品牌行（logo 26 + 14px 名 + 10.5px 知识库名），hover/展开用 `--sidebar-active` 55%，右侧 chevron 仅 hover/focus 显现。

## 5. 动效

- 统一缓动 `--ease: cubic-bezier(.25,1,.5,1)`，微回弹 `--ease-pop: cubic-bezier(.3,1.36,.5,1)`（小元素 pop：下拉/Toast/弹窗内容），时长 150/300/500ms（`--dur-1/2/3`）。组件内禁止私定时长/缓动，一律引用令牌。
- 只动 `transform / opacity / filter`；禁止 transition width/height/left/top（侧栏树展开的 height 由 motion 合成处理，限 ≤10 节点小列表）。
- JS 动画引擎唯一：`motion`（v14，`motion/react` 导入）。禁止引入 GSAP / react-spring / auto-animate 等第二体系。高级感组件优先取 Magic UI（MIT）免费部分，复制至 `src/components/common/motion/` 并令牌化适配（NumberTicker / BlurFade / MagicCard 已落地；ShimmerButton 扫光已随扁平化移除）。
- 入退场弹簧参数基准：浮窗/面板 stiffness 260 · damping 26；Toast stiffness 400 · damping 30；数字滚动 damping 60 · stiffness 100。
- 标签/视图切换：AnimatePresence mode="wait"，退场 140ms 内，入场位移 8-12px、模糊 ≤6px；同屏 stagger 元素 ≤12、间隔 30-50ms。
- 主题切换：View Transitions API 自点击位置圆形揭示 500ms（`document.startViewTransition` 特性检测；不支持或 reduced-motion 直接切换）。
- `prefers-reduced-motion: reduce`：CSS 动画全局禁用（app.css 兜底），motion 组件用 useReducedMotion 直接呈现终态。
- 正文编辑区文字不参与动画；工作区禁止无限循环装饰动画（加载/进度与 CTA 扫光除外）。

### 5.1 场景 → 动效预设映射（新组件必须按表取用）

JS 预设唯一来源 `src/lib/motion.ts`（与 tokens.css 同源）；CSS 工具类见 app.css 的 `anim-*`。

| 场景 | 预设 / 工具类 | 参数 |
|---|---|---|
| 弹窗遮罩/内容出入场 | CSS `anim-dialog-in/out`（Radix data-state 驱动） | --dur-2 + --ease-pop |
| 下拉/Popover 弹出 | CSS `anim-pop-in/out` | --dur-2 + --ease-pop |
| 浮层右滑（信息浮窗等） | `SPRING_PANEL` | spring 260/26 |
| Toast | `SPRING_TOAST` | spring 400/30 |
| 标签/视图内容切换 | `TRANSITION_VIEW` + AnimatePresence mode="wait" | 140ms |
| 侧栏树/折叠展开 | `TRANSITION_COLLAPSE` + AnimatePresence | 220ms height |
| 数字滚动 | `SPRING_TICKER`（NumberTicker 组件） | spring 60/100 |
| 内容模糊淡入 | `BlurFade`（`TRANSITION_REVEAL`） | 400ms + blur 6px |
| 主题切换 | View Transitions 圆形揭示（theme.tsx 内置） | 500ms，特性检测降级 |

### 5.2 新组件接入动画三步

1. **取预设**：从 `src/lib/motion.ts` 按上表取用，禁止私定弹簧/缓动/时长字面量（CSS 动画统一走 app.css 的 `anim-*` / keyframes）。
2. **守约束**：只动 transform / opacity / filter；退场必须配 AnimatePresence；同屏动画元素 ≤12；正文编辑区文字不动画。
3. **过降级**：motion 组件用 useReducedMotion 呈现终态；CSS 由 app.css 的 reduced-motion 全局兜底；新浏览器 API（如 View Transitions）必须特性检测。

## 5A. 雾光笺配色与材质准则（第十一轮 2026-10-23 现行）

- **高明度低饱和**：light 主题背景为带主题倾向的近白（不等于纯白），`card` 纯白只作纸面；`primary` 压到中低饱和，只做图形/描边/图标，vs `background` ≥3:1。
- **中性墨色文字**：9 主题共用 `foreground #1D201F` / `muted #626663`（tint ≤4）；禁止再引入 tinted 灰。`fg/bg` ≥14、`muted/fg` ≥5.5（脚本实测）。
- **浅调按钮**：主按钮 = `accent` 浅底 + `accent-foreground` 深字 + `ring-primary/20`；浅色主题禁止 primary 填充白字。destructive 保持实底白字。
- **淡底只提亮，不上色**：空态 CTA、选中底、快捷图标底只用 5–16% 的主题混色；文字必须用 `accent-foreground` / `sidebar-active-fg` 这类深一档颜色。
- **材质**：画框 = 三色 wash + 5% 颗粒；纸面 = 顶部 12%/7% wash + 66% 发丝边；空态 = 560px 同心圆 + 4.5% 外环。禁止大面积纯色、禁止第二套渐变、禁止无限装饰动效。
- **验收**：`node scripts/check-contrast.mjs --check` 必须 9 主题全 PASS；任何令牌调整后重跑。深色模式继续用公共 dark 中性层 + 9 套强调色，由同一脚本核。

### 5A.1 历史准则（已退役）

第五/六轮曾使用「纯白底 + 高饱和主色」「中性灰 chrome + 主题色点睛」；第十一轮改为「主题浅调画框 + 近白纸面 + 中性墨色」，旧值不再作为验收依据。

## 5B. 空态与工作区入口（第十一轮 · 终态）

- **空态 hero**：中心线稿 86px 圆角 28 的浅调底片（`accent 58% + card`）+ 42px 星屿线稿；眉标 mono 9.5/0.24em；宋体标题 34/600、行高 1.32；说明 13/1.75、最宽 460、`text-wrap: balance`；CTA 高 42、圆角 12、`accent 84% + card` 底 + `currentColor 18%` 边、hover 混入 12% primary；底部提示 11.5px。
- **快捷入口**：三列，项高 58；图标底片 32px/圆角 10/1px `currentColor 16%`；收藏 = `logo-c 16%`、小记 = `accent 78%`、新建 = `wash-2 52%`；hover 时底片混入 10% primary。标签 11.5px，默认 `sidebar-muted`。
- **工作区入口**：透明品牌行，logo 26px（32px 命中盒）+ 两行文字；hover / `data-state=open` 时背景 `sidebar-active 55%`；右侧 `ChevronsUpDown` 只在 hover/focus 出现。禁止白底、边框、阴影或大圆角卡片。
- **红绿灯**：`TrafficLightSlot` 只保留 76px 拖拽注入区，**不再画胶囊底座**；左上角不出现任何孤立浅色块。

## 6. 窗口层规范（macOS/Windows 差异）

- macOS：`titleBarStyle:"Overlay"` 保留系统红绿灯，`trafficLightPosition {x:12, y:16}`（44px 拖拽带内垂直居中）；红绿灯槽位统一使用 `TrafficLightSlot` 组件（76px 宽拖拽注入区，**不画胶囊底座**——浅色纸面上会形成孤立白块）。
- Windows：Rust 侧 `set_decorations(false)` 无边框，右上角自绘最小化/最大化/关闭（lucide 图标，关闭 hover 红）。
- 拖拽：`data-tauri-drag-region`；红绿灯槽位与窗口栏弹性区均可拖拽。

## 7. 信息浮窗（文档附加层）

- 浮窗 264px，悬浮于内容区右上（`top-4 right-5 bottom-5`），圆角 14 + 边框 + `shadow-lg`，淡入动画。
- 左缘骑缝 28px 透明箭头把手（`bg-popover/70`）：`›` 收起 / `‹` 展开；浮窗不占主布局空间。

## 8. 本地工作区与文件树（2026-10-21）

- **首次引导**：全屏遮罩（`bg-background/95` + `backdrop-blur-sm`）+ 480px 面板；不使用可关闭 Dialog；主 CTA 为主色浅底卡（`border-primary bg-accent`），次 CTA 为 `bg-card`。已有工作区时追加最近列表。
- **创建/打开工作区**：440px 模态；名称 + 目标文件夹（绝对路径 + 原生目录选择）+ 6 色头像；说明“目录将成为工作区根，自动创建 db/ 与 storage/”。创建中禁止关闭。
- **工作区/知识库管理**：560px 模态，与既有弹窗同构；当前项 = `bg-accent` + 实心「当前」徽标；操作收进 `Ellipsis` 菜单。
- **删除工作区**：危险确认弹窗中明确路径与“当前工作区自动切换”；默认不勾选「同时删除本地文件夹」，勾选后主按钮文案变为「删除工作区与文件夹」。
- **文件树**：行高 32px、层级缩进 14px、类型图标 16px；选中 `bg-sidebar-active` + 600 字重；悬停显示操作菜单；仅文件夹显示「新建子级」。
- **拖拽反馈**：文件夹中部 = 子级（`bg-accent` + 1px 主色内描边）；上/下缘 = 同级插入（2px `bg-primary` 指示线）；列表底部虚线区 = 根级末尾。
- **空态**：无知识库 → “当前工作区还没有知识库 / 使用左上角菜单新建知识库”；有知识库无节点 → “还没有内容 / 点击右上角 + 新建”。
- **多类型图标**：folder=Folder、doc=FileText、board=Presentation、table=Table2、flow=Workflow；标签页的 starred 使用 Star。
- 颜色全部走语义令牌，未新增硬编码色值；树行具备 `role=treeitem`、`aria-level`、`aria-expanded`、`aria-selected`。

## 9. 文档编辑器（2026-10-22 交互重构）

- **页面骨架**：`.doc-editor-scroll` 负责滚动、`.doc-editor-page` 最大 840px；正文 `.doc-content` 用 `margin-left:-52px; padding-left:52px` 留出手柄走廊并与标题左对齐；手柄绝对定位在 `.doc-editor-body` 左走廊（右侧留 4px 间距），位置由 `useBlockHandle` 按顶层块计算。窄屏（≤720px）页面左右留 48px、走廊 30px、标题降级到 26px。
- **排版基准**：正文 15.5px/1.78；H1 30px/800、H2 22px/700、H3 17.5px/700；行内代码使用等宽字体 + 5px 圆角 + 低亮底色；引用 2px 主色左线；`caret-color: var(--primary)`，选区使用主色 22% 透明。
- **块状态**：空段保留行高；占位符由官方 Placeholder 的 `data-placeholder` + `.is-empty` 提供；表格 `border-collapse:separate` + 外框 10px 圆角，`selectedCell` 用主色 11% 覆盖；图片 ResizableNodeView 四角 11px 圆点、边线 5px 胶囊，未 hover 时 `pointer-events:none`。
- **浮层**：`.editor-float` 统一 12px 圆角、1px `border`、`--shadow-lg`、`backdrop-filter: blur(18px) saturate(1.08)`；`.editor-menu-item` 8px 圆角、9px 间距、26px 图标块；激活态 `bg-accent`；`.editor-kbd` 等宽键帽。
- **拖拽**：手柄自绘定位，外观点击区「＋/六点」20×22px、默认 55% 不透明度、hover/拖动时 100%；显隐带 180ms 离开缓冲，鼠标移向左走廊时保持当前块。块拖拽使用 PointerEvent：源块以 42% 不透明度淡化，落点线为 3px 主色全宽圆角线（两端圆点），光标旁显示块类型胶囊标签；官方 Dropcursor 仅用于图片/文件原生拖放。
- **响应式**：窄屏只压缩页边距、手柄走廊与标题字号；浮层宽度固定 260–304px，靠视口钳制定位；所有控件尺寸 ≥20px，菜单项命中区 ≥28px。

## 10. 设置 · 附件对象存储（2026-10-22）

- **位置**：设置弹窗 → 存储；工作区路径卡下方，宽度跟随设置内容区（720px 模态扣除 160px 导航）。
- **统计**：四格 2×2 / 4 列网格（活跃附件、逻辑大小、物理占用、唯一对象）；下方一行 caption 展示 big / pack 对象、pack 文件、死字节、已删除数。
- **工具条**：逻辑目录输入（`h-31`，占位“逻辑目录（可选）”）、主按钮「选择文件上传」、「含已删除」筛选（`aria-pressed`）、刷新图标按钮。
- **列表**：`max-height: 230px` 内部滚动；行高约 44px；文件名 12.5px 500、元信息 10.5px muted（目录 · MIME · 哈希前 12 位 · 创建时间）；行尾为大小与 26px 图标按钮（校验/导出/删除）。
- **删除**：行内二次确认，第一次点击变为「确认」+「取消」，不弹新窗口；已删除行 opacity 0.6，无操作按钮，显示「已删除」徽标。
- **状态**：加载「正在读取附件…」、空态「还没有附件 / 选择文件后按内容哈希存入工作区 storage/」、错误条 `role=alert`（可关闭）、成功/提示 `role=status`；操作期间 `aria-busy=true`，按钮禁用。
- **语义**：`section aria-label="附件管理"`、`ul aria-label="附件列表"`、图标按钮均有包含文件名的 aria-label；输入框有可见/隐藏 label。

## 11. 文档图片块与附件块（2026-10-22）

### 11.1 文件类型图标

- **造型**：56×68（卡片）/ 36×44（长条）折角页面；1.5px 描边、右上折角、底部 4px 类型色条、扩展名标签（≤4 字符）。图标由 `FileTypeIcon` 自绘 SVG，不引入图标包。
- **类型色**（全部走语义令牌）：PDF `--destructive`；图片 `--logo-c`；文档/表格/视频 `--primary`；演示/代码/JSON `--accent-foreground`；压缩 `--logo-c`；音频 `--glow-b`；Markdown `--logo-c`；文本/通用 `--muted-foreground`。
- **页面底**：`color-mix(in srgb, 类型色 9%, var(--card))`；描边 = 类型色 42% 混 `--border`；扩展名文字使用 `--font-mono`、weight 650。
- **标签**：PNG/JPG→原扩展名（≤4）、Markdown→MD、Shell→SH、JSON→JSON、未知→FILE；无扩展名按类型回退 IMG/PDF/DOC/XLS/PPT/ZIP/MP3/MP4/CODE/MD/JSON/TXT/FILE。
- **两种尺寸共享颜色与标签**；长条图标字号 10px，卡片 13px。

### 11.2 图片块

- 块级 atom；左/中/右对齐；显示宽度 120px–正文宽度，高度按纵横比自动。
- 选中：2px 主色描边（`box-shadow` 环），左右各一枚 10×32 主色胶囊缩放柄（hover/选中显现），工具栏浮条 27px 按钮，位于图片上方 42px。
- 工具栏：左/中/右对齐（激活 = 主色底 + 白图标）+ 下载原图；选中态才挂载，避免隐藏按钮进入 Tab 顺序。
- 预览加载：`--muted` 底 + 220×150 占位 + 旋转图标；失败/超大：`ImageOff` + 可读文案 + 下载原图链接。
- 图片本身 `draggable=false`；排序使用既有块手柄；选中时隐藏文字 BubbleMenu。

### 11.3 附件块

- atom 容器，items 1..N；卡片网格 / 长条列表两种形态；组级左/中/右对齐。
- 卡片：210px 宽、最小高 174px、16px 内边距；图标居中、名称最多两行（12.5/600）、大小 10.5px；hover 边框趋向主色、阴影 `--shadow-md`；选中卡片 2px 主色环。
- 长条：100% 宽、8px/10px 内边距、图标在左、名称/大小在中间、下载/移除在右；图标 36×44。
- 操作：下载/移除按钮 24×24；卡片形态在 hover/focus/选中时出现（opacity + pointer-events），长条形态常显；移除最后一项删除整块。
- 工具条：3 个对齐 + 分隔 + 卡片/长条切换，按钮 27×27、激活主色底；选中才挂载。
- 浮条定位基准：浮条横向中心必须落在**该块实际内容**（图片本体 / 卡片组）的中心，而不是正文行中心。因此对齐由块元素本身承担（flex + `justify-content`），卡片形态下外壳 `width: fit-content` 收缩到卡片组宽度，长条形态保持 `width: 100%`；浮条统一 `top: -42px`，允许跨压在上一块边缘（`z-index` 高于块选中态）。
- 上传中：编辑器头部 meta 行显示「正在上传附件…」+ 旋转图标（`aria-live=polite`）；失败走编辑器错误通道。

### 11.4 可访问性

- 图片块 `fieldset.attachment-image-frame` 作为容器；缩放柄有方向性 aria-label；工具栏 `role=toolbar`。
- 附件卡片选择区是原生 `<button>`；下载/移除为独立按钮并带文件名 aria-label；长条操作常显。
- 选中态、hover 态、focus-within 均可见；不改原生按钮焦点环。
