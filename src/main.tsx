import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/styles/app.css"; // tailwindcss + tokens.css（设计令牌，先于 App 加载）

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
