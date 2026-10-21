import { lazy, Suspense, useEffect, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { useTheme } from "@/lib/theme";
import { CAPTION_CLS } from "@/lib/utils";

/** Excalidraw 体积较大，React.lazy + Suspense 按需加载，不阻塞首屏 */
const Excalidraw = lazy(() => import("@excalidraw/excalidraw").then((m) => ({ default: m.Excalidraw })));

/** 初始 mock 场景：几个矩形 + 菱形 + 文字（convertToExcalidrawElements 补全必填字段） */
function buildInitialElements() {
  return import("@excalidraw/excalidraw").then((m) =>
    m.convertToExcalidrawElements([
      { type: "rectangle", id: "mock-r1", x: 140, y: 140, width: 200, height: 110 },
      { type: "rectangle", id: "mock-r2", x: 420, y: 200, width: 180, height: 90 },
      { type: "diamond", id: "mock-d1", x: 260, y: 320, width: 160, height: 100 },
      { type: "text", id: "mock-t1", x: 190, y: 185, text: "星屿 · 架构草图", fontSize: 20 },
    ]),
  );
}

function BoardFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <span aria-hidden="true" className="text-[34px] leading-none opacity-40">
        ✦
      </span>
      <p className={`${CAPTION_CLS} text-muted-foreground`}>画板引擎加载中…</p>
    </div>
  );
}

/** 画板视图：Excalidraw 画布 + mock 初始场景（自带工具栏/属性面板/缩放条） */
export function BoardView() {
  const { mode } = useTheme();
  const [elements, setElements] = useState<Awaited<ReturnType<typeof buildInitialElements>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildInitialElements().then((els) => {
      if (!cancelled) setElements(els);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full w-full">
      <Suspense fallback={<BoardFallback />}>
        {elements && <Excalidraw theme={mode} initialData={{ elements }} />}
      </Suspense>
    </div>
  );
}
