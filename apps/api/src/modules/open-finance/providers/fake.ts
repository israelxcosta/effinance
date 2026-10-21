// Simulated aggregator for development, tests and the browser demo: a few institutions, each with a
// checking account and a credit card, and realistic movements generated deterministically from
// (institution, account, date) — the same day always yields the same transactions and ids, so syncs
// are reproducible and idempotent. Items are recognized from their id (no server state to lose on a
// restart); only deletions and test overrides live in memory.

import {
  addDays,
  addMonthKey,
  getInvoiceDates,
  getInvoiceForPurchase,
  maxISO,
  minISO,
  monthKey,
  parseISODate,
  type BankConnectionStatus,
  type FakeInstitution,
  type ISODate,
} from '@effinance/shared';
import { toHex } from '../../../lib/crypto/encoding';
import { today } from '../../../lib/clock';
import type {
  ConnectTokenRequest,
  OpenFinanceProvider,
  ProviderAccount,
  ProviderBill,
  ProviderItem,
  ProviderTransaction,
} from './types';

export const FAKE_INSTITUTIONS: FakeInstitution[] = [
  { id: 'nubank', name: 'Nubank', bank: 'nubank' },
  { id: 'itau', name: 'Itaú Unibanco', bank: 'itau' },
  { id: 'bb', name: 'Banco do Brasil', bank: 'bb' },
  { id: 'inter', name: 'Banco Inter', bank: 'inter' },
  { id: 'bradesco', name: 'Bradesco', bank: 'bradesco' },
  { id: 'santander', name: 'Santander', bank: 'santander' },
  { id: 'c6', name: 'C6 Bank', bank: 'c6' },
];

/** Card cycle of every simulated card. */
export const FAKE_CARD = { closingDay: 3, dueDay: 10, limit: 800_000 } as const;
/** How far back the simulated history goes. */
const HISTORY_DAYS = 400;

