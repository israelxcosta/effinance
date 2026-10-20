import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accountRoutes } from './modules/accounts/routes';
import { categoryRoutes } from './modules/categories/routes';
import { contactRoutes } from './modules/contacts/routes';
import { creditCardRoutes } from './modules/credit-cards/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { goalRoutes } from './modules/goals/routes';
import { reportRoutes } from './modules/reports/routes';
import { searchRoutes } from './modules/search/routes';
import { statementRoutes } from './modules/statement/routes';
import { transactionRoutes } from './modules/transactions/routes';
import { transferRoutes } from './modules/transfers/routes';

/**
 * Every authenticated domain module, mounted under `/api`. Auth routes are registered separately
 * because they depend on the JWT/cookie plugin (the browser demo provides its own).
 */
export const domainRoutes: { prefix: string; plugin: FastifyPluginAsyncZod }[] = [
  { prefix: '/categories', plugin: categoryRoutes },
  { prefix: '/accounts', plugin: accountRoutes },
  { prefix: '/credit-cards', plugin: creditCardRoutes },
  { prefix: '/goals', plugin: goalRoutes },
  { prefix: '/contacts', plugin: contactRoutes },
  { prefix: '/transactions', plugin: transactionRoutes },
  { prefix: '/transfers', plugin: transferRoutes },
  { prefix: '/statement', plugin: statementRoutes },
  { prefix: '/dashboard', plugin: dashboardRoutes },
  { prefix: '/reports', plugin: reportRoutes },
  { prefix: '/search', plugin: searchRoutes },
];
