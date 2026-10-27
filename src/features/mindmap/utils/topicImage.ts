/**
 * 主题图片：上传到附件对象库 → 读取字节 → 以 data URL 写入主题。
 */

import { readAttachmentBytes, uploadAttachmentBytes } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import type { MindmapContent, MindmapFile } from "@/types/mindmap";
import { uint8ToBase64 } from "./base64";
import { updateTopic } from "./tree";

export interface TopicImageParams {
  nodeId: string;
  topicId: string;
  file: File;
  images: Map<string, MindmapFile>;
  content: MindmapContent;
  commit: (next: MindmapContent | null) => void;
  onError: (message: string) => void;
}

/** 上传并提交图片主题；失败时只回报错误，不抛到渲染层。 */
export async function uploadTopicImage(params: TopicImageParams): Promise<void> {
  const { nodeId, topicId, file, images, content, commit, onError } = params;
  if (!file.size) return;
  try {
    const attachment = await uploadAttachmentBytes(file, `mindmap/${nodeId}`);
    const bytes = await readAttachmentBytes(attachment.id);
    images.set(attachment.id, {
      id: attachment.id,
      mimeType: attachment.mime,
      dataUrl: `data:${attachment.mime};base64,${uint8ToBase64(new Uint8Array(bytes))}`,
      created: attachment.createdAt,
    });
    commit(
      updateTopic(content, topicId, (topic) => ({
        ...topic,
        image: { objectId: attachment.id, width: 160, height: 90 },
      })),
    );
  } catch (error) {
    onError(toErrorMessage(error));
  }
}
