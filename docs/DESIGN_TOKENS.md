# 星屿 Starris · 设计令牌与视觉规范（v2.0 · 雾光笺）

> 视觉事实来源：`src/styles/tokens.css` + `src/styles/app.css`。
> **所有 UI 代码禁止出现硬编码色值，一律通过令牌引用。**
> 旧基线 `docs/设计/starris-design-system.html` 属第五轮历史产物，不再作为验收依据。

---

## 1. 主题体系

星屿采用 **「主题预设 × 明暗模式」** 二维切肤模型：

- **9 套主题预设**（`data-theme`）：`mist` 雾光青（默认）、`azure` 晴空蓝、`midnight` 星澜紫、`amber` 暖砂金、`forest` 苔屿绿、`rose` 樱雾粉、`violet` 暮霭紫、`graphite` 石墨灰、`sunset` 晨光橙。
- **2 种明暗模式**（`data-mode`）：`light`（默认）/ `dark`，共 18 组变量组合。

| 主题 | id | light primary | light sidebar |
|---|---|---|---|
| 雾光青（默认） | `mist` | `#5C8F83` | `#F2F6F4` |
| 晴空蓝 | `azure` | `#5B8FB5` | `#F2F6FA` |
| 星澜紫 | `midnight` | `#7C82B8` | `#F3F3FA` |
| 暖砂金 | `amber` | `#B08A55` | `#F8F5EF` |
| 苔屿绿 | `forest` | `#64906F` | `#F2F6F2` |
| 樱雾粉 | `rose` | `#BD7C88` | `#F9F3F4` |
| 暮霭紫 | `violet` | `#8783B4` | `#F5F3FA` |
| 石墨灰 | `graphite` | `#7A8589` | `#F3F5F5` |
| 晨光橙 | `sunset` | `#C08055` | `#F8F4EF` |

**统一中性墨色（9 主题共用）**：`foreground #1D201F`、`muted-foreground / sidebar-muted #626663`、`secondary-foreground #474A48`、`sidebar-foreground #323634`，tint ≤ 4。主题个性只由 `primary / accent / sidebar / wash-1..3` 承担。

### 切肤机制（唯一正确方式）

运行时只修改 `<html>` 的两个属性，不做 class 替换：

```ts
document.documentElement.dataset.theme = "forest";
document.documentElement.dataset.mode = "dark";
```

`tokens.css` 的 `@theme inline` 把变量映射成 Tailwind 工具类（`bg-background`、`text-muted-foreground` 等），切换后浏览器自动重算。

### 主题升级

- `appearance.designVersion = 2`。
- 仅在「无版本号且已存主题为旧默认 `sunset`」时一次性迁移到 `mist`；其它已选主题不覆盖。
- 新增主题必须同步四处：`tokens.css`、`src/lib/theme.tsx`（`THEME_NAMES / THEME_LABELS`）、Rust `THEME_NAMES`、对应单测；最后跑对比度门禁。

### 变量命名

与 shadcn/ui 一致（`--background` / `--foreground` / `--card` / `--primary` / `--accent` / `--ring` / `--sidebar-*`），另附品牌三色 `--logo-a/b/c`、雾光 `--wash-1/2/3`、颗粒 `--texture-grain`。组件库与业务代码共用同一套语义，不另造命名。

---

## 2. 色彩使用规则

| 令牌 | 用途 | 禁止 |
|---|---|---|
| `--background` / `--foreground` | 页面底色 / 正文文字 | 用其他色做正文 |
| `--muted` / `--muted-foreground` | 弱化底块 / 次要说明 | 用半透明黑/白模拟弱化 |
| `--card` / `--card-foreground` | 纸面、面板、浮层 | 手写 `#FFF` |
| `--primary` | **图标、描边、选中指示、焦点环** | 大面积铺底、正文、浅底白字 |
| `--accent` / `--accent-foreground` | 浅调强调底 / 其上的深色字 | 用 primary 当选中底色 |
| `--secondary` | 次按钮、弱色块底 | — |
| `--sidebar` / `--sidebar-2` | 侧栏画框 | 复用主区 `background` |
| `--sidebar-active` / `--sidebar-active-fg` | 侧栏 hover / 选中 | 侧栏行铺白卡 |
| `--border` / `--input` / `--ring` | 结构线 / 输入边 / 焦点环 | 自写 focus 样式绕开 ring |
| `--wash-1/2/3` | 壳层与空态的雾光 | 第二套渐变、大面积纯色 |
| `--texture-grain` | 细颗粒纸纹 | 用图片纹理替代 |
| `--logo-a/b/c` | logo SVG 填色 | logo 内写死 HEX |
| `--glow-a/b` | 品牌光晕 | 常规控件 |

**核心约束：**

1. **文字只用 `foreground` / `muted-foreground` 两级**；需要更弱时降字号/字重，不新造灰色。
2. **侧栏选中公式**：`sidebar-active` 底 + `sidebar-active-fg` 字；主区选中用 `accent` + `accent-foreground`。
3. **主按钮**：`accent` 浅调底 + `accent-foreground` 深字 + `ring-1 ring-primary/20`；禁止 primary 实底白字（浅色主题对比不足）。
4. **淡底只提亮，不上色**：主题混色控制在 5–16%；文字必须用深一档的 accent-fg 组。
5. **线的层级**：普通分隔用 `border` 66–90% 混透明；不做 2px 以上的重线（编辑器引用块的 2px 主色线例外）。
6. **禁止硬编码**：组件代码中出现 `#RRGGBB` / `rgba()` 即评审不通过（阴影令牌内部已封装）。
7. 深浅模式由 `data-mode` 统一驱动，组件层 **不写** `@media (prefers-color-scheme)` 或 `.dark` 选择器。

