# 星屿 Starris · UI 设计规范（UI-SPEC）

> 本文件是全项目 UI 开发的唯一权威规范入口。详细令牌定义见 `src/styles/tokens.css`，交互规格见 `docs/UX_SPEC.md`，令牌使用规则见 `docs/DESIGN_TOKENS.md`，视觉基准原型见 `docs/设计/starris-design-system.html`。

## 1. 主题体系

- 8 套预设主题：暖屿橙 sunset（默认）/ 晴空蓝白 azure / 午夜星河 midnight / 暮岩金 amber / 青屿森语 forest / 樱屿绯粉 rose / 靛夜霓虹 violet / 墨玉石墨 graphite。
- 每套主题含浅色与深色两组变量；运行时切肤只修改 `<html>` 的 `data-theme` / `data-mode` 两个属性，组件层零改动。
- 品牌三色：`--logo-a`（主岛）/ `--logo-b`（伴屿，primary 加深 25% 派生）/ `--logo-c`（星），logo SVG 禁止写死色值。

## 2. 颜色使用规则

| 场景 | 令牌 | 禁止 |
|---|---|---|
| 正文 / 标题 | `--foreground` | 色板外的灰色 |
| 辅助文字（≥12px） | `--muted-foreground` | 更浅的自定灰 |
| 选中态 | `--accent` 底 + `--accent-foreground` 字（侧栏用 `--sidebar-active` 组） | 发明第二套高亮 |
| 主按钮 | `--primary` + `--primary-foreground` | 对次要按钮用 primary |
| 危险操作 | `--destructive` | — |
| macOS 红绿灯底座 | `bg-accent/70` 胶囊 | 硬编码色值 |

## 3. 字体与字号

- 字体栈：`system-ui, -apple-system, "PingFang SC", …`（tokens.css `--font-ui`）；代码 `--font-mono`。
- 字号阶梯（tokens.css 语义变量）：display 30px/800 · h1 24px/800 · h2 18px/700 · body 15px/400 · caption 12.5px/500。
- 标题 letter-spacing -0.3px；slogan 类短句 2–4px；正文行高 1.7。

## 4. 空间与形状

- 间距 4px 基数（`--space-1` ~ `--space-8`）。
- 圆角三档：窗口/弹窗 16（`--radius-lg`）· 控件 10（`--radius`）· 徽标/小件 8（`--radius-sm`）；pill 999。
- 关键尺寸：侧栏 232px · 信息浮窗 264px · 窗口栏高 `--winbar-h:44px` · 按钮 31/38/44 三档 · 图标 14/16/18。

## 5. 动效

- 统一缓动 `--ease: cubic-bezier(.25,1,.5,1)`，微回弹 `--ease-pop: cubic-bezier(.3,1.36,.5,1)`（小元素 pop：下拉/Toast/弹窗内容），时长 150/300/500ms（`--dur-1/2/3`）。组件内禁止私定时长/缓动，一律引用令牌。
- 只动 `transform / opacity / filter`；禁止 transition width/height/left/top（侧栏树展开的 height 由 motion 合成处理，限 ≤10 节点小列表）。
- JS 动画引擎唯一：`motion`（v14，`motion/react` 导入）。禁止引入 GSAP / react-spring / auto-animate 等第二体系。高级感组件优先取 Magic UI（MIT）免费部分，复制至 `src/components/common/motion/` 并令牌化适配（NumberTicker / BlurFade / ShimmerButton / MagicCard 已落地）。
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
| CTA 扫光 | `ShimmerButton` | --speed 2.6~3s |
| 主题切换 | View Transitions 圆形揭示（theme.tsx 内置） | 500ms，特性检测降级 |

### 5.2 新组件接入动画三步

1. **取预设**：从 `src/lib/motion.ts` 按上表取用，禁止私定弹簧/缓动/时长字面量（CSS 动画统一走 app.css 的 `anim-*` / keyframes）。
2. **守约束**：只动 transform / opacity / filter；退场必须配 AnimatePresence；同屏动画元素 ≤12；正文编辑区文字不动画。
3. **过降级**：motion 组件用 useReducedMotion 呈现终态；CSS 由 app.css 的 reduced-motion 全局兜底；新浏览器 API（如 View Transitions）必须特性检测。

## 5A. 配色明亮清新度与对比度准则（2026-10-21 第五轮全主题改造）

- **白底黑字鲜主色三角（第五轮核心）**：light `--background` 8 主题统一纯白 `#FFFFFF`（编辑器/tab/卡片全白）；文字组 8 主题 light 共用一套中性碳黑（见下）；主色高饱和深色（S≥70%，graphite 中性除外）。主题个性只由 sidebar/secondary/accent 极浅倾向（L*≥96.5）+ 主色/激活色承担，正文与底色不"泛主题色"。
- **统一中性文字组（8 主题 light 共用，RGB max-min ≤ 4）**：foreground/card-fg/popover-fg `#191A1C`；secondary-fg `#454649`；muted-fg 与 sidebar-muted `#6C6D70`；sidebar-fg `#343537`。跨主题切换正文观感恒定，禁再引入 tinted 灰（第四轮的"轻倾向灰"已废弃——实测 tint 24~43 即用户感知的"字体偏向主题色"）。
- **对比度阶梯（8 主题 light 实测达标，脚本 `scripts/check-contrast.mjs --check`）**：
  - 正文 foreground vs background = 17.4:1（≥12）；
  - muted-foreground vs background/secondary ≥ 4.5:1（取严）；
  - sidebar-muted vs sidebar ≥ 4.5:1；边线 border vs background ≥ 1.30:1；
  - accent-fg、sidebar-active-fg ≥ 4.5:1；
  - **主按钮白字 vs primary ≥ 4.5:1（第五轮提标：普通字号 AA，取代旧 3:1 大字号线）**；
  - primary vs background ≥ 3.0（色块/图形辨识）。
- **主色鲜明化点位（2026-10-21 第五轮校准）**：sunset `#C55008` / azure `#0B76D0` / midnight `#4F5BE0` / amber `#9A6A08` / forest `#12834E` / rose `#D0344F` / violet `#6D4FE3` / graphite `#4A5058`。规律：主色"鲜明 = 高饱和 + 适度加深"，提亮到白字 3:1 边缘反而发虚（第四轮教训）；加深至白字 ≥4.5 后按钮文字与图标同时受益。logo-a/glow-a/ring 跟随 primary，logo-b 取深一档。
- **destructive 统一**：`#CE3535` + 纯白字（5.05:1）；旧 `#D64545`/`#FFF5F5`（4.19）不达标已废弃。
- **dark 模式**维持 2026-10-21 第四轮校准值未动（按钮字 6.2~11 全达标）。
- **改动令牌必须复验**：任何配色调整跑 `node scripts/check-contrast.mjs --check`（解析 tokens.css 全主题输出 lum/ratio 矩阵 + PASS/FAIL），禁止只凭观感。

## 6. 窗口层规范（macOS/Windows 差异）

- macOS：`titleBarStyle:"Overlay"` 保留系统红绿灯，`trafficLightPosition {x:12, y:16}`（44px 拖拽带内垂直居中）；红绿灯槽位统一使用 `TrafficLightSlot` 组件（76px 宽 + `bg-accent/70` 胶囊底座，失焦灰点时有视觉承托）。
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
