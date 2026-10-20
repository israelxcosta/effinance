// Minimal Fastify look-alike that runs the API route plugins in the browser.
// Supports exactly what the API route plugins use: register(prefix, opts), addHook('onRequest' |
// 'onRoute'), get/post/put/patch/delete with zod `schema` (params/querystring/body) and
// reply.code().header().send().

import { ZodError, type ZodType } from 'zod';
import type { ApiError } from '@effinance/shared';
import type { DbExecutor } from '@api/db/client';
import { AppError } from '@api/lib/errors';
import type { Access } from '@api/modules/workspaces/access';

export interface DemoRequest {
  method: string;
  url: string;
  params: unknown;
  query: unknown;
  body: unknown;
  headers: Record<string, string>;
  ip: string | undefined;
  // Set by `authenticate` and by the tenant boundary (same fields as the API's FastifyRequest).
  userId: string;
  workspaceId: string;
  sessionId: string | null;
  access: Access;
  db: DbExecutor;
}

export class DemoReply {
  statusCode = 200;
  payload: unknown = undefined;
  sent = false;
  headers: Record<string, string> = {};

  header(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  code(status: number) {
    this.statusCode = status;
    return this;
  }

  status(status: number) {
    return this.code(status);
  }

  send(payload?: unknown) {
    this.payload = payload;
    this.sent = true;
    return this;
  }
}

type Hook = (req: DemoRequest, reply: DemoReply) => unknown;
type Handler = (req: DemoRequest, reply: DemoReply) => unknown;

interface RouteOptions {
  schema?: { params?: ZodType; querystring?: ZodType; body?: ZodType };
  onRequest?: Hook | Hook[];
  /** Fastify-only settings (rate limits); ignored here. */
  config?: unknown;
}

/** What `onRoute` hooks receive and may change (like Fastify's route options). */
interface RouteDefinition extends RouteOptions {
  method: string;
  url: string;
  handler: Handler;
}
type RouteHook = (route: RouteDefinition) => void;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  options: RouteOptions;
  handler: Handler;
  scope: DemoScope;
}

export interface DemoResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Plugin = (instance: any, opts: Record<string, unknown>) => Promise<void> | void;

function normalize(path: string): string {
  const p = path.replace(/\/+/g, '/').replace(/\/$/, '');
  return p || '/';
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = normalize(path)
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      keys.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { pattern: new RegExp(`^${source}$`), keys };
}

export class DemoScope {
  private hooks: Hook[] = [];
  private routeHooks: RouteHook[] = [];

  constructor(
    private readonly router: DemoRouter,
    private readonly prefix: string,
    private readonly parent?: DemoScope,
  ) {
    // Decorations (`app.db`, `app.authenticate`) are inherited by every scope, like in Fastify.
    Object.assign(this, router.decorations);
  }

  allHooks(): Hook[] {
    return [...(this.parent?.allHooks() ?? []), ...this.hooks];
  }

  allRouteHooks(): RouteHook[] {
    return [...(this.parent?.allRouteHooks() ?? []), ...this.routeHooks];
  }

  addHook(name: string, hook: Hook | RouteHook) {
    if (name === 'onRoute') this.routeHooks.push(hook as RouteHook);
    else if (name === 'onRequest' || name === 'preValidation' || name === 'preHandler') this.hooks.push(hook as Hook);
  }

  async register(plugin: Plugin, opts: { prefix?: string } & Record<string, unknown> = {}) {
    const child = new DemoScope(this.router, this.prefix + (opts.prefix ?? ''), this);
    await plugin(child, opts);
  }

  private route(method: string, path: string, a: RouteOptions | Handler, b?: Handler) {
    const options = typeof a === 'function' ? {} : a;
    const definition: RouteDefinition = {
      ...options,
      method,
      url: this.prefix + path,
      handler: typeof a === 'function' ? a : b!,
    };
    for (const hook of this.allRouteHooks()) hook(definition);
    this.router.add({
      method,
      ...compile(definition.url),
      options: definition,
      handler: definition.handler,
      scope: this,
    });
  }

  get(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.route('GET', path, a, b);
  }
  post(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.route('POST', path, a, b);
  }
  put(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.route('PUT', path, a, b);
  }
  patch(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.route('PATCH', path, a, b);
  }
  delete(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.route('DELETE', path, a, b);
  }
}

function validationError(error: ZodError): DemoResponse {
  const body: ApiError = {
    error: 'validation_error',
    message: error.issues[0]?.message ?? 'Dados inválidos',
    details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
  return { status: 400, body };
}

export class DemoRouter {
  private routes: Route[] = [];
  readonly root: DemoScope;

  constructor(readonly decorations: Record<string, unknown>) {
    this.root = new DemoScope(this, '');
  }

  add(route: Route) {
    this.routes.push(route);
  }

  async handle(method: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<DemoResponse> {
    const parsed = new URL(url, 'http://demo.local');
    const path = normalize(parsed.pathname);
    let match: { route: Route; params: Record<string, string> } | undefined;
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      match = {
        route,
        params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])),
      };
      break;
    }
    if (!match) return { status: 404, body: { error: 'not_found', message: 'Rota não encontrada' } };

    const { route } = match;
    const req: DemoRequest = {
      method,
      url,
      params: match.params,
      query: Object.fromEntries(parsed.searchParams),
      body,
      headers,
      ip: undefined,
      userId: '',
      workspaceId: '',
      sessionId: null,
      access: null as never,
      db: null as never,
    };
    const reply = new DemoReply();

    try {
      const extra = route.options.onRequest;
      const hooks = [...route.scope.allHooks(), ...(Array.isArray(extra) ? extra : extra ? [extra] : [])];
      for (const hook of hooks) await hook(req, reply);

      // Same as fastify-type-provider-zod: validated output replaces the raw input.
      const { schema } = route.options;
      if (schema?.params) req.params = schema.params.parse(req.params);
      if (schema?.querystring) req.query = schema.querystring.parse(req.query);
      if (schema?.body) req.body = schema.body.parse(req.body ?? {});

      const result = await route.handler(req, reply);
      const payload = reply.sent ? reply.payload : result;
      // JSON round-trip mirrors what goes over the wire (Dates → ISO strings).
      return {
        status: reply.statusCode,
        body: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)),
        headers: reply.headers,
      };
    } catch (error) {
      if (error instanceof ZodError || (error as Error)?.name === 'ZodError') return validationError(error as ZodError);
      if (error instanceof AppError) {
        return { status: error.statusCode, body: { error: error.code, message: error.message, details: error.details } };
      }
      console.error('[demo api]', method, url, error);
      return { status: 500, body: { error: 'internal_error', message: 'Erro inesperado. Tente novamente.' } };
    }
  }
}
