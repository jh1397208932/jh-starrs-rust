import { MotionConfig } from "motion/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/styles/app.css"; // tailwindcss + tokens.css（设计令牌，先于 App 加载）

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* reducedMotion="user"：OS 开启减弱动态效果时，Motion 的位移/缩放自动降级为透明度 */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