const ITEM_RE = /^fake_([a-z0-9]+)_([0-9a-f]{32})_([0-9a-f]{12})$/;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 seeded by a string. */
function random(seed: string) {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MERCHANTS_DEBIT = ['Padaria Pão Quente', 'Supermercado Bom Preço', 'Farmácia Saúde Exemplo', 'Hortifruti da Esquina', 'Açougue Central'];
const PEOPLE = ['Ana Exemplo', 'Carlos Exemplo', 'Joana Exemplo', 'Pedro Exemplo'];
const CARD_MERCHANTS: [string, number, number][] = [
  ['iFood *Restaurante Sabor', 3500, 9800],
  ['Uber *Trip', 1290, 4800],
  ['Posto Exemplo Combustíveis', 12000, 26000],
  ['Mercado Livre *Loja Exemplo', 4500, 21000],
  ['Amazon Marketplace', 3900, 18900],
  ['Cinema Exemplo', 3000, 7600],
  ['Livraria Exemplo', 4200, 12900],
];

interface Movement {
  description: string;
  amount: number;
  direction: 'in' | 'out';
}

function between(r: () => number, min: number, max: number): number {
  return Math.round(min + r() * (max - min));
}

function checkingMovements(institution: string, date: ISODate): Movement[] {
  const r = random(`${institution}:checking:${date}`);
  const { day } = parseISODate(date);
  const out: Movement[] = [];
  const monthly = random(`${institution}:checking:${monthKey(date)}`);
  if (day === 5) out.push({ description: 'Pix recebido - Empresa Exemplo Ltda (salário)', amount: between(monthly, 520_000, 680_000), direction: 'in' });
  if (day === 10) out.push({ description: 'Pix enviado - Imobiliária Exemplo (aluguel)', amount: 210_000, direction: 'out' });
  if (day === 15) out.push({ description: 'Conta de luz - Débito automático', amount: between(monthly, 12_000, 26_000), direction: 'out' });
  if (day === 18) out.push({ description: 'Internet Fibra Exemplo - Débito automático', amount: 11_990, direction: 'out' });
  if (day === 22) out.push({ description: 'PAGAMENTO FATURA CARTAO', amount: between(monthly, 80_000, 220_000), direction: 'out' });
  if (r() < 0.45) {
    out.push({ description: `Compra no débito - ${MERCHANTS_DEBIT[Math.floor(r() * MERCHANTS_DEBIT.length)]}`, amount: between(r, 1_500, 18_000), direction: 'out' });
  }
  if (r() < 0.2) out.push({ description: `Pix enviado - ${PEOPLE[Math.floor(r() * PEOPLE.length)]}`, amount: between(r, 2_000, 30_000), direction: 'out' });
  if (r() < 0.06) out.push({ description: `Pix recebido - ${PEOPLE[Math.floor(r() * PEOPLE.length)]}`, amount: between(r, 5_000, 40_000), direction: 'in' });
  return out;
}

function cardMovements(institution: string, date: ISODate): Movement[] {
  const r = random(`${institution}:card:${date}`);
  const { year, month, day } = parseISODate(date);
  const out: Movement[] = [];
  const purchases = r() < 0.7 ? (r() < 0.3 ? 2 : 1) : 0;
  for (let i = 0; i < purchases; i++) {
    const [name, min, max] = CARD_MERCHANTS[Math.floor(r() * CARD_MERCHANTS.length)]!;
    out.push({ description: name, amount: between(r, min, max), direction: 'out' });
  }
  if (day === 8) out.push({ description: 'Spotify Exemplo', amount: 2_190, direction: 'out' });
  if (day === 12) out.push({ description: 'Streaming Exemplo', amount: 5_590, direction: 'out' });
  if (day === 14) {
    const k = ((year * 12 + month) % 6) + 1;
    out.push({ description: `Loja de Eletrônicos - Parcela ${k}/6`, amount: 33_317, direction: 'out' });
  }
  if (day === 20) out.push({ description: 'Academia Exemplo', amount: 9_990, direction: 'out' });
  if (day === FAKE_CARD.dueDay) out.push({ description: 'Pagamento recebido', amount: between(random(`${institution}:bill:${monthKey(date)}`), 80_000, 220_000), direction: 'in' });
  if (r() < 0.03) out.push({ description: 'Estorno - Loja Exemplo', amount: between(r, 1_000, 8_000), direction: 'in' });
  return out;
}

export class FakeOpenFinanceProvider implements OpenFinanceProvider {
  readonly name = 'fake' as const;
  readonly sandbox = true;
  private readonly deleted = new Set<string>();
  private readonly statuses = new Map<string, BankConnectionStatus>();
  private readonly amounts = new Map<string, number>();

  institutions(): FakeInstitution[] {
    return FAKE_INSTITUTIONS;
  }

  /** What the simulated consent widget does: creates an item for `clientUserId` (the workspace). */
  connect(institutionId: string, clientUserId: string): { itemId: string } | null {
    const institution = FAKE_INSTITUTIONS.find((i) => i.id === institutionId);
    const owner = clientUserId.replace(/-/g, '').toLowerCase();
    if (!institution || !/^[0-9a-f]{32}$/.test(owner)) return null;
    const nonce = toHex(globalThis.crypto.getRandomValues(new Uint8Array(6)));
    return { itemId: `fake_${institution.id}_${owner}_${nonce}` };
  }

  /** Tests: simulate a consent problem, or a transaction whose amount changed at the bank. */
  setItemStatus(itemId: string, status: BankConnectionStatus) {
    this.statuses.set(itemId, status);
  }

  adjustTransaction(transactionId: string, amount: number) {
    this.amounts.set(transactionId, amount);
  }

  private parse(itemId: string) {
    const m = ITEM_RE.exec(itemId);
    if (!m || this.deleted.has(itemId)) return null;
    const institution = FAKE_INSTITUTIONS.find((i) => i.id === m[1]);
    if (!institution) return null;
    const hex = m[2]!;
    const clientUserId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return { institution, clientUserId };
  }

  private account(accountId: string) {
    const sep = accountId.lastIndexOf(':');
    const item = this.parse(accountId.slice(0, sep));
    const kind = accountId.slice(sep + 1);
    return item && (kind === 'checking' || kind === 'card') ? { ...item, kind } : null;
  }

  async createConnectToken(req: ConnectTokenRequest) {
    void req;
    const token = toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    return { accessToken: `fake-connect-${token}`, expiresAt: new Date(Date.now() + 30 * 60_000) };
  }

  async getItem(itemId: string): Promise<ProviderItem | null> {
    const item = this.parse(itemId);
    if (!item) return null;
    return {
      id: itemId,
      clientUserId: item.clientUserId,
      status: this.statuses.get(itemId) ?? 'active',
      connector: { name: item.institution.name, imageUrl: null, isOpenFinance: true, isSandbox: true },
      consentExpiresAt: new Date(`${addDays(today(), 300)}T03:00:00.000Z`),
      lastUpdatedAt: new Date(),
    };
  }

  async deleteItem(itemId: string): Promise<void> {
    this.deleted.add(itemId);
  }

  async listAccounts(itemId: string): Promise<ProviderAccount[]> {
    const item = this.parse(itemId);
    if (!item) return [];
    const r = random(itemId);
    const digits = String(10_000 + Math.floor(r() * 89_999));
    return [
      {
        id: `${itemId}:checking`,
        kind: 'bank',
        accountType: 'checking',
        name: 'Conta corrente',
        number: `0001/${digits}-${Math.floor(r() * 10)}`,
        balance: between(r, 150_000, 900_000),
        creditLimit: null,
        brand: null,
        closingDay: null,
        dueDay: null,
      },
      {
        id: `${itemId}:card`,
        kind: 'credit_card',
        accountType: null,
        name: `Cartão ${item.institution.name}`,
        number: `5502********${digits.slice(-4)}`,
        balance: between(r, 80_000, 260_000),
        creditLimit: FAKE_CARD.limit,
        brand: 'MASTERCARD',
        closingDay: FAKE_CARD.closingDay,
        dueDay: FAKE_CARD.dueDay,
      },
    ];
  }

  async listTransactions(accountId: string, range: { from: ISODate; to: ISODate }): Promise<ProviderTransaction[]> {
    const account = this.account(accountId);
    if (!account) return [];
    const now = today();
    const from = maxISO(range.from, addDays(now, -HISTORY_DAYS));
    const to = minISO(range.to, now);
    const out: ProviderTransaction[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const movements = account.kind === 'checking' ? checkingMovements(account.institution.id, date) : cardMovements(account.institution.id, date);
      movements.forEach((m, n) => {
        const id = `${accountId}:${date}:${n}`;
        const invoice = getInvoiceForPurchase(date, FAKE_CARD.closingDay, FAKE_CARD.dueDay);
        out.push({
          id,
          date,
          description: m.description,
          amount: this.amounts.get(id) ?? m.amount,
          direction: m.direction,
          // Yesterday's and today's card purchases are still being authorized.
          pending: account.kind === 'card' && m.direction === 'out' && date >= addDays(now, -1),
          // Only closed bills are known to the provider.
          billId: account.kind === 'card' && invoice.closingDate <= now ? `${accountId}:bill:${invoice.month}` : null,
        });
      });
    }
    return out;
  }

  async listBills(accountId: string): Promise<ProviderBill[]> {
    const account = this.account(accountId);
    if (!account || account.kind !== 'card') return [];
    const current = monthKey(today());
    const bills: ProviderBill[] = [];
    for (let i = -14; i <= 1; i++) {
      const month = addMonthKey(current, i);
      bills.push({ id: `${accountId}:bill:${month}`, dueDate: getInvoiceDates(month, FAKE_CARD.closingDay, FAKE_CARD.dueDay).dueDate });
    }
    return bills;
  }
}
