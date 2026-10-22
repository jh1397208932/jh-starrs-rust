/**
 * 当前文档保存器的单例登记：切换标签/工作区前调用 flush，避免静默丢失未保存内容。
 */

type FlushDocument = () => Promise<boolean>;

let active: { owner: symbol; flush: FlushDocument } | null = null;

/** DocEditor 挂载/换文档时登记 flush。 */
export function registerActiveDocument(owner: symbol, flush: FlushDocument) {
  active = { owner, flush };
}

/** 只有当前 owner 能注销，避免新文档被旧实例清理。 */
export function unregisterActiveDocument(owner: symbol) {
  if (active?.owner === owner) active = null;
}

/** 等待当前文档落盘；无文档视为成功。 */
export async function flushActiveDocument(): Promise<boolean> {
  const current = active;
  if (!current) return true;
  try {
    return await current.flush();
  } catch {
    return false;
  }
}
