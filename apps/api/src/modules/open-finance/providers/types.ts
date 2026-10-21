// Read-only bank data aggregator (Open Finance Brasil through a licensed provider). The services only
// see these normalized shapes: money in cents, calendar dates, our connection statuses.

import type { BankConnectionStatus, ISODate, OpenFinanceProvider as ProviderName } from '@effinance/shared';

export interface ProviderConnector {
  name: string;
  /** https only (anything else is dropped). */
  imageUrl: string | null;
  isOpenFinance: boolean;
  isSandbox: boolean;
}

export interface ProviderItem {
  id: string;
  /** Set by us when creating the connect token: the workspace id. */
  clientUserId: string | null;
  status: BankConnectionStatus;
  connector: ProviderConnector;
  consentExpiresAt: Date | null;
  lastUpdatedAt: Date | null;
}

export interface ProviderAccount {
  id: string;
  kind: 'bank' | 'credit_card';
  accountType: 'checking' | 'savings' | null;
  name: string;
  /** As reported (masked before storage). */
  number: string | null;
  /** Cents: bank balance, or amount owed on the card. */
  balance: number | null;
  creditLimit: number | null;
  /** Card brand as written by the provider ("MASTERCARD"). */
  brand: string | null;
  closingDay: number | null;
  dueDay: number | null;
}

export interface ProviderTransaction {
  id: string;
  date: ISODate;
  description: string;
  /** Positive cents, in the account's currency. */
  amount: number;
  /** Money into the account (or a credit on the card) vs out of it (or a card purchase). */
  direction: 'in' | 'out';
  pending: boolean;
  /** Card transactions: the bill (invoice) they were posted to, when known. */
  billId: string | null;
}

export interface ProviderBill {
  id: string;
  dueDate: ISODate;
}

export interface ConnectTokenRequest {
  /** Our workspace id: every item created with the token carries it (checked on connection). */
  clientUserId: string;
  webhookUrl: string | null;
  /** Re-consent / update of an existing item. */
  itemId?: string | null;
}

export interface OpenFinanceProvider {
  readonly name: ProviderName;
  /** Test institutions (fake provider, aggregator sandbox): non-Open-Finance connectors accepted. */
  readonly sandbox: boolean;
  createConnectToken(request: ConnectTokenRequest): Promise<{ accessToken: string; expiresAt: Date }>;
  /** Null when the item does not exist (deleted, unknown). */
  getItem(itemId: string): Promise<ProviderItem | null>;
  /** Revokes the item and its data at the provider. An unknown item counts as deleted. */
  deleteItem(itemId: string): Promise<void>;
  listAccounts(itemId: string): Promise<ProviderAccount[]>;
  /** Posted and pending transactions dated within [from, to]. */
  listTransactions(accountId: string, range: { from: ISODate; to: ISODate }): Promise<ProviderTransaction[]>;
  /** Card bills (invoices) of a credit account. */
  listBills(accountId: string): Promise<ProviderBill[]>;
}

/** The provider answered with an error or did not answer. Messages carry no ids or secrets. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Connector images are rendered by the web: https URLs only. */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Last four digits of an account/card number ("•••• 1234"); null when there are none. */
export function maskNumber(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 2 ? `•••• ${digits.slice(-4)}` : null;
}

/** Open Finance wiring of the app (`app.platform.openFinance`); null/absent when disabled. */
export interface OpenFinanceSetup {
  provider: OpenFinanceProvider;
  /** Sent with connect tokens: `${API_PUBLIC_URL}/api/open-finance/webhooks/<provider>/<secret>` (null = no webhooks). */
  webhookUrl: string | null;
  /** Path secret of the webhook route (null = webhooks refused). */
  webhookSecret: string | null;
}
