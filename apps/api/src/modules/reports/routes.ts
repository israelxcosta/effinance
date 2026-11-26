import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  cashflowReportQuerySchema,
  categoryReportQuerySchema,
  comparisonReportQuerySchema,
  contactReportQuerySchema,
  evolutionReportQuerySchema,
  overviewReportQuerySchema,
} from '@effinance/shared';
import { cashflowReport, categoryReport, comparisonReport, contactReport, evolutionReport, overviewReport } from './service';

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/overview', { schema: { querystring: overviewReportQuerySchema } }, async (req) =>
    overviewReport(req.db, req.workspaceId, req.query),
  );
  app.get('/categories', { schema: { querystring: categoryReportQuerySchema } }, async (req) =>
    categoryReport(req.db, req.workspaceId, req.query),
  );
  app.get('/evolution', { schema: { querystring: evolutionReportQuerySchema } }, async (req) =>
    evolutionReport(req.db, req.workspaceId, req.query),
  );
  app.get('/contacts', { schema: { querystring: contactReportQuerySchema } }, async (req) =>
    contactReport(req.db, req.workspaceId, req.query),
  );
  app.get('/comparison', { schema: { querystring: comparisonReportQuerySchema } }, async (req) =>
    comparisonReport(req.db, req.workspaceId, req.query),
  );
  app.get('/cashflow', { schema: { querystring: cashflowReportQuerySchema } }, async (req) =>
    cashflowReport(req.db, req.workspaceId, req.query),
  );
};
