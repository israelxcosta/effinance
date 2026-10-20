import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

const RULES = [
  { label: '10+ caracteres', test: (v: string) => v.length >= 10 },
  { label: 'Letras', test: (v: string) => /[A-Za-z]/.test(v) },
  { label: 'Números', test: (v: string) => /\d/.test(v) },
];

/** Live hints for new passwords (same rules as `newPasswordSchema`). */
export function PasswordChecklist({ value, id }: { value: string; id?: string }) {
  return (
    <ul id={id} className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Requisitos da senha">
      {RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.label} className={cn('inline-flex items-center gap-1.5 font-medium', ok ? 'text-success' : 'text-muted')}>
            {ok ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3" aria-hidden />}
            {r.label}
            <span className="sr-only">{ok ? '(atendido)' : '(pendente)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
