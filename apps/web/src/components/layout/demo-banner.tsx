import { useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { IS_DEMO } from '@/lib/demo';

/** Shown only in the demo build: data lives in this browser and can be reset to the sample set. */
export function DemoBanner() {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  if (!IS_DEMO) return null;

  async function reset() {
    setResetting(true);
    const { resetDemo } = await import('@/demo/server');
    await resetDemo();
    window.location.reload();
  }

  const action = 'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold transition-colors disabled:opacity-60';

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-[13px] text-fg">
      <FlaskConical className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="font-semibold">Ambiente de testes</span>
      <span className="text-muted">Os dados ficam salvos apenas neste navegador.</span>
      {/* Inline confirmation: native confirm() dialogs are blocked where the demo is hosted. */}
      {confirming ? (
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-muted">Apagar o que você cadastrou e voltar aos dados de exemplo?</span>
          <button type="button" onClick={reset} disabled={resetting} className={`${action} text-danger hover:bg-danger/10`}>
            {resetting ? 'Restaurando…' : 'Sim, restaurar'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={resetting} className={`${action} text-muted hover:bg-bg-subtle`}>
            Cancelar
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`ml-auto ${action} text-warning hover:bg-warning/10`}>
          <RotateCcw className="size-3.5" aria-hidden />
          Restaurar dados de demonstração
        </button>
      )}
    </div>
  );
}
