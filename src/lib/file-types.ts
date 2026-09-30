// ─── What kind of file was picked ───────────────────────────────
//
// Decided from the file's MIME type first, then its name, and from its uri
// only when the uri is a real path.
//
// On the web every picker hands back a `blob:https://host/<id>` uri. Upload
// used to take the text after the uri's last "." as the type, which turned a
// phone photo into "app/3f1c…": the in-browser OCR was skipped, the preview
// said "PDF Document", and the database refused the document (`file_type` is
// 20 characters) after the file was already in Storage. Native uris end in a
// real file name, which is why the phone app never showed it.
// ────────────────────────────────────────────────────────────────

/** What the `documents` bucket accepts: its allowed_mime_types, by type. */
const SAVEABLE = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
} as const;

export type SaveableType = keyof typeof SAVEABLE;

const FROM_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

const SAME_TYPE: Record<string, string> = { jpeg: 'jpg', jpe: 'jpg', heif: 'heic', tif: 'tiff' };

const EXTENSION = /\.([a-z0-9]{2,5})$/i;

/** The extension of a file name or path, or null. A blob: or data: uri has none. */
function extensionOf(nameOrPath?: string | null): string | null {
  if (!nameOrPath || /^(blob|data):/i.test(nameOrPath)) return null;
  const match = nameOrPath.split(/[?#]/)[0].match(EXTENSION);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return SAME_TYPE[ext] ?? ext;
}

/** 'pdf', 'jpg', 'png', 'heic', 'webp'… or null when nothing says. */
export function detectFileType(file: {
  mimeType?: string | null;
  name?: string | null;
  uri?: string | null;
}): string | null {
  // A data: uri (older web pickers) carries its MIME type in front.
  const fromUri = file.uri?.match(/^data:([^;,]+)/i)?.[1];
  for (const candidate of [file.mimeType, fromUri]) {
    const mime = candidate?.toLowerCase().split(';')[0].trim();
    if (mime && FROM_MIME[mime]) return FROM_MIME[mime];
  }
  return extensionOf(file.name) ?? extensionOf(file.uri);
}

export function isSaveable(type: string | null | undefined): type is SaveableType {
  return !!type && Object.prototype.hasOwnProperty.call(SAVEABLE, type);
}

export function mimeTypeFor(type: SaveableType): string {
  return SAVEABLE[type];
}

/** The name to keep: the picked one when it already says its type, else with it added. */
export function nameWithType(name: string | null | undefined, type: string, fallbackStem: string): string {
  const base = name?.trim() || fallbackStem;
  return extensionOf(base) === type ? base : `${base.replace(EXTENSION, '')}.${type}`;
}

/** Said instead of trying to save a file the bucket would refuse. */
export function unsupportedFileMessage(type: string | null | undefined): string {
  const what = type ? `a ${type.toUpperCase()} file` : 'a kind of file FamilyVault does not recognise';
  return `This is ${what}. FamilyVault can keep PDFs, and pictures in JPG or PNG.`;
}
