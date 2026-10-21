import { ImportHistoryCard } from '@/features/imports/import-history-card';
import { useOpenFinanceStatus } from '@/features/open-finance/api';
import { BankConnectionsCard } from '@/features/open-finance/connections-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Cell, TabGrid } from './layout';

/** "Integrações": read-only bank connections (when the provider is configured) and import history. */
export function IntegrationsTab() {
  const status = useOpenFinanceStatus();
  return (
    <TabGrid>
      {status.isPending ? (
        <Cell wide>
          <Skeleton className="h-48 rounded-xl" />
        </Cell>
      ) : status.enabled ? (
        <Cell wide>
          <BankConnectionsCard />
        </Cell>
      ) : null}
      <Cell wide>
        <ImportHistoryCard />
      </Cell>
    </TabGrid>
  );
}
