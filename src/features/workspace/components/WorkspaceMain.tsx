import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useWorkspaceMainController,
  type WorkspaceMainControllerOptions,
} from "../hooks/useWorkspaceMainController";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceModals } from "./WorkspaceModals";

/**
 * 主界面入口：控制器 hook 聚合状态与动作，布局层与弹窗层分别渲染。
 * 本组件只做组合，不承载业务规则。
 */
export function WorkspaceMain(props: WorkspaceMainControllerOptions) {
  const controller = useWorkspaceMainController(props);
  if (!controller.store.currentWorkspace) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceLayout controller={controller} />
      <WorkspaceModals controller={controller} />
    </TooltipProvider>
  );
}
