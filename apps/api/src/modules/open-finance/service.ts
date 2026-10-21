// Read-only bank connections (Open Finance Brasil through an aggregator). Requests run in phases:
// tenant transactions (lib/tenant-scope.ts) for our data and provider calls between them — never an
// HTTP call while holding a transaction. Provider ids are bearer references to the user's bank data
// at the aggregator: stored encrypted (FieldCipher) with blind indexes, never logged or exported.

import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  OPEN_FINANCE_DEFAULT_HISTORY_DAYS,
  OPEN_FINANCE_MAX_HISTORY_DAYS,
  addDays,
  maxISO,
  monthKey,
  type BankConnection,
  type BankConnectionAccount,
  type BankConnectionStatus,
  type ConnectTokenResponse,
  type FakeInstitution,
  type ISODate,
  type OpenFinanceStatus,
  type SyncResult,
  type linkAccountsSchema,
} from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import {
  accounts,
  bankConnectionAccounts,
  bankConnections,
  categories,
  importBatches,
  openFinanceItems,
  transactions,
  type BankConnectionAccountRow,
  type BankConnectionRow,
} from '../../db/schema';
import { getCipher } from '../../lib/crypto/keyring';
import { platformHmac } from '../../lib/crypto/platform-keys';
import { today } from '../../lib/clock';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { serializeError } from '../../lib/log';
import { inTenant } from '../../lib/tenant-scope';
import { accountMovements } from '../accounts/balances';
import { createAccount } from '../accounts/service';
import { getAccountOrThrow, getCardOrThrow } from '../common/ownership';
import { createCreditCard } from '../credit-cards/service';
import { isCardBillPayment } from '../imports/describe';
import { loadCategorySuggester, type CategorySuggester } from '../imports/suggest';
import { existingByExternalId, insertImported, type ImportedRow, type ResolvedTarget } from '../imports/writer';
import { invoiceMonthFor } from '../transactions/series';
import { FakeOpenFinanceProvider } from './providers/fake';
import { bankColor, bankFromInstitution, cardBrandOf } from './institutions';
import { maskNumber, type OpenFinanceSetup, type ProviderAccount, type ProviderTransaction } from './providers/types';

export interface LogLike {
  warn(obj: object, msg: string): void;
}

export interface OpenFinanceContext {
  /** System connection (tenant data only through `inTenant`). */
  db: DbExecutor;
  of: OpenFinanceSetup | null | undefined;
  log?: LogLike;
}

type LinkInput = z.output<typeof linkAccountsSchema>;

const CONN_TABLE = 'bank_connections';
const ITEM_COLUMN = 'provider_item_id';
const FEED_TABLE = 'bank_connection_accounts';
const ACCOUNT_COLUMN = 'provider_account_id';
/** Platform key of the webhook routing index (`open_finance_items`). */
export const ITEM_INDEX_KEY = 'open-finance-items';
/** A resync re-reads this many days before the last synced date (late postings, corrections). */
export const RESYNC_OVERLAP_DAYS = 7;

export const STATUS_DETAILS: Record<BankConnectionStatus, string | null> = {
  active: null,
  syncing: 'A instituição está atualizando os dados. Tente sincronizar de novo em alguns minutos.',
  login_error: 'A instituição recusou ou revogou o consentimento. Reconecte para voltar a sincronizar.',
  waiting_user_input: 'Confirme o compartilhamento de dados no aplicativo da instituição.',
  outdated: 'O consentimento expirou ou a última atualização falhou. Reconecte ou tente novamente.',
  error: 'Não foi possível sincronizar com a instituição. Tente novamente mais tarde.',
};
const GONE_DETAIL = 'Esta conexão não existe mais no agregador. Remova-a e conecte a instituição de novo.';

/** The aggregator failed or did not answer (details only in the server log, without ids). */
export class ProviderUnavailableError extends AppError {
  constructor() {
    super(502, 'provider_unavailable', 'A instituição ou o agregador não respondeu. Tente novamente em instantes.');
  }
}

async function call<T>(ctx: OpenFinanceContext, op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) throw error;
    ctx.log?.warn({ err: serializeError(error), op }, 'open finance provider call failed');
    throw new ProviderUnavailableError();
  }
}

