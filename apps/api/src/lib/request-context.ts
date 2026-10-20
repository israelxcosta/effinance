import type { AuditContext } from './audit';

/** IP and User-Agent of a request, for sessions and the audit log (works with the demo router too). */
export function requestContext(req: { ip?: string; headers?: Record<string, unknown> }): AuditContext {
  const ua = req.headers?.['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null };
}
