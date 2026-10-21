// OFX 1.x (SGML: leaf tags without closing tags) and 2.x (XML) statements: bank (STMTRS) and credit
// card (CCSTMTRS) transaction lists. A tolerant tokenizer instead of an XML parser: exports from
// Brazilian banks often break the rules (unclosed aggregates, "," decimals, stray entities).

import { getBank, type BankCode, type ISODate } from '@effinance/shared';
import { cleanDescription } from './describe';
import { parseAmount, parseOfxDate } from './values';

export interface OfxTransaction {
  date: ISODate;
  /** Signed cents as in the file (negative = money out). */
  amount: number;
  description: string;
  fitId: string | null;
  trnType: string | null;
}

export interface OfxStatement {
  kind: 'bank' | 'credit_card';
  institution: string | null;
  accountHint: string | null;
  period: { from: ISODate; to: ISODate } | null;
  transactions: OfxTransaction[];
}

/** COMPE codes of the banks in the catalog (BANKID / FID in OFX files). */
const COMPE: Record<string, BankCode> = {
  '1': 'bb',
  '33': 'santander',
  '41': 'banrisul',
  '77': 'inter',
  '104': 'caixa',
  '208': 'btg',
  '212': 'original',
  '237': 'bradesco',
  '260': 'nubank',
  '290': 'pagbank',
  '323': 'mercadopago',
  '336': 'c6',
  '341': 'itau',
  '348': 'xp',
  '380': 'picpay',
  '422': 'safra',
  '655': 'neon',
  '748': 'sicredi',
  '756': 'sicoob',
};

export function bankFromCompe(code: string | null | undefined): BankCode | null {
  const digits = String(code ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits ? (COMPE[digits] ?? null) : null;
}

export function looksLikeOfx(content: string): boolean {
  const head = content.replace(/^﻿/, '').trimStart().slice(0, 4000).toUpperCase();
  return head.startsWith('OFXHEADER') || head.includes('<OFX>') || head.includes('<?OFX');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
}

interface Token {
  close: boolean;
  name: string;
  /** Text right after the tag, up to the next tag (the value of a leaf element). */
  text: string;
}

function* tokens(body: string): Generator<Token> {
  const re = /<(\/?)([A-Za-z][A-Za-z0-9._]*)[^>]*>([^<]*)/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    yield { close: m[1] === '/', name: m[2]!.toUpperCase(), text: m[3] ?? '' };
  }
}

const OUTFLOW_TYPES = new Set(['DEBIT', 'PAYMENT', 'CHECK', 'FEE', 'SRVCHG', 'ATM', 'POS', 'CASH', 'DIRECTDEBIT', 'XFER_OUT']);

/** Throws `Error` with a pt-BR message when the content is not an OFX statement. */
export function parseOfx(content: string): OfxStatement {
  const text = content.replace(/^﻿/, '');
  const start = text.toUpperCase().indexOf('<OFX');
  if (start < 0) throw new Error('Arquivo OFX inválido (sem o bloco <OFX>)');
  const body = text.slice(start);

  let kind: OfxStatement['kind'] = 'bank';
  let org: string | null = null;
  let bankId: string | null = null;
  let acctId: string | null = null;
  let dtStart: ISODate | null = null;
  let dtEnd: ISODate | null = null;
  const out: OfxTransaction[] = [];
  let current: Record<string, string> | null = null;

  const finish = () => {
    if (!current) return;
    const tx = current;
    current = null;
    const date = parseOfxDate(tx.DTPOSTED ?? tx.DTUSER);
    if (!date) return;
    // OFX says "." but Brazilian exports also write "1.234,56" / "-50,00".
    const raw = (tx.TRNAMT ?? '').trim();
    const decimal = /,\d{1,2}$/.test(raw) ? ',' : '.';
    let amount = parseAmount(raw, decimal);
    if (amount === null) return;
    const trnType = (tx.TRNTYPE ?? '').trim().toUpperCase() || null;
    // Some banks write outflows as positive numbers and rely on TRNTYPE.
    if (amount > 0 && trnType && OUTFLOW_TYPES.has(trnType)) amount = -amount;
    const name = cleanDescription(tx.NAME ?? '');
    const memo = cleanDescription(tx.MEMO ?? '');
    let description = memo || name;
    if (name && memo && name !== memo) {
      const [a, b] = [name.toLowerCase(), memo.toLowerCase()];
      description = a.includes(b) ? name : b.includes(a) ? memo : cleanDescription(`${name} - ${memo}`);
    }
    const fitId = (tx.FITID ?? '').trim() || null;
    out.push({ date, amount, description: description || 'Lançamento sem descrição', fitId, trnType });
  };

  for (const t of tokens(body)) {
    const value = decodeEntities(t.text).trim();
    if (t.close) {
      if (t.name === 'STMTTRN' || t.name === 'BANKTRANLIST') finish();
      continue;
    }
    switch (t.name) {
      case 'CCSTMTRS':
        kind = 'credit_card';
        break;
      case 'STMTTRN':
        finish();
        current = {};
        break;
      case 'ORG':
        org ??= value || null;
        break;
      case 'BANKID':
      case 'FID':
        bankId ??= value || null;
        break;
      case 'ACCTID':
        acctId ??= value || null;
        break;
      case 'DTSTART':
        dtStart ??= parseOfxDate(value);
        break;
      case 'DTEND':
        dtEnd ??= parseOfxDate(value);
        break;
      default:
        if (current && value) (current as Record<string, string>)[t.name] = value;
    }
  }
  finish();

  const fromCompe = bankFromCompe(bankId);
  const institution = org ?? (fromCompe ? getBank(fromCompe)!.name : bankId ? `Banco ${bankId}` : null);
  const digits = (acctId ?? '').replace(/\D/g, '');
  const dates = out.map((t) => t.date).sort();
  const period =
    dtStart && dtEnd && dtStart <= dtEnd
      ? { from: dtStart, to: dtEnd }
      : dates.length
        ? { from: dates[0]!, to: dates[dates.length - 1]! }
        : null;
  return {
    kind,
    institution: institution ? cleanDescription(institution).slice(0, 80) : null,
    accountHint: digits ? digits.slice(-4) : null,
    period,
    transactions: out,
  };
}
