import { MotionConfig } from "motion/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { installFrameProbe } from "@/lib/frameProbe";
import { installInteractionProbe } from "@/lib/interactionProbe";
import { showMainWindow } from "@/lib/window";
import "@/styles/app.css"; // tailwindcss + tokens.css（设计令牌，先于 App 加载）

installInteractionProbe();
installFrameProbe();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* reducedMotion="user"：OS 开启减弱动态效果时，Motion 的位移/缩放自动降级为透明度 */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);

// 窗口默认隐藏；HTML splash 已在 DOM 中，让出一次任务后显示。
// 不用 rAF：隐藏窗口的 rAF 可能被 WKWebView 节流，会让窗口一直等 Rust 兜底。
window.setTimeout(() => {
  void showMainWindow();
}, 50);
