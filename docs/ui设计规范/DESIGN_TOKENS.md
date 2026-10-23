# 星屿 Starris · 设计令牌与视觉规范（历史副本）

> **现行版本：`docs/DESIGN_TOKENS.md`（v2.0 雾光笺）。本文件仅作历史参考，数值可能过期。**

> 版本 v1.0 · 视觉事实来源：`../设计/starris-design-system.html`
> 令牌实现：`src/styles/tokens.css`
> **所有 UI 代码禁止出现硬编码色值，一律通过令牌引用。**

---

## 1. 主题体系

星屿采用 **「主题预设 × 明暗模式」** 二维切肤模型：

- **9 套主题预设**（`data-theme`）：`mist` 雾光青（默认）、`azure` 晴空蓝、`midnight` 星澜紫、`amber` 暖砂金、`forest` 苔屿绿、`rose` 樱雾粉、`violet` 暮霭紫、`graphite` 石墨灰、`sunset` 晨光橙。
- **2 种明暗模式**（`data-mode`）：`light`（默认，缺省即浅色）/ `dark`，共 18 组变量组合。

### 切肤机制（唯一正确方式）

运行时切换主题 **只修改 `<html>` 根元素的两个属性**，不做任何 JS 状态驱动的 class 替换：

```ts
// 切主题
document.documentElement.dataset.theme = 'forest';
// 切明暗
document.documentElement.dataset.mode = 'dark';
```

所有组件样式通过 `var(--xxx)` 引用变量，切换后浏览器自动重算，**无需重渲染、无需监听事件**。`tokens.css` 中的 `@theme inline` 块把变量映射为 Tailwind 工具类（`bg-background`、`text-muted-foreground` 等），`inline` 保证引用的是变量本体而非静态值。

### 变量命名

与 shadcn/ui 完全一致（`--background` / `--foreground` / `--card` / `--primary` / `--accent` / `--ring` / `--sidebar-*` 等），另附品牌三色 `--logo-a/b/c` 与渐变双色 `--glow-a/b`。组件库与业务代码共用同一套语义，不另造第二套命名。

---

## 2. 色彩使用规则

| 令牌 | 用途 | 禁止 |
|---|---|---|
| `--background` / `--foreground` | 页面底色 / 正文文字（唯一正文色） | 用其他色做正文 |
| `--muted` / `--muted-foreground` | 弱化底块 / 次要说明文字 | 用半透明黑/白模拟弱化 |
| `--card` / `--card-foreground` | 卡片、面板 | 手写 `#FFF` 或透明叠加 |
| `--popover` | 浮层（菜单、tooltip、下拉） | 与卡片混用导致层级不清 |
| `--primary` | **仅主按钮、主操作、品牌强调** | 大面积铺底、普通文字 |
| `--secondary` | 次按钮、弱色块底 | — |
| `--accent` / `--accent-foreground` | **选中态 = accent 底 + accent-foreground 字**（列表项、tab、导航高亮） | 用 primary 当选中底色 |
| `--destructive` | 危险操作（删除、错误） | — |
| `--border` / `--input` / `--ring` | 描边 / 输入框描边 / 聚焦环 | 自定义 focus 样式绕开 ring |
| `--sidebar-*` 系列 | 侧边栏专用四色组（底/字/弱字/选中底/选中字） | 侧边栏复用主区令牌 |
| `--logo-a/b/c` | logo SVG 填色 | logo 内写死 HEX |
| `--glow-a/b` | 品牌渐变（`linear-gradient(90deg, var(--glow-a), var(--glow-b))`） | 第三种方向/角度以外的随意混色 |

**核心约束：**

1. **文字只用 `--foreground` 与 `--muted-foreground` 两级**；需要更弱时降字号/降字重，不新造灰色。
2. **选中态公式**：`bg: var(--accent)` + `text: var(--accent-foreground)`，全局统一，不要发明第四种选中样式。
3. **主按钮才准用 `--primary`**；一屏最多一个主按钮视觉焦点。
4. **禁止硬编码**：任何 `#RRGGBB`、`rgba()` 出现在组件代码中即评审不通过（阴影令牌内部已封装，无需手写）。
5. 深浅模式颜色由令牌自动翻转，组件层 **不写** `@media (prefers-color-scheme)` 或 `.dark` 选择器。

---

## 3. 字体规则

- **字体栈**（`--font-ui`）：`system-ui, -apple-system, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif` — 系统栈优先，不引入 Web 字体文件。
- **等宽栈**（`--font-mono`）：`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace` — 仅代码块、坐标、文件大小等元数据。
- 正文基准 **15px / 行高 1.7**；全局 `-webkit-font-smoothing: antialiased`。
- **标题负字距**：display/h1/h2 依次 `-0.4 / -0.3 / -0.2px`，中文大字号必须收紧，否则显松散。
- **slogan / kicker 正字距**：slogan `1–4px`，kicker/label `2–3px` 配合大写，制造疏密对比。
- Tailwind 中用 `font-sans` / `font-mono`（已映射 `--font-ui` / `--font-mono`）。