---

## 3. 材质：雾光 + 纸纹

- **画框**：`.app-shell` 三团径向 wash（58% / 50% / 42%）压在 `158deg` 的 sidebar 渐变上；`::before` 铺 180px 颗粒，`opacity .05`、`multiply`；dark 用 10% + `soft-light`。
- **纸面**：`.app-sheet` 右上 12% wash-2 + 顶部 220px 的 7% wash-1；66% 发丝边 + `--shadow-sheet`；18px 圆角。
- **空态**：`.empty-hero` 三团 wash（42% / 34% / 36%）+ 170px 颗粒 4.5%；560px 圆环（13% primary）+ 110px 外环（4.5% primary）。
- 纹理必须由令牌绘制，不引入图片资源；不再新增第二种噪点/网点。

---

## 4. 字体规则

- **UI 栈**（`--font-ui`）：`system-ui, -apple-system, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif`。
- **等宽栈**（`--font-mono`）：`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace` — 代码、键帽、数字、空态眉标。
- **展示栈**（`--font-display`）：`"Songti SC", "STSong", "Noto Serif SC", ui-serif, Georgia, serif` — 空态大标题与品牌字标，制造“纸面书写”气质。
- 正文基准 **15px / 1.7**；编辑器正文 **15.5px / 1.78**；标题负字距 display -0.4 / h1 -0.3 / h2 -0.2px。

### 字号阶梯

| 语义 | 令牌 | 字号/字重 | 行高 | 用途 |
|---|---|---|---|---|
| Display | `--text-display` | 32px / 700 | 1.24 | 页面大标题 |
| H1 | `--text-h1` | 24px / 700 | 1.3 | 区块标题 |
| H2 | `--text-h2` | 18px / 650 | 1.45 | 卡片/面板标题 |
| Body | `--text-body` | 15px / 400 | 1.7 | 正文默认 |
| Caption | `--text-caption` | 12.5px / 500 | 1.6 | 辅助说明、元信息 |

阶梯外只允许 10.5–11.5px 的键帽/眉标/快捷标签，且必须走 mono 或 caption 的视觉语气。

---

## 5. 间距、圆角、阴影、动效

### 间距（4px 基数）

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-7` 32 · `--space-8` 40

组件内元素间距取 1–3 档；组件之间 4–6 档；区块之间 7–8 档。

### 圆角三档

| 档位 | 值 | 适用 |
|---|---|---|
| `--radius-lg` | 18px | 窗口、弹窗、内容纸面 |
| `--radius` | 10px | 按钮、输入框、行、图标底片 |
| `--radius-sm` | 8px | badge、键帽、小件 |
| `9999px` | 胶囊 | 头像、主题色点、pill |

### 阴影三档

| 档位 | 用途 |
|---|---|
| `--shadow-sm` | 行、标签页等轻浮层 |
| `--shadow-md` | 卡片、下拉菜单 |
| `--shadow-lg` | 弹窗、模态 |
| `--shadow-sheet` | 内容纸面（内高光 + 双层投影） |

阴影颜色随主题联动，**必须用令牌**，不可自写 `box-shadow`。

### 动效规则

- **统一缓动** `--ease: cubic-bezier(.25, 1, .5, 1)`；小元素入场 `--ease-pop`。
- **三档时长**：`--dur-1` 150ms（hover/按压）、`--dur-2` 300ms（面板/换肤）、`--dur-3` 500ms（强调入场）。
- **只动 `transform / opacity / filter`**；禁止 transition `width/height/top/left`。
- 空态 BlurFade：位移 ≤6px、blur ≤6px、同屏 ≤12 个、间隔 30–50ms。
- 主题切换：View Transitions 圆形揭示 500ms，不支持或 reduced-motion 直接切换。
- `prefers-reduced-motion: reduce` 时全局禁用 CSS 动画，motion 组件呈现终态。

---

## 6. 品牌使用规则

- **Logo**：SVG 三个填色位用 `var(--logo-a/b/c)`，禁止写死 HEX；小于 16px 用单色剪影。
- **工作区入口**：logo 26px（32px 命中盒）+ 工作区名/知识库名两行；透明底，hover/展开用 `sidebar-active` 55%。
- **星点**：`logo-c` 只用于品牌星点与收藏语义，保持稀缺。
- **光晕**：`glow-a/b` 仅用于品牌时刻，不进入常规控件。

---

## 7. Do / Don't 清单

**Do**

- ✅ 切肤只改 `html` 的 `data-theme` / `data-mode`，并持久化。
- ✅ 文字只用 `foreground` / `muted-foreground`；侧栏选中用 `sidebar-active` 组。
- ✅ 主按钮用浅调底 + 深字 + 发丝 ring；主题色只做图标/描边。
- ✅ 新主题先补 `tokens.css` 的 9 组 light + dark 强调层，再走 `@theme inline`。
- ✅ 改动令牌后跑 `node scripts/check-contrast.mjs --check`，9 主题全 PASS 才提交。
- ✅ 图标用 lucide，尺寸 14/16/20，`stroke-width` 1.8–2。

**Don't**

- ❌ 组件内写硬编码色值、`rgba()`、`box-shadow`。
- ❌ 用 primary 做选中底色或大面积铺底；浅底上用 primary 写正文。
- ❌ 侧栏行铺白卡、加边框、加渐变；工作区入口做成大圆角白块。
- ❌ 引入第二套渐变/纹理，或无限循环装饰动效。
- ❌ 自造字号、字重、灰色；引入 Web 字体文件。
- ❌ 在组件里写 `prefers-color-scheme`。