export function openFinanceStatus(of: OpenFinanceSetup | null | undefined): OpenFinanceStatus {
  return of ? { enabled: true, provider: of.provider.name, sandbox: of.provider.sandbox } : { enabled: false, provider: null, sandbox: false };
}

export function requireSetup(of: OpenFinanceSetup | null | undefined): OpenFinanceSetup {
  if (!of) throw new NotFoundError('Open Finance não está disponível neste ambiente');
  return of;
}

function requireFake(of: OpenFinanceSetup | null | undefined): FakeOpenFinanceProvider {
  if (!of || !(of.provider instanceof FakeOpenFinanceProvider)) throw new NotFoundError('Rota não encontrada');
  return of.provider;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function toAccountDto(row: BankConnectionAccountRow): BankConnectionAccount {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    number: row.number,
    balance: row.balance,
    creditLimit: row.creditLimit,
    linkedAccountId: row.linkedAccountId,
    linkedCreditCardId: row.linkedCreditCardId,
    syncFrom: row.syncFrom,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
  };
}

function toConnectionDto(row: BankConnectionRow, feeds: BankConnectionAccountRow[]): BankConnection {
  return {
    id: row.id,
    provider: row.provider,
    institution: { name: row.institutionName, imageUrl: row.institutionImageUrl, bank: row.institutionBank },
    status: row.status,
    statusDetail: row.statusDetail,
    consentExpiresAt: row.consentExpiresAt?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    accounts: feeds
      .filter((f) => f.connectionId === row.id)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.createdAt.getTime() - b.createdAt.getTime())
      .map(toAccountDto),
  };
}

async function loadConnections(tx: DbExecutor, workspaceId: string, id?: string): Promise<BankConnection[]> {
  const rows = await tx
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.workspaceId, workspaceId), id ? eq(bankConnections.id, id) : undefined))
    .orderBy(bankConnections.createdAt);
  if (rows.length === 0) return [];
  const feeds = await tx
    .select()
    .from(bankConnectionAccounts)
    .where(and(eq(bankConnectionAccounts.workspaceId, workspaceId), inArray(bankConnectionAccounts.connectionId, rows.map((r) => r.id))));
  return rows.map((r) => toConnectionDto(r, feeds));
}

async function getConnectionRow(tx: DbExecutor, workspaceId: string, id: string): Promise<BankConnectionRow> {
  const [row] = await tx
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.workspaceId, workspaceId), eq(bankConnections.id, id)));
  if (!row) throw new NotFoundError('Conexão não encontrada');
  return row;
}

export async function listConnections(db: DbExecutor, workspaceId: string): Promise<BankConnection[]> {
  return inTenant(db, workspaceId, (tx) => loadConnections(tx, workspaceId));
}

// ---------------------------------------------------------------------------
// Provider references (encrypted + blind index)
// ---------------------------------------------------------------------------

async function sealItem(workspaceId: string, provider: string, itemId: string) {
  const cipher = await getCipher(workspaceId);
  return { enc: (await cipher.encrypt(CONN_TABLE, ITEM_COLUMN, itemId))!, hash: await cipher.blindIndex(`${provider}:item:${itemId}`) };
}

async function sealAccount(workspaceId: string, provider: string, accountId: string) {
  const cipher = await getCipher(workspaceId);
  return {
    enc: (await cipher.encrypt(FEED_TABLE, ACCOUNT_COLUMN, accountId))!,
    hash: await cipher.blindIndex(`${provider}:account:${accountId}`),
  };
}

async function openItem(row: BankConnectionRow): Promise<string> {
  return (await (await getCipher(row.workspaceId)).decrypt(CONN_TABLE, ITEM_COLUMN, row.providerItemId))!;
}

async function openAccount(row: BankConnectionAccountRow): Promise<string> {
  return (await (await getCipher(row.workspaceId)).decrypt(FEED_TABLE, ACCOUNT_COLUMN, row.providerAccountId))!;
}