### 字号阶梯

| 语义 | 令牌 | 字号/字重 | 行高 | 字距 | 用途 |
|---|---|---|---|---|---|
| Display | `--text-display` | 30px / 800 | 1.3 | -0.4px | 页面大标题 |
| H1 | `--text-h1` | 24px / 800 | 1.3 | -0.3px | 区块标题 |
| H2 | `--text-h2` | 18px / 700 | 1.45 | -0.2px | 卡片/面板标题 |
| Body | `--text-body` | 15px / 400 | 1.7 | 0 | 正文默认 |
| Caption | `--text-caption` | 12.5px / 500 | 1.6 | +0.3px | 辅助说明、元信息 |

禁止在阶梯外自造字号（mockup 内小 UI 允许 11–13px 过渡值，但须向 caption 靠拢）。

---

## 4. 间距、圆角、阴影、动效

### 间距（4px 基数）

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-7` 32 · `--space-8` 40

- 组件内元素间距取 1–3 档；组件之间取 4–6 档；区块之间取 7–8 档。
- Tailwind 侧直接用标准刻度 `p-2` / `gap-4` / `mt-6`（等价于 space 档位），语义变量用于非 Tailwind 场景。

### 圆角三档

| 档位 | 值 | 适用 |
|---|---|---|
| `--radius-lg` (16px) | 窗口、弹窗、大面板 | Dialog、模态、主窗口容器 |
| `--radius` (12px) | 常规控件 | 按钮、输入框、卡片内块 |
| `--radius-sm` (8px) | 徽标、小件 | badge、tag、小缩略图 |
| `9999px` | 胶囊/圆点 | 主题切换点、头像、pill |

### 阴影三档

| 档位 | 用途 |
|---|---|
| `--shadow-sm` | 卡片、面板默认 |
| `--shadow-md` | 悬浮态、下拉菜单 |
| `--shadow-lg` | 弹窗、模态 |

阴影颜色随主题联动（浅色用主题色系暗调、深色用纯黑加深），**必须用令牌**，不可自写 box-shadow。

### 动效规则

- **统一缓动** `--ease: cubic-bezier(.25, 1, .5, 1)`（快出缓停），全站只用这一条曲线。
- **三档时长**：`--dur-1` 150ms（hover/按压等微交互）、`--dur-2` 300ms（主题切换、面板展开）、`--dur-3` 500ms（强调性入场）。
- **只动 `transform` 与 `opacity`**；需要位移用 `translate/scale`，需要显隐用 `opacity`，禁止 transition `width/height/top/left`（触发布局）。Motion 库动画同样遵守该曲线与时长。
- 深浅模式切换时，`background` / `color` 用 `--dur-2` 过渡即可（原型 body 既有做法）。

---

## 5. 品牌使用规则

- **Logo**：SVG 源文件中三个填色位分别使用 `fill="var(--logo-a)"` / `var(--logo-b)` / `var(--logo-c)`，随主题自动换色；**禁止在 SVG 内写死 HEX**。
- **最小尺寸 16px**；小于 16px 时简化为单色剪影（取 `--logo-a`）。
- **Wordmark**：中文「星屿」44px/800 + 字距 2px；英文「Starris」用衬线斜体（Georgia）、`--primary` 色；slogan 字距 4px、`--muted-foreground` 色。
- **品牌渐变**：`linear-gradient(120deg, var(--glow-a), var(--glow-b))`，仅用于 hero 光晕、空态插画、进度强调等品牌时刻，不进入常规控件。

---

## 6. Do / Don't 清单

**Do**

- ✅ 切肤只改 `html` 的 `data-theme` / `data-mode` 两个属性，并持久化到本地。
- ✅ 文字颜色只用 `foreground` / `muted-foreground`；选中态用 `accent` + `accent-foreground`。
- ✅ 动画统一 `--ease` 曲线、150–300ms、只动 `transform/opacity`。
- ✅ 新主题/新色阶先加进 `tokens.css` 的 16 组变量，再走 `@theme inline` 映射。
- ✅ 图标用 lucide，尺寸取 14/16/20px，`stroke-width` 保持默认 2。

**Don't**

- ❌ 组件内写任何硬编码色值、`rgba()`、`box-shadow`。
- ❌ 用 `primary` 做选中态底色，或大面积铺 primary。
- ❌ 引入新字体文件、自造字号（阶梯外）与自造灰色。
- ❌ transition `width/height/top/left`，或自创缓动曲线/时长。
- ❌ 侧边栏复用主区令牌（必须用 `--sidebar-*` 系列）。
- ❌ SVG logo 里写死颜色，或小于 16px 仍用完整三色 logo。
- ❌ 组件里写 `prefers-color-scheme` 媒体查询——明暗由 `data-mode` 统一驱动。
