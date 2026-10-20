import { CARD_BRAND_LABELS, formatBRL, getBank, type CreditCard } from '@effinance/shared';
import { Wifi } from 'lucide-react';
import { cn, safeColor } from '@/lib/utils';

function BrandMark({ brand }: { brand: CreditCard['brand'] }) {
  if (brand === 'mastercard') {
    return (
      <span className="flex items-center" aria-label="Mastercard">
        <span className="size-6 rounded-full bg-[#EB001B]/90" />
        <span className="-ml-2.5 size-6 rounded-full bg-[#F79E1B]/90 mix-blend-screen" />
      </span>
    );
  }
  const label = brand === 'visa' ? 'VISA' : brand === 'amex' ? 'AMEX' : CARD_BRAND_LABELS[brand];
  return <span className={cn('text-base font-extrabold tracking-wide', brand === 'visa' && 'italic')}>{label}</span>;
}

/** Credit-card shaped tile with the bank color. */
export function CardVisual({ card, className, compact }: { card: CreditCard; className?: string; compact?: boolean }) {
  const bank = getBank(card.bank);
  // Interpolated into a `background` shorthand: only a plain hex color may get there.
  const base = safeColor(card.color, safeColor(bank?.color));
  return (
    <div
      className={cn('relative flex aspect-[1.586] w-full flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-lg', compact && 'p-4', className)}
      style={{ background: `linear-gradient(135deg, ${base} 0%, color-mix(in oklab, ${base} 55%, #000) 100%)` }}
    >
      <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10" aria-hidden />
      <div className="pointer-events-none absolute -bottom-20 -left-10 size-56 rounded-full bg-white/5" aria-hidden />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-white/70 uppercase">{bank?.name ?? 'Cartão'}</p>
          <p className="mt-0.5 text-[15px] font-semibold">{card.name}</p>
        </div>
        <Wifi className="size-5 rotate-90 text-white/70" aria-hidden />
      </div>
      <div className="relative flex items-center gap-2">
        <span className="h-7 w-10 rounded-md bg-gradient-to-br from-yellow-200/90 to-yellow-500/80" aria-hidden />
      </div>
      <div className="relative flex items-end justify-between">
        <div>
          <p className="text-[10px] font-medium tracking-wider text-white/60 uppercase">Disponível</p>
          <p className="tabular text-lg font-semibold">{formatBRL(card.availableLimit)}</p>
        </div>
        <BrandMark brand={card.brand} />
      </div>
    </div>
  );
}
