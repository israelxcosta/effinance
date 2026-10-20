import { useId } from 'react';

interface GaugeProps {
  /** 0..1000 */
  score: number;
  size?: number;
}

/** Semicircular health gauge (red → amber → navy → green) with a marker. */
export function Gauge({ score, size = 200 }: GaugeProps) {
  const id = useId();
  const clamped = Math.max(0, Math.min(1000, score));
  const r = 80;
  const cx = 100;
  const cy = 95;
  const angle = Math.PI * (1 - clamped / 1000);
  const mx = cx + r * Math.cos(angle);
  const my = cy - r * Math.sin(angle);
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const length = Math.PI * r;
  const progress = (clamped / 1000) * length;
  return (
    <svg viewBox="0 0 200 110" width={size} height={size * 0.55} role="img" aria-label={`Pontuação ${Math.round(clamped)} de 1000`}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#E5484D" />
          <stop offset="35%" stopColor="#F59E0B" />
          <stop offset="65%" stopColor="#3F64BE" />
          <stop offset="100%" stopColor="#12A150" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="var(--app-bg-subtle)" strokeWidth="14" strokeLinecap="round" />
      <path
        d={arc}
        fill="none"
        stroke={`url(#${id}-g)`}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${progress} ${length}`}
        style={{ transition: 'stroke-dasharray 700ms cubic-bezier(.2,.8,.2,1)' }}
      />
      <circle cx={mx} cy={my} r="9" fill="var(--app-surface)" stroke="var(--app-fg)" strokeWidth="3" />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--app-fg)" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(clamped)}
      </text>
    </svg>
  );
}
