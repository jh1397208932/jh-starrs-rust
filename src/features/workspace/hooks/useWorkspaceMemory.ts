import { useCallback, useRef, useState } from "react";
import { currentKbKey, saveMemory } from "@/api/memory";

/**
 * 工作区记忆快照与知识库选择持久化。
 *
 * - `memoryRef` 与 state 同步，供异步加载跳过 React 提交延迟读取最新值；
 * - 知识库写入用 Promise 队列串行化，避免启动加载的旧写入覆盖用户新选择。
 */
export function useWorkspaceMemory() {
  const [memory, setMemory] = useState<Record<string, string>>({});
  const memoryRef = useRef<Record<string, string>>({});
  const writeRef = useRef<Promise<void>>(Promise.resolve());

  const applyMemory = useCallback((next: Record<string, string>) => {
    memoryRef.current = next;
    setMemory(next);
  }, []);

  /** 读取某工作区记忆的当前知识库 id */
  const recallCurrentKb = useCallback((workspaceId: string): string | undefined => {
    return memoryRef.current[currentKbKey(workspaceId)];
  }, []);

  /** 写入某工作区当前知识库；返回本次写入（队列顺序执行） */
  const rememberCurrentKb = useCallback(
    (workspaceId: string, kbId: string) => {
      const key = currentKbKey(workspaceId);
      const write = writeRef.current.then(async () => {
        if (memoryRef.current[key] === kbId) return;
        await saveMemory({ [key]: kbId });
        applyMemory({ ...memoryRef.current, [key]: kbId });
      });
      writeRef.current = write.catch(() => undefined);
      return write;
    },
    [applyMemory],
  );

  return { memory, applyMemory, recallCurrentKb, rememberCurrentKb };
}
