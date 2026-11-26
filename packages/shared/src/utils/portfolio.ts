// Portfolio math: quantity, cost and average price per asset (average-cost method), sales results
// and income per asset.
// Money in integer cents; quantities may have up to 8 decimals.

import type { AssetType } from '../constants';
import type { InvestmentPosition } from '../types';

interface PurchaseLike {
  ticker: string;
  name: string | null;
  assetType: AssetType;
  date: string;
  quantity: number;
  unitPrice: number;
  fees: number;
}

/** Removes float noise from quantities (0.1 + 0.2 → 0.3). */
export function roundQuantity(q: number): number {
  return Math.round(q * 1e8) / 1e8;
}

/** What a purchase cost in cents: quantity × unit price, rounded to the cent, plus fees. */
export function purchaseTotal(quantity: number, unitPrice: number, fees = 0): number {
  return Math.round(quantity * unitPrice) + fees;
}

/** Average price in cents (fees included, as the Receita Federal and brokers do). */
export function averagePrice(totalInvested: number, quantity: number): number {
  return quantity > 0 ? Math.round(totalInvested / quantity) : 0;
}

interface SaleLike {
  ticker: string;
  quantity: number;
  /** Cost of the units sold (average price × quantity at the sale). */
  cost: number;
  result: number;
}

interface IncomeLike {
  ticker: string | null;
  amount: number;
}

/** Cost of selling `quantity` units of a position: its average cost, rounded to the cent. */
export function saleCost(position: { quantity: number; totalInvested: number }, quantity: number): number {
  if (position.quantity <= 0) return 0;
  // Selling everything takes the whole cost (no cent left behind by rounding).
  if (roundQuantity(position.quantity - quantity) <= 0) return position.totalInvested;
  return Math.round((position.totalInvested / position.quantity) * quantity);
}

/**
 * Groups purchases by ticker and takes the sales out (quantity and cost; the average price stays):
 * biggest position (total invested) first. Positions sold out are dropped.
 */
export function buildPositions(purchases: PurchaseLike[], sales: SaleLike[] = [], incomes: IncomeLike[] = []): InvestmentPosition[] {
  const byTicker = new Map<string, InvestmentPosition>();
  // Oldest first, so the name/type of the latest purchase wins.
  const sorted = [...purchases].sort((a, b) => a.date.localeCompare(b.date));
  for (const p of sorted) {
    const total = purchaseTotal(p.quantity, p.unitPrice, p.fees);
    const pos = byTicker.get(p.ticker);
    if (!pos) {
      byTicker.set(p.ticker, {
        ticker: p.ticker,
        name: p.name,
        assetType: p.assetType,
        quantity: roundQuantity(p.quantity),
        totalInvested: total,
        averagePrice: 0,
        purchases: 1,
        firstDate: p.date,
        lastDate: p.date,
        share: 0,
        realizedResult: 0,
        incomes: 0,
      });
      continue;
    }
    pos.quantity = roundQuantity(pos.quantity + p.quantity);
    pos.totalInvested += total;
    pos.purchases += 1;
    pos.lastDate = p.date;
    pos.assetType = p.assetType;
    if (p.name) pos.name = p.name;
  }
  for (const sale of sales) {
    const pos = byTicker.get(sale.ticker);
    if (!pos) continue;
    pos.quantity = roundQuantity(pos.quantity - sale.quantity);
    pos.totalInvested -= sale.cost;
    pos.realizedResult += sale.result;
  }
  for (const income of incomes) {
    const pos = income.ticker ? byTicker.get(income.ticker) : undefined;
    if (pos) pos.incomes += income.amount;
  }
  const positions = [...byTicker.values()].filter((p) => p.quantity > 0);
  const grand = positions.reduce((a, p) => a + p.totalInvested, 0);
  for (const p of positions) {
    p.averagePrice = averagePrice(p.totalInvested, p.quantity);
    p.share = grand > 0 ? p.totalInvested / grand : 0;
  }
  return positions.sort((a, b) => b.totalInvested - a.totalInvested || a.ticker.localeCompare(b.ticker));
}

/** Preview for the purchase form: the position after buying more of the same asset. */
export function positionAfterPurchase(
  current: { quantity: number; totalInvested: number } | null,
  quantity: number,
  unitPrice: number,
  fees = 0,
): { quantity: number; totalInvested: number; averagePrice: number } {
  const q = roundQuantity((current?.quantity ?? 0) + quantity);
  const total = (current?.totalInvested ?? 0) + purchaseTotal(quantity, unitPrice, fees);
  return { quantity: q, totalInvested: total, averagePrice: averagePrice(total, q) };
}
