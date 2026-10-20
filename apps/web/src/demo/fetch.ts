// `fetch` replacement used by src/lib/api.ts in the demo build: requests to /api never leave the tab.

import { getDemoServer } from './server';

export async function demoFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { router } = await getDemoServer();
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
  const headers: Record<string, string> = {};
  if (typeof navigator !== 'undefined' && navigator.userAgent) headers['user-agent'] = navigator.userAgent;
  const result = await router.handle(method, input, body, headers);
  const responseHeaders = { ...result.headers };
  if (result.status === 204 || result.body === undefined) return new Response(null, { status: result.status, headers: responseHeaders });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...responseHeaders, 'Content-Type': 'application/json' },
  });
}
