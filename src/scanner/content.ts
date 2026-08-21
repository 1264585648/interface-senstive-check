const TEXT_APPLICATION_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/x-www-form-urlencoded'
]);

export function isTextLikeMime(rawMimeType: string): boolean {
  const mimeType = rawMimeType.split(';', 1)[0].trim().toLowerCase();
  if (!mimeType) return true;
  return mimeType.startsWith('text/')
    || mimeType.endsWith('+json')
    || mimeType.endsWith('+xml')
    || TEXT_APPLICATION_MIME_TYPES.has(mimeType);
}
