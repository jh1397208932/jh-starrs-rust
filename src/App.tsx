import { ShortcutProvider } from "@/features/shortcuts/ShortcutProvider";
import { WorkspaceRoot } from "@/features/workspace/components/WorkspaceRoot";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";

/** 应用入口：只做 Provider 组装；工作区门禁与主界面在 WorkspaceRoot。 */
export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <ShortcutProvider>
          <WorkspaceRoot />
        </ShortcutProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
