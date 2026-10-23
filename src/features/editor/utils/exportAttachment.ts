import { downloadAttachment } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { pickAttachmentExportPath } from "@/api/fileDialog";

/**
 * 通过附件对象模块导出文件：保存对话框 → 流式下载。
 * @returns 用户取消返回 false；成功 true；失败调用 onError 并返回 false
 */
export async function exportAttachment(
  attachmentId: string,
  fileName: string,
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    const target = await pickAttachmentExportPath(fileName);
    if (!target) return false;
    await downloadAttachment({ id: attachmentId, destPath: target, overwrite: true });
    return true;
  } catch (caught) {
    onError(toErrorMessage(caught));
    return false;
  }
}
