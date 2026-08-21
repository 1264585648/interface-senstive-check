const EMAIL_LIKE = /^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT_LIKE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const CN_MOBILE_LIKE = /^(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}$/;
const LONG_NUMBER = /\d{6,}/;
const RESOURCE_COLLECTION_SEGMENTS = new Set([
  'users', 'accounts', 'members', 'customers', 'profiles', 'orders', 'devices', 'tokens', 'sessions'
]);
const SAFE_RESOURCE_ACTIONS = new Set([
  'list', 'detail', 'info', 'search', 'create', 'update', 'delete', 'batch', 'current', 'me', 'profile'
]);

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function hasHighEntropyIdentifierShape(segment: string): boolean {
  if (segment.length < 16) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return false;
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[_-]/].filter((pattern) => pattern.test(segment)).length;
  return categories >= 3;
}

function shouldRedactSegment(segment: string, previousSegment?: string): boolean {
  const decoded = decodeSegment(segment);
  if (!decoded) return false;

  const normalized = decoded.toLowerCase();
  if (
    previousSegment
    && RESOURCE_COLLECTION_SEGMENTS.has(previousSegment.toLowerCase())
    && !SAFE_RESOURCE_ACTIONS.has(normalized)
  ) return true;
  if (EMAIL_LIKE.test(decoded)) return true;
  if (UUID_LIKE.test(decoded)) return true;
  if (JWT_LIKE.test(decoded)) return true;
  if (CN_MOBILE_LIKE.test(decoded)) return true;
  if (LONG_NUMBER.test(decoded)) return true;
  if (decoded.length > 32) return true;
  if (hasHighEntropyIdentifierShape(decoded)) return true;
  return false;
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.split('/');
    const safeSegments = segments.map((segment, index) => {
      const previous = index > 0 ? decodeSegment(segments[index - 1]) : undefined;
      return shouldRedactSegment(segment, previous) ? ':redacted' : decodeSegment(segment);
    });
    return `${url.origin}${safeSegments.join('/')}`;
  } catch {
    return rawUrl.split(/[?#]/, 1)[0];
  }
}
