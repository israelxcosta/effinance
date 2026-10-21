// Description heuristics shared by file imports and Open Finance syncs: normalization for matching,
// card bill payments, installment hints and the payment method. Pure functions (browser demo too).

import type { PaymentMethod } from '@effinance/shared';

/** Lowercase, no accents, letters and spaces only ("UBER *TRIP 1234" → "uber trip"). */
export function normalizeDescription(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Words that say how money moved, not with whom: ignored when matching by prefix. */
const GENERIC = new Set([
  'a', 'o', 'e', 'em', 'no', 'na', 'de', 'do', 'da', 'dos', 'das', 'com', 'para', 'por', 'via',
  'compra', 'compras', 'debito', 'credito', 'deb', 'cred', 'pix', 'ted', 'doc', 'tef', 'transf',
  'transferencia', 'enviado', 'enviada', 'enviou', 'recebido', 'recebida', 'recebeu', 'pag', 'pagto',
  'pgto', 'pagamento', 'cartao', 'elo', 'visa', 'master', 'mastercard', 'parc', 'parcela', 'int',
  'internacional', 'nacional', 'purchase', 'payment', 'mesma', 'titularidade', 'conta', 'aut', 'automatico',
]);

/**
 * First meaningful words of a description, for "same merchant" matching: two words, or one word of
 * 4+ letters. Null when nothing meaningful is left ("PIX ENVIADO").
 */
export function significantPrefix(normalized: string): string | null {
  const words = normalized.split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w));
  if (words.length >= 2) return `${words[0]} ${words[1]}`;
  if (words.length === 1 && words[0]!.length >= 4) return words[0]!;
  return null;
}

const BILL_PAYMENT =
  /\b(pagamento recebido|pagamento efetuado|pagamento obrigado|pagamento de fatura|pagamento da fatura|pagamento fatura|(pag|pagto|pgto|pagamento|deb|debito)( de| da| do)? (fatura|cartao)( de credito)?|fatura (do )?cartao)\b/;

/**
 * Card bill payment: on a card statement the payment credit ("Pagamento recebido"), on an account
 * statement the debit that pays the bill ("PAGTO FATURA CARTAO"). In Effinance that is a
 * `card_payment` transfer made from the invoice, not an income/expense.
 */
export function isCardBillPayment(description: string): boolean {
  return BILL_PAYMENT.test(normalizeDescription(description));
}

const EXPLICIT_INSTALLMENT = /\bparc(?:ela)?s?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i;
const TRAILING_INSTALLMENT = /\s(\d{1,2})\s?\/\s?(\d{1,2})\s*$/;

/**
 * "PARC 02/10", "Parcela 2 de 10", "Loja - Parcela 2/10"; on card statements also a trailing
 * "LOJA 02/10" (Itaú, Santander).
 */
export function installmentHint(description: string, onCard: boolean): { number: number; total: number } | null {
  const m = EXPLICIT_INSTALLMENT.exec(description) ?? (onCard ? TRAILING_INSTALLMENT.exec(description) : null);
  if (!m) return null;
  const number = Number(m[1]);
  const total = Number(m[2]);
  return number >= 1 && total >= 2 && number <= total ? { number, total } : null;
}

/** Payment method suggested by an account statement line (null when it says nothing). */
export function paymentMethodHint(description: string): PaymentMethod | null {
  const d = normalizeDescription(description);
  if (/\bpix\b/.test(d)) return 'pix';
  if (/\b(boleto|pagto titulo|pag titulo|pagamento de titulo|titulo)\b/.test(d)) return 'bank_slip';
  if (/\b(deb(ito)? aut(omatico)?|debito em conta)\b/.test(d)) return 'auto_debit';
  if (/\b(ted|doc|tef|transf|transferencia)\b/.test(d)) return 'transfer';
  if (/\b(saque|atm)\b/.test(d)) return 'cash';
  if (/\b(compra (no |com )?(cartao de )?debito|debito visa|visa electron|elo debito|maestro|cartao debito)\b/.test(d)) {
    return 'debit_card';
  }
  return null;
}

/** Statement lines that are balances, not movements (CSV exports of BB, Itaú, Inter…). */
export function isBalanceLine(description: string): boolean {
  const d = normalizeDescription(description);
  return /^(saldo( anterior| do dia| final| atual| disponivel| bloqueado| em conta)?|s a l d o|total)( |$)/.test(d) && d.length <= 40;
}

/** Description as stored: single spaces, no control characters, at most 200 characters. */
export function cleanDescription(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
