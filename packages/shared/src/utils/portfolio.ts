// Portfolio math (purchases only, for now): quantity, total paid and average price per asset.
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

/** Groups purchases by ticker: biggest position (total invested) first. */
export function buildPositions(purchases: PurchaseLike[]): InvestmentPosition[] {
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
  const positions = [...byTicker.values()];
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
