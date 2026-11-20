export const SUPPORT_MEDIA_LIMIT = 8 * 1024 * 1024;
const supported = new Set([
  "image/png", "image/jpeg", "image/webp", "application/pdf",
  "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/webm",
]);

const extension: Record<string, string> = {
  "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg",
  "application/pdf": "pdf", "video/mp4": "mp4", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/webm": "webm",
};

export function supportMediaExtension(mime: string): string | null {
  return extension[mime] ?? null;
}

export function isAllowedSupportMediaSignature(mime: string, bytes: Uint8Array): boolean {
  if (!supported.has(mime) || bytes.length < 12) return false;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === "image/png") return ascii(1, 4) === "PNG" && bytes[0] === 137;
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (mime === "application/pdf") return ascii(0, 5) === "%PDF-";
  if (mime === "video/mp4") return ascii(4, 8) === "ftyp";
  if (mime === "video/webm" || mime === "audio/webm") return bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163;
  if (mime === "audio/ogg") return ascii(0, 4) === "OggS";
  if (mime === "audio/mpeg") return ascii(0, 3) === "ID3" || bytes[0] === 255 && (bytes[1] & 224) === 224;
  return false;
}

export async function compressSupportMedia(file: File): Promise<File> {
  if (!supported.has(file.type) || !file.size || file.size > 25 * 1024 * 1024) {
    throw new Error("Файл не поддерживается или слишком большой. Максимум 8 МБ после сжатия.");
  }
  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!isAllowedSupportMediaSignature(file.type, signature)) {
    throw new Error("Содержимое файла не соответствует его формату.");
  }
  if (!file.type.startsWith("image/")) {
    if (file.size > SUPPORT_MEDIA_LIMIT) throw new Error("Размер файла не должен превышать 8 МБ.");
    return file;
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Не удалось обработать изображение.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", .78));
    if (!blob || blob.type !== "image/webp" || blob.size > SUPPORT_MEDIA_LIMIT) {
      throw new Error("Не удалось сжать изображение до 8 МБ.");
    }
    const base = file.name.replace(/\.[^.]+$/, "").slice(0, 112) || "image";
    return new File([blob], base + ".webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
