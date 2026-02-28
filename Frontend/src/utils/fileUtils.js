export function normalizeFileType(file) {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

export function isImageType(type) {
  return type.startsWith("image/");
}

export function isPdfType(type, fileName = "") {
  return type === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

export function isTextType(type, fileName = "") {
  return (
    type.startsWith("text/") ||
    fileName.toLowerCase().endsWith(".txt") ||
    fileName.toLowerCase().endsWith(".csv")
  );
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Filen kunde inte läsas."));
    reader.readAsDataURL(file);
  });
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
