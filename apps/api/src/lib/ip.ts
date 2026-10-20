/** Masks an IP for display/audit: IPv4 keeps 3 octets (189.6.12.x), IPv6 keeps 3 groups. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.x';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':x';
  return null;
}

/** First 200 chars of the User-Agent (enough to identify the device in the sessions list). */
export function shortUserAgent(ua: string | null | undefined): string | null {
  return ua ? ua.slice(0, 200) : null;
}
