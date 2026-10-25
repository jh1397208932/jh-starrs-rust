/**
 * 当前编辑器保存器的单例登记：文档与画板共用一个槽位。
 * 切换标签/工作区前调用 flush，避免静默丢失未保存内容。
 */

type FlushPersistence = () => Promise<boolean>;

let active: { owner: symbol; flush: FlushPersistence } | null = null;

/** 当前编辑器（文档或画板）挂载/换节点时登记 flush。 */
export function registerActivePersistence(owner: symbol, flush: FlushPersistence) {
  active = { owner, flush };
}

/** 只有当前 owner 能注销，避免新编辑器被旧实例清理。 */
export function unregisterActivePersistence(owner: symbol) {
  if (active?.owner === owner) active = null;
}

/** 等待当前编辑器落盘；无活动编辑器视为成功。 */
export async function flushActivePersistence(): Promise<boolean> {
  const current = active;
  if (!current) return true;
  try {
    return await current.flush();
  } catch {
    return false;
  }
}
