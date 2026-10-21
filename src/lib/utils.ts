import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名（条件 + 去重） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 常用排版类（引用 tokens.css 语义字号，避免硬编码字号/字距） */
export const CAPTION_CLS =
  "text-[length:var(--text-caption)] font-medium tracking-[var(--text-caption-ls)] leading-[var(--text-caption-lh)]";
