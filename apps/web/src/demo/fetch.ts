// `fetch` replacement used by src/lib/api.ts in the demo build: requests to /api never leave the tab.

import { getDemoServer } from './server';

export async function demoFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { router } = await getDemoServer();
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
  const result = await router.handle(method, input, body);
  if (result.status === 204 || result.body === undefined) return new Response(null, { status: result.status });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
