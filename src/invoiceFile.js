import jsQR from "jsqr";
// Reads the fiscal QR from a JPG/PNG picture of the invoice (D-10: the file is
// never uploaded; only the decoded text goes to the server, which parses it again).
// Same technique as src/QrScanner.jsx: draw on a canvas and run jsQR.
export const INVOICE_IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg"]);
export const MAX_INVOICE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 1600;

export function acceptedInvoiceImage(file) {
  return Boolean(file) && INVOICE_IMAGE_TYPES.includes(file.type) && file.size > 0 && file.size <= MAX_INVOICE_IMAGE_BYTES;
}

/** Decoded QR text, or null when the picture has no readable QR. */
export function decodeQrFromPixels({ data, width, height }) {
  return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data || null;
}

async function loadImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("invalid_image"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeQrFromImageFile(file) {
  if (!acceptedInvoiceImage(file)) throw Object.assign(new Error("invalid_image"), { code: "invalid_image" });
  const image = await loadImage(file);
  const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  return decodeQrFromPixels(ctx.getImageData(0, 0, canvas.width, canvas.height));
}
