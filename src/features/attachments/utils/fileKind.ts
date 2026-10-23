/** 文件类型分类与图标标签：唯一映射，供附件卡片/长条复用。 */

export type FileKind =
  | "image"
  | "pdf"
  | "doc"
  | "sheet"
  | "slides"
  | "archive"
  | "audio"
  | "video"
  | "code"
  | "markdown"
  | "json"
  | "text"
  | "generic";

const EXTENSION_KINDS: Record<string, FileKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  bmp: "image",
  tiff: "image",
  heic: "image",
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  rtf: "doc",
  odt: "doc",
  pages: "doc",
  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  tsv: "sheet",
  numbers: "sheet",
  ods: "sheet",
  ppt: "slides",
  pptx: "slides",
  key: "slides",
  odp: "slides",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
  xz: "archive",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  ogg: "audio",
  m4a: "audio",
  mp4: "video",
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  m4v: "video",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  json: "json",
  jsonc: "json",
  txt: "text",
  log: "text",
  sh: "code",
  bash: "code",
  zsh: "code",
  py: "code",
  js: "code",
  mjs: "code",
  cjs: "code",
  ts: "code",
  tsx: "code",
  jsx: "code",
  rs: "code",
  go: "code",
  java: "code",
  c: "code",
  h: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  rb: "code",
  php: "code",
  swift: "code",
  kt: "code",
  kts: "code",
  lua: "code",
  sql: "code",
  html: "code",
  css: "code",
  scss: "code",
  less: "code",
  vue: "code",
  svelte: "code",
  yml: "code",
  yaml: "code",
  toml: "code",
  xml: "code",
  ini: "code",
  conf: "code",
};

const LABEL_OVERRIDES: Record<string, string> = {
  jpeg: "JPG",
  markdown: "MD",
  mdx: "MDX",
  shell: "SH",
  bash: "SH",
  zsh: "SH",
  typescript: "TS",
  javascript: "JS",
  python: "PY",
  yaml: "YML",
  document: "DOC",
  spreadsheet: "XLS",
  presentation: "PPT",
};

/** 从扩展名/MIME 推断文件类型。 */
export function classifyFile(fileName: string, mime = ""): FileKind {
  const extension = fileExtension(fileName);
  const byExtension = EXTENSION_KINDS[extension];
  if (byExtension) return byExtension;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) {
    return "archive";
  }
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "sheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "slides";
  if (mime.includes("word") || mime.includes("document")) return "doc";
  if (mime === "application/json") return "json";
  if (mime.startsWith("text/")) return "text";
  return "generic";
}

/**
 * 图标内的扩展名标签：大写、最多 4 个字符。
 * 无扩展名时按类型回退到通用标签。
 */
export function fileExtensionLabel(fileName: string, kind: FileKind): string {
  const extension = fileExtension(fileName);
  if (extension) {
    const mapped = LABEL_OVERRIDES[extension] ?? extension.toUpperCase();
    return mapped.slice(0, 4);
  }
  const fallback: Record<FileKind, string> = {
    image: "IMG",
    pdf: "PDF",
    doc: "DOC",
    sheet: "XLS",
    slides: "PPT",
    archive: "ZIP",
    audio: "MP3",
    video: "MP4",
    code: "CODE",
    markdown: "MD",
    json: "JSON",
    text: "TXT",
    generic: "FILE",
  };
  return fallback[kind];
}

/** 小写扩展名，不含点；无扩展名返回空串。 */
export function fileExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1).toLowerCase();
}
