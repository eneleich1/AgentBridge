const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../utils/runtimeConfig");

const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function extensionForMime(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return null;
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function saveTaskAttachments(taskId, attachments = []) {
  ensureUploadsDir();
  const taskDir = path.join(UPLOADS_DIR, taskId);
  const saved = [];

  for (const [index, attachment] of attachments.entries()) {
    const parsed = parseDataUrl(attachment.dataUrl);
    if (!parsed) {
      throw new Error("Only pasted image attachments are supported.");
    }

    const ext = extensionForMime(parsed.mimeType);
    if (!ext) {
      throw new Error(`Unsupported image type: ${parsed.mimeType}`);
    }

    if (parsed.buffer.length > MAX_IMAGE_BYTES) {
      throw new Error("Image attachment is too large. Maximum size is 10 MB.");
    }

    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }

    const fileName = `image-${index + 1}${ext}`;
    const filePath = path.join(taskDir, fileName);
    fs.writeFileSync(filePath, parsed.buffer);
    saved.push({
      name: attachment.name || fileName,
      mimeType: parsed.mimeType,
      size: parsed.buffer.length,
      path: filePath,
      dataUrl: attachment.dataUrl,
    });
  }

  return saved;
}

function buildAttachmentPrompt(attachments) {
  if (!attachments?.length) return "";
  const lines = attachments.map((attachment, index) => {
    return `${index + 1}. ${attachment.path}`;
  });
  return [
    "",
    "Attached images are available on the desktop at these local paths:",
    ...lines,
    "Use these image files as part of the user's request.",
  ].join("\n");
}

module.exports = {
  saveTaskAttachments,
  buildAttachmentPrompt,
};
