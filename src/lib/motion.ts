import type { Transition } from "motion/react";

/**
 * JS 动效预设 · 唯一来源（与 src/styles/tokens.css 的 CSS 令牌同源）。
 *
 * 新组件接入动画的三步约定（详见 UI-SPEC.md §5）：
 * ①先选场景，从本文件取预设，禁止在组件内私定弹簧/缓动字面量；
 * ②只动 transform / opacity / filter，布局属性动画需说明理由；
 * ③检查 prefers-reduced-motion（CSS 由 app.css 全局兜底，motion 用 useReducedMotion 呈现终态）。
 *
 * CSS 侧令牌：--ease / --ease-pop / --dur-1/2/3；改任一侧需同步另一侧。
 */

/** 标准缓动（对应 --ease: cubic-bezier(.25,1,.5,1)）；motion 的 BezierDefinition 为四元组 */
export const EASE_STANDARD: [number, number, number, number] = [0.25, 1, 0.5, 1];

/** 浮层/面板弹簧：右滑入场的浮层（信息浮窗、侧滑面板等） */
export const SPRING_PANEL: Transition = { type: "spring", stiffness: 260, damping: 26 };

/** Toast 弹簧：比面板更硬更快，出得干脆 */
export const SPRING_TOAST: Transition = { type: "spring", stiffness: 400, damping: 30 };

/** 数字滚动弹簧（NumberTicker 用）：阻尼高、无过冲抖动 */
export const SPRING_TICKER: Transition = { damping: 60, stiffness: 100 };

/** 视图切换过渡：140ms 淡入 + 8px 上移（标签页/视图内容切换，mode="wait" 配套） */
export const TRANSITION_VIEW: Transition = { duration: 0.14, ease: EASE_STANDARD };

/** 树/折叠过渡：220ms 高度展开（限 ≤10 节点小列表） */
export const TRANSITION_COLLAPSE: Transition = { duration: 0.22, ease: EASE_STANDARD };

/** 入场过渡（BlurFade 等模糊淡入用）：400ms */
export const TRANSITION_REVEAL: Transition = { duration: 0.4, ease: EASE_STANDARD };
