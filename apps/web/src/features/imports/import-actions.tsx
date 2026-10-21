import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ImportTarget } from '@effinance/shared';
import { usePermissions } from '@/features/auth/permissions';

// The wizard (file decoding, mapping, review table) is its own chunk, loaded on first use.
const ImportWizard = lazy(() => import('./import-wizard'));

export interface OpenImportOptions {
  /** Destination preselected from where the user came (statement account, card invoice). */
  target?: ImportTarget;
}

interface ImportActions {
  openImport: (options?: OpenImportOptions) => void;
}

const Ctx = createContext<ImportActions | null>(null);

interface WizardState {
  open: boolean;
  /** New key per opening: every import starts from a clean wizard. */
  key: number;
  options: OpenImportOptions;
}

export function ImportActionsProvider({ children }: { children: ReactNode }) {
  const { readOnlyReason } = usePermissions();
  const [state, setState] = useState<WizardState>({ open: false, key: 0, options: {} });
  const [used, setUsed] = useState(false);

  const openImport = useCallback(
    (options: OpenImportOptions = {}) => {
      if (readOnlyReason) {
        toast.info(readOnlyReason, { id: 'read-only' });
        return;
      }
      setUsed(true);
      setState((s) => ({ open: true, key: s.key + 1, options }));
    },
    [readOnlyReason],
  );

  const value = useMemo(() => ({ openImport }), [openImport]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {used ? (
        <Suspense fallback={null}>
          <ImportWizard
            key={state.key}
            open={state.open}
            initialTarget={state.options.target}
            onOpenChange={(open) => setState((s) => ({ ...s, open }))}
          />
        </Suspense>
      ) : null}
    </Ctx.Provider>
  );
}

export function useImportActions(): ImportActions {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useImportActions must be used inside ImportActionsProvider');
  return ctx;
}
