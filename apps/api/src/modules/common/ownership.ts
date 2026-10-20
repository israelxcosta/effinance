// Loads resources scoped to the active workspace. Anything outside it is reported as "not found"
// (never "forbidden"), so ids of other workspaces cannot be probed.

import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import {
  accounts,
  categories,
  contacts,
  creditCards,
  goals,
  transactions,
  type AccountRow,
  type CategoryRow,
  type ContactRow,
  type CreditCardRow,
  type GoalRow,
  type TransactionRow,
} from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';

export async function getAccountOrThrow(db: DbExecutor, workspaceId: string, id: string): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, workspaceId)));
  if (!row) throw new NotFoundError('Conta não encontrada');
  return row;
}

export async function getCardOrThrow(db: DbExecutor, workspaceId: string, id: string): Promise<CreditCardRow> {
  const [row] = await db
    .select()
    .from(creditCards)
    .where(and(eq(creditCards.id, id), eq(creditCards.workspaceId, workspaceId)));
  if (!row) throw new NotFoundError('Cartão não encontrado');
  return row;
}

export async function getCategoryOrThrow(db: DbExecutor, workspaceId: string, id: string): Promise<CategoryRow> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.workspaceId, workspaceId)));
  if (!row) throw new NotFoundError('Categoria não encontrada');
  return row;
}

export async function getContactOrThrow(db: DbExecutor, workspaceId: string, id: string): Promise<ContactRow> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId)));
  if (!row) throw new NotFoundError('Contato não encontrado');
  return row;
}

export async function getGoalOrThrow(db: DbExecutor, workspaceId: string, id: string): Promise<GoalRow> {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.workspaceId, workspaceId)));
  if (!row) throw new NotFoundError('Meta não encontrada');
  return row;
}

export async function getTransactionOrThrow(
  db: DbExecutor,
  workspaceId: string,
  id: string,
): Promise<TransactionRow> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)));
  if (!row) throw new NotFoundError('Lançamento não encontrado');
  return row;
}

export interface TransactionRefsInput {
  type: 'income' | 'expense';
  accountId: string | null;
  creditCardId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  contactId: string | null;
}

/** Validates every foreign reference of an income/expense and returns the card (if any). */
export async function validateTransactionRefs(
  db: DbExecutor,
  workspaceId: string,
  refs: TransactionRefsInput,
): Promise<{ card: CreditCardRow | null }> {
  if (refs.accountId && refs.creditCardId) {
    throw new ValidationError('Escolha uma conta OU um cartão');
  }
  if (refs.accountId) await getAccountOrThrow(db, workspaceId, refs.accountId);

  let card: CreditCardRow | null = null;
  if (refs.creditCardId) {
    if (refs.type !== 'expense') throw new ValidationError('Cartão de crédito só pode ser usado em despesas');
    card = await getCardOrThrow(db, workspaceId, refs.creditCardId);
  }

  if (refs.categoryId) {
    const category = await getCategoryOrThrow(db, workspaceId, refs.categoryId);
    if (category.parentId) throw new ValidationError('Selecione uma categoria principal');
    if (category.type !== refs.type) {
      throw new ValidationError(
        refs.type === 'income' ? 'Escolha uma categoria de receita' : 'Escolha uma categoria de despesa',
      );
    }
  }
  if (refs.subcategoryId) {
    if (!refs.categoryId) throw new ValidationError('Selecione a categoria da subcategoria');
    const sub = await getCategoryOrThrow(db, workspaceId, refs.subcategoryId);
    if (sub.parentId !== refs.categoryId) {
      throw new ValidationError('A subcategoria não pertence à categoria selecionada');
    }
  }
  if (refs.contactId) await getContactOrThrow(db, workspaceId, refs.contactId);
  return { card };
}