/** Webhook routing entry (global table, system connection). Failures only delay webhooks until a sync. */
async function indexItem(ctx: OpenFinanceContext, workspaceId: string, connectionId: string, provider: string, itemId: string) {
  try {
    const itemHash = await platformHmac(ctx.db, ITEM_INDEX_KEY, `${provider}:${itemId}`);
    await ctx.db.insert(openFinanceItems).values({ itemHash, workspaceId, connectionId }).onConflictDoNothing();
  } catch (error) {
    ctx.log?.warn({ err: serializeError(error) }, 'open finance webhook index not written');
  }
}

type SealedAccount = { account: ProviderAccount; enc: string; hash: string };

/** Inserts new provider accounts of the connection and refreshes the known ones (names, balances…). */
async function upsertFeeds(tx: DbExecutor, workspaceId: string, connectionId: string, sealed: SealedAccount[]) {
  const existing = await tx
    .select()
    .from(bankConnectionAccounts)
    .where(and(eq(bankConnectionAccounts.workspaceId, workspaceId), eq(bankConnectionAccounts.connectionId, connectionId)));
  const byHash = new Map(existing.map((e) => [e.providerAccountHash, e]));
  for (const { account: a, enc, hash } of sealed) {
    const info = {
      name: a.name.slice(0, 60),
      number: maskNumber(a.number),
      balance: a.balance,
      creditLimit: a.creditLimit,
      accountType: a.accountType,
      cardBrand: cardBrandOf(a.brand),
      closingDay: a.closingDay,
      dueDay: a.dueDay,
    };
    const known = byHash.get(hash);
    if (known) {
      await tx.update(bankConnectionAccounts).set(info).where(eq(bankConnectionAccounts.id, known.id));
    } else {
      await tx.insert(bankConnectionAccounts).values({
        workspaceId,
        connectionId,
        providerAccountId: enc,
        providerAccountHash: hash,
        kind: a.kind,
        ...info,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Consent (connect token) and the simulated widget
// ---------------------------------------------------------------------------

export async function createConnectToken(
  ctx: OpenFinanceContext,
  workspaceId: string,
  connectionId: string | undefined,
): Promise<ConnectTokenResponse> {
  const { provider, webhookUrl } = requireSetup(ctx.of);
  let updateItemId: string | null = null;
  if (connectionId) {
    const row = await inTenant(ctx.db, workspaceId, (tx) => getConnectionRow(tx, workspaceId, connectionId));
    if (row.provider !== provider.name) throw new ValidationError('Esta conexão foi criada com outro provedor de Open Finance');
    updateItemId = await openItem(row);
  }
  const token = await call(ctx, 'createConnectToken', () =>
    provider.createConnectToken({ clientUserId: workspaceId, webhookUrl, itemId: updateItemId }),
  );
  return {
    provider: provider.name,
    accessToken: token.accessToken,
    updateItemId,
    sandbox: provider.sandbox,
    expiresAt: token.expiresAt.toISOString(),
  };
}

export function fakeInstitutions(of: OpenFinanceSetup | null | undefined): FakeInstitution[] {
  return requireFake(of).institutions();
}

export function fakeConnect(of: OpenFinanceSetup | null | undefined, workspaceId: string, institutionId: string): { itemId: string } {
  const out = requireFake(of).connect(institutionId, workspaceId);
  if (!out) throw new NotFoundError('Instituição não encontrada');
  return out;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * Registers the item returned by the consent widget. The item is fetched from the provider (never
 * taken from the client) and must belong to this workspace (`clientUserId`, set by our connect
 * token): an item id of another customer is "not found". Outside sandbox only Open Finance
 * connectors are accepted (no screen-scraping with bank passwords). Re-sending a known item
 * refreshes it (re-consent).
 */
export async function createConnection(
  ctx: OpenFinanceContext,
  workspaceId: string,
  userId: string,
  itemId: string,
): Promise<{ connection: BankConnection; created: boolean }> {
  const { provider } = requireSetup(ctx.of);
  const item = await call(ctx, 'getItem', () => provider.getItem(itemId));
  if (!item || item.clientUserId !== workspaceId) {
    throw new NotFoundError('Conexão não encontrada no provedor. Conecte a instituição novamente.');
  }
  if (!provider.sandbox && (!item.connector.isOpenFinance || item.connector.isSandbox)) {
    throw new ValidationError('Somente conexões pelo Open Finance Brasil são aceitas.');
  }
  const providerAccounts = await call(ctx, 'listAccounts', () => provider.listAccounts(item.id));
  const ref = await sealItem(workspaceId, provider.name, item.id);
  const sealed = await Promise.all(providerAccounts.map(async (account) => ({ account, ...(await sealAccount(workspaceId, provider.name, account.id)) })));

  const result = await inTenant(ctx.db, workspaceId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.workspaceId, workspaceId),
          eq(bankConnections.provider, provider.name),
          eq(bankConnections.providerItemHash, ref.hash),
        ),
      );
    const info = {
      institutionName: item.connector.name,
      institutionImageUrl: item.connector.imageUrl,
      institutionBank: bankFromInstitution(item.connector.name),
      status: item.status,
      statusDetail: STATUS_DETAILS[item.status],
      consentExpiresAt: item.consentExpiresAt,
    };
    let id: string;
    if (existing) {
      await tx.update(bankConnections).set(info).where(eq(bankConnections.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await tx
        .insert(bankConnections)
        .values({ workspaceId, provider: provider.name, providerItemId: ref.enc, providerItemHash: ref.hash, createdBy: userId, ...info })
        .returning({ id: bankConnections.id });
      id = row!.id;
    }
    await upsertFeeds(tx, workspaceId, id, sealed);
    const [connection] = await loadConnections(tx, workspaceId, id);
    return { connection: connection!, created: !existing };
  });
  await indexItem(ctx, workspaceId, result.connection.id, provider.name, item.id);
  return result;
}

function defaultSyncFrom(): ISODate {
  return addDays(today(), -OPEN_FINANCE_DEFAULT_HISTORY_DAYS);
}

/** Chooses, for each account of the connection, the local account/card it feeds. */
export async function linkAccounts(db: DbExecutor, workspaceId: string, connectionId: string, input: LinkInput): Promise<BankConnection> {
  const ids = input.links.map((l) => l.connectionAccountId);
  if (new Set(ids).size !== ids.length) throw new ValidationError('Cada conta da conexão deve aparecer uma só vez');
  const now = today();
  const oldest = addDays(now, -OPEN_FINANCE_MAX_HISTORY_DAYS);
  for (const l of input.links) {
    if (l.syncFrom && (l.syncFrom < oldest || l.syncFrom > now)) {
      throw new ValidationError(`Escolha uma data inicial entre ${oldest} e hoje (até ${OPEN_FINANCE_MAX_HISTORY_DAYS} dias de histórico)`);
    }
  }

  return inTenant(db, workspaceId, async (tx) => {
    const connection = await getConnectionRow(tx, workspaceId, connectionId);
    const feeds = await tx
      .select()
      .from(bankConnectionAccounts)
      .where(and(eq(bankConnectionAccounts.workspaceId, workspaceId), eq(bankConnectionAccounts.connectionId, connectionId)));
    const byId = new Map(feeds.map((f) => [f.id, f]));
    // Bank accounts first, so a new card can default to paying its invoice from the linked account.
    const rank = (l: LinkInput['links'][number]) => (byId.get(l.connectionAccountId)?.kind === 'bank' ? 0 : 1);
    const links = [...input.links].sort((a, b) => rank(a) - rank(b));
    let payingAccount: string | null = feeds.find((f) => f.kind === 'bank' && f.linkedAccountId)?.linkedAccountId ?? null;

    for (const link of links) {
      const feed = byId.get(link.connectionAccountId);
      if (!feed) throw new NotFoundError('Conta da conexão não encontrada');
      let linkedAccountId: string | null = null;
      let linkedCreditCardId: string | null = null;
      let adjustInitialBalance = false;
      const target = link.target;
      if (target.kind === 'account' && feed.kind !== 'bank') {
        throw new ValidationError('Vincule o cartão da instituição a um cartão de crédito');
      }
      if (target.kind === 'credit_card' && feed.kind !== 'credit_card') {
        throw new ValidationError('Vincule a conta da instituição a uma conta bancária');
      }
      switch (target.kind) {
        case 'account':
          linkedAccountId = (await getAccountOrThrow(tx, workspaceId, target.accountId)).id;
          break;
        case 'credit_card':
          linkedCreditCardId = (await getCardOrThrow(tx, workspaceId, target.creditCardId)).id;
          break;
        case 'new': {
          const bank = connection.institutionBank;
          if (feed.kind === 'bank') {
            const created = await createAccount(tx, workspaceId, {
              name: `${connection.institutionName} — ${feed.name}`.slice(0, 60),
              type: feed.accountType ?? 'checking',
              bank,
              color: bankColor(bank),
              icon: 'landmark',
              initialBalance: 0,
              includeInTotal: true,
              archived: false,
            });
            linkedAccountId = created.id;
            // The first sync sets the initial balance so the balance matches the bank's.
            adjustInitialBalance = true;
          } else {
            const dueDay = feed.dueDay ?? 10;
            const card = await createCreditCard(tx, workspaceId, {
              name: feed.name.slice(0, 60),
              bank: bank ?? 'other',
              brand: feed.cardBrand ?? 'other',
              limit: Math.max(0, feed.creditLimit ?? 0),
              closingDay: feed.closingDay ?? (((dueDay + 23) % 31) || 31),
              dueDay,
              color: bankColor(bank),
              defaultAccountId: payingAccount,
              archived: false,
            });
            linkedCreditCardId = card.id;
          }
          break;
        }
        case 'ignore':
          break;
      }

      if (linkedAccountId) payingAccount ??= linkedAccountId;
      // One feed per local account/card (the partial unique index settles races).
      if (linkedAccountId || linkedCreditCardId) {
        const [taken] = await tx
          .select({ id: bankConnectionAccounts.id })
          .from(bankConnectionAccounts)
          .where(
            and(
              eq(bankConnectionAccounts.workspaceId, workspaceId),
              ne(bankConnectionAccounts.id, feed.id),
              linkedAccountId
                ? eq(bankConnectionAccounts.linkedAccountId, linkedAccountId)
                : eq(bankConnectionAccounts.linkedCreditCardId, linkedCreditCardId!),
            ),
          );
        if (taken) throw new ConflictError('Esta conta ou cartão já recebe lançamentos de outra conexão');
      }

      const sameTarget = feed.linkedAccountId === linkedAccountId && feed.linkedCreditCardId === linkedCreditCardId;
      const linked = linkedAccountId !== null || linkedCreditCardId !== null;
      const syncFrom = linked ? (link.syncFrom ?? (sameTarget ? feed.syncFrom : null) ?? defaultSyncFrom()) : feed.syncFrom;
      await tx
        .update(bankConnectionAccounts)
        .set({
          linkedAccountId,
          linkedCreditCardId,
          syncFrom,
          // A new destination (or start date) reads the history again from syncFrom; dedupe by
          // externalId keeps it idempotent.
          ...(sameTarget && syncFrom === feed.syncFrom ? {} : { lastSyncAt: null, cursor: null }),
          ...(sameTarget ? {} : { adjustInitialBalance }),
        })
        .where(eq(bankConnectionAccounts.id, feed.id));
    }
    const [dto] = await loadConnections(tx, workspaceId, connectionId);
    return dto!;
  });
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** First date to read: syncFrom, or a week before the last synced date. */
export function syncWindowStart(feed: Pick<BankConnectionAccountRow, 'syncFrom' | 'lastSyncAt' | 'cursor'>): ISODate {
  const from = feed.syncFrom ?? defaultSyncFrom();
  if (!feed.lastSyncAt) return from;
  const lastSync = feed.lastSyncAt.toISOString().slice(0, 10);
  const anchor = feed.cursor && feed.cursor < lastSync ? feed.cursor : lastSync;
  return maxISO(from, addDays(anchor, -RESYNC_OVERLAP_DAYS));
}

interface FeedFetch {
  feed: BankConnectionAccountRow;
  transactions: ProviderTransaction[];
  billDue: Map<string, ISODate>;
}

export interface SyncActor {
  userId: string | null;
}

async function markGone(db: DbExecutor, workspaceId: string, connectionId: string) {
  await inTenant(db, workspaceId, (tx) =>
    tx
      .update(bankConnections)
      .set({ status: 'error', statusDetail: GONE_DETAIL })
      .where(and(eq(bankConnections.workspaceId, workspaceId), eq(bankConnections.id, connectionId))),
  );
}

/**
 * Pulls the item, its accounts and the transactions of every linked account from the provider and
 * writes them: pending transactions are ignored; account debits/credits become paid expenses/incomes;
 * card purchases go to the invoice of their bill's due date (or of the purchase date); card credits
 * (bill payments, refunds) and account debits that pay a card bill are skipped — in Effinance the
 * bill is paid from the invoice (a transfer). Idempotent by externalId = provider transaction id.
 */
export async function syncConnection(
  ctx: OpenFinanceContext,
  workspaceId: string,
  connectionId: string,
  actor: SyncActor,
): Promise<SyncResult> {
  const { provider } = requireSetup(ctx.of);
  const snapshot = await inTenant(ctx.db, workspaceId, async (tx) => ({
    connection: await getConnectionRow(tx, workspaceId, connectionId),
    feeds: await tx
      .select()
      .from(bankConnectionAccounts)
      .where(and(eq(bankConnectionAccounts.workspaceId, workspaceId), eq(bankConnectionAccounts.connectionId, connectionId))),
  }));
  if (snapshot.connection.provider !== provider.name) {
    throw new ValidationError('Esta conexão foi criada com outro provedor de Open Finance');
  }
  const itemId = await openItem(snapshot.connection);

  // Provider phase (no transaction open).
  const item = await call(ctx, 'getItem', () => provider.getItem(itemId));
  if (!item || item.clientUserId !== workspaceId) {
    await markGone(ctx.db, workspaceId, connectionId);
    const [connection] = await inTenant(ctx.db, workspaceId, (tx) => loadConnections(tx, workspaceId, connectionId));
    return { connection: connection!, created: 0, updated: 0, skipped: 0 };
  }
  const providerAccounts = await call(ctx, 'listAccounts', () => provider.listAccounts(itemId));
  const sealed = await Promise.all(providerAccounts.map(async (account) => ({ account, ...(await sealAccount(workspaceId, provider.name, account.id)) })));
  const balanceByHash = new Map(sealed.map((s) => [s.hash, s.account.balance]));
  const now = today();
  const fetched: FeedFetch[] = [];
  for (const feed of snapshot.feeds) {
    if (!feed.linkedAccountId && !feed.linkedCreditCardId) continue;
    const accountId = await openAccount(feed);
    const txs = await call(ctx, 'listTransactions', () => provider.listTransactions(accountId, { from: syncWindowStart(feed), to: now }));
    const billDue = new Map<string, ISODate>();
    if (feed.kind === 'credit_card' && txs.some((t) => t.billId)) {
      for (const bill of await call(ctx, 'listBills', () => provider.listBills(accountId))) billDue.set(bill.id, bill.dueDate);
    }
    fetched.push({ feed, transactions: txs, billDue });
  }

  const result = await inTenant(ctx.db, workspaceId, async (tx) => {
    // Serializes concurrent syncs of the same connection (webhook + button).
    const [locked] = await tx
      .select({ id: bankConnections.id })
      .from(bankConnections)
      .where(and(eq(bankConnections.workspaceId, workspaceId), eq(bankConnections.id, connectionId)))
      .for('update');
    if (!locked) throw new NotFoundError('Conexão não encontrada');
    await upsertFeeds(tx, workspaceId, connectionId, sealed);
    const syncedAt = new Date();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let suggester: CategorySuggester | null = null;

    for (const { feed: seen, transactions: txs, billDue } of fetched) {
      const [feed] = await tx.select().from(bankConnectionAccounts).where(eq(bankConnectionAccounts.id, seen.id));
      // Re-linked or unlinked meanwhile: the fetched window belongs to the old destination.
      if (!feed || feed.linkedAccountId !== seen.linkedAccountId || feed.linkedCreditCardId !== seen.linkedCreditCardId) continue;
      let target: ResolvedTarget;
      try {
        target = feed.linkedAccountId
          ? { kind: 'account', account: await getAccountOrThrow(tx, workspaceId, feed.linkedAccountId) }
          : { kind: 'credit_card', card: await getCardOrThrow(tx, workspaceId, feed.linkedCreditCardId!) };
      } catch {
        continue;
      }
      const posted = txs.filter((t) => !t.pending);
      const existing = await existingByExternalId(tx, workspaceId, target, posted.map((t) => t.id));
      const fresh: ImportedRow[] = [];
      let feedSkipped = 0;
      for (const t of posted) {
        const income = t.direction === 'in';
        const isCard = target.kind === 'credit_card';
        // Card credits (payments, refunds) do not enter invoices; bill payments are transfers here.
        if (t.amount === 0 || (isCard && income) || (!isCard && !income && isCardBillPayment(t.description))) {
          feedSkipped += 1;
          continue;
        }
        const invoiceMonth =
          target.kind === 'credit_card'
            ? t.billId && billDue.has(t.billId)
              ? monthKey(billDue.get(t.billId)!)
              : invoiceMonthFor(target.card, t.date)
            : null;
        const hit = existing.get(t.id);
        if (hit) {
          if (hit.amount === t.amount && hit.date === t.date) {
            feedSkipped += 1;
          } else if (isCard && hit.paid) {
            // Already paid with its invoice: leave it.
            feedSkipped += 1;
          } else {
            await tx
              .update(transactions)
              .set({ amount: t.amount, date: t.date, ...(isCard ? { invoiceMonth } : { paidAt: t.date }) })
              .where(eq(transactions.id, hit.id));
            updated += 1;
          }
          continue;
        }
        suggester ??= await loadCategorySuggester(tx, workspaceId);
        const type = income ? 'income' : 'expense';
        const suggestion = suggester.suggest(t.description, type);
        fresh.push({
          date: t.date,
          description: t.description.replace(/\s+/g, ' ').trim().slice(0, 200),
          amount: t.amount,
          type,
          externalId: t.id,
          ...(await categoryColumns(tx, suggestion)),
          invoiceMonth,
        });
      }
      let feedCreated = 0;
      if (fresh.length > 0) {
        const [batch] = await tx
          .insert(importBatches)
          .values({
            workspaceId,
            origin: 'open_finance',
            connectionId,
            accountId: target.kind === 'account' ? target.account.id : null,
            creditCardId: target.kind === 'credit_card' ? target.card.id : null,
            createdBy: actor.userId,
          })
          .returning({ id: importBatches.id });
        feedCreated = await insertImported(tx, workspaceId, target, fresh, { id: batch!.id, origin: 'open_finance' });
        feedSkipped += fresh.length - feedCreated;
        await tx.update(importBatches).set({ createdCount: feedCreated, skippedCount: feedSkipped }).where(eq(importBatches.id, batch!.id));
      }
      created += feedCreated;
      skipped += feedSkipped;

      const latest = posted.reduce<string | null>((max, t) => (max === null || t.date > max ? t.date : max), null);
      const balance = balanceByHash.get(feed.providerAccountHash) ?? null;
      let adjust = feed.adjustInitialBalance;
      if (adjust && target.kind === 'account' && balance !== null) {
        // Account created from the institution: start from the balance that makes today's match the bank.
        const realized = (await accountMovements(tx, workspaceId, now)).get(target.account.id)?.realized ?? 0;
        await tx.update(accounts).set({ initialBalance: balance - realized }).where(eq(accounts.id, target.account.id));
        adjust = false;
      }
      await tx
        .update(bankConnectionAccounts)
        .set({ lastSyncAt: syncedAt, cursor: latest && (!feed.cursor || latest > feed.cursor) ? latest : feed.cursor, adjustInitialBalance: adjust })
        .where(eq(bankConnectionAccounts.id, feed.id));
    }

    await tx
      .update(bankConnections)
      .set({
        status: item.status,
        statusDetail: STATUS_DETAILS[item.status],
        consentExpiresAt: item.consentExpiresAt,
        institutionName: item.connector.name,
        institutionImageUrl: item.connector.imageUrl,
        lastSyncAt: syncedAt,
      })
      .where(eq(bankConnections.id, connectionId));
    const [connection] = await loadConnections(tx, workspaceId, connectionId);
    return { connection: connection!, created, updated, skipped };
  });
  // Self-healing webhook index (e.g. when writing it failed at connection time).
  await indexItem(ctx, workspaceId, connectionId, provider.name, itemId);
  return result;
}

/** Suggested id → category/subcategory columns (the suggestion may be a subcategory). */
async function categoryColumns(tx: DbExecutor, id: string | null): Promise<{ categoryId: string | null; subcategoryId: string | null }> {
  if (!id) return { categoryId: null, subcategoryId: null };
  const [row] = await tx.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, id));
  if (!row) return { categoryId: null, subcategoryId: null };
  return row.parentId ? { categoryId: row.parentId, subcategoryId: id } : { categoryId: id, subcategoryId: null };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/** Revokes the item at the provider (deleting its data there), then removes the connection. Imported rows stay. */
export async function deleteConnection(ctx: OpenFinanceContext, workspaceId: string, connectionId: string): Promise<void> {
  const row = await inTenant(ctx.db, workspaceId, (tx) => getConnectionRow(tx, workspaceId, connectionId));
  const provider = ctx.of?.provider;
  if (provider && provider.name === row.provider) {
    const itemId = await openItem(row);
    await call(ctx, 'deleteItem', () => provider.deleteItem(itemId));
  } else {
    ctx.log?.warn({ provider: row.provider }, 'open finance connection removed without revoking it at the provider');
  }
  await inTenant(ctx.db, workspaceId, (tx) =>
    tx.delete(bankConnections).where(and(eq(bankConnections.workspaceId, workspaceId), eq(bankConnections.id, connectionId))),
  );
}

/** Before deleting workspaces (or the account owning them): revoke every item at the provider. */
export async function revokeForDeletion(ctx: OpenFinanceContext, workspaceIds: string[]): Promise<number> {
  const provider = ctx.of?.provider;
  let revoked = 0;
  for (const workspaceId of workspaceIds) {
    const rows = await inTenant(ctx.db, workspaceId, (tx) => tx.select().from(bankConnections).where(eq(bankConnections.workspaceId, workspaceId)));
    for (const row of rows) {
      if (!provider || provider.name !== row.provider) {
        ctx.log?.warn({ provider: row.provider }, 'open finance item not revoked: provider not configured');
        continue;
      }
      const itemId = await openItem(row);
      await call(ctx, 'deleteItem', () => provider.deleteItem(itemId));
      revoked += 1;
    }
  }
  return revoked;
}

/** Connections and import batches for the LGPD export (no provider ids, hashes or cursors). */
export async function exportOpenFinance(tx: DbExecutor) {
  const [connections, feeds, batches] = await Promise.all([
    tx.select().from(bankConnections).orderBy(bankConnections.createdAt),
    tx.select().from(bankConnectionAccounts).orderBy(bankConnectionAccounts.createdAt),
    tx.select().from(importBatches).orderBy(importBatches.createdAt),
  ]);
  return {
    bankConnections: connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      institution: c.institutionName,
      bank: c.institutionBank,
      status: c.status,
      consentExpiresAt: c.consentExpiresAt,
      lastSyncAt: c.lastSyncAt,
      createdAt: c.createdAt,
      accounts: feeds
        .filter((f) => f.connectionId === c.id)
        .map((f) => ({
          id: f.id,
          kind: f.kind,
          name: f.name,
          number: f.number,
          balance: f.balance,
          creditLimit: f.creditLimit,
          linkedAccountId: f.linkedAccountId,
          linkedCreditCardId: f.linkedCreditCardId,
          syncFrom: f.syncFrom,
          lastSyncAt: f.lastSyncAt,
        })),
    })),
    importBatches: batches.map(({ workspaceId: _ws, ...b }) => b),
  };
}
