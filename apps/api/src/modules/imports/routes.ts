// File imports. Mounted outside lib/tenant-routes (lib/tenant-scope.ts): batch lists show member
// names, which live in identity tables the tenant role cannot read. Shared with the browser demo.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MAX_IMPORT_CONTENT_CHARS, importCommitSchema, importListQuerySchema, importPreviewSchema } from '@effinance/shared';
import { audit } from '../../lib/audit';
import { rateLimited } from '../../lib/platform';
import { requestContext } from '../../lib/request-context';
import { tenantGuards } from '../../lib/tenant-scope';
import { idParams } from '../common/params';
import { commitImport, describeBatch, listImports, previewImport, undoImport } from './service';

/**
 * The preview carries the decoded file: up to MAX_IMPORT_CONTENT_CHARS UTF-16 units, each at most 3
 * bytes of UTF-8 in the JSON body (JSON escapes of text files — \n, \t, \" — take 2), plus the rest.
 */
export const IMPORT_PREVIEW_BODY_LIMIT = MAX_IMPORT_CONTENT_CHARS * 3 + 64 * 1024;
/** Up to MAX_IMPORT_ROWS rows of ~1 KB (200-char descriptions, ids). */
export const IMPORT_COMMIT_BODY_LIMIT = 4 * 1024 * 1024;

export const importRoutes: FastifyPluginAsyncZod = async (app) => {
  tenantGuards(app);

  app.post(
    '/preview',
    {
      bodyLimit: IMPORT_PREVIEW_BODY_LIMIT,
      schema: { body: importPreviewSchema },
      config: rateLimited(app.platform, 30, '1 minute'),
    },
    async (req) => previewImport(app.db, req.workspaceId, req.body),
  );

  app.post(
    '/',
    {
      bodyLimit: IMPORT_COMMIT_BODY_LIMIT,
      schema: { body: importCommitSchema },
      config: rateLimited(app.platform, 20, '1 minute'),
    },
    async (req, reply) => {
      const result = await commitImport(app.db, req.workspaceId, req.userId, req.body);
      await audit(app.db, {
        ...requestContext(req),
        action: 'import.created',
        workspaceId: req.workspaceId,
        userId: req.userId,
        entity: 'import_batch',
        entityId: result.batch.id,
        metadata: { format: req.body.format, target: req.body.target.kind, created: result.created, skipped: result.skipped },
      });
      const batch = await describeBatch(app.db, req.workspaceId, result.batch, result.created);
      return reply.code(201).send({ batch, created: result.created, skipped: result.skipped });
    },
  );

  app.get('/', { schema: { querystring: importListQuerySchema } }, async (req) => listImports(app.db, req.workspaceId, req.query));

  app.delete('/:id', { schema: { params: idParams }, config: rateLimited(app.platform, 30, '1 minute') }, async (req, reply) => {
    const { removed, origin } = await undoImport(app.db, req.workspaceId, req.params.id);
    await audit(app.db, {
      ...requestContext(req),
      action: 'import.undone',
      workspaceId: req.workspaceId,
      userId: req.userId,
      entity: 'import_batch',
      entityId: req.params.id,
      metadata: { origin, removed },
    });
    return reply.code(204).send();
  });
};
