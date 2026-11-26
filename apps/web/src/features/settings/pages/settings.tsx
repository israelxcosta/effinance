import { lazy, Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { CreditCard, DatabaseBackup, Plug, ShieldCheck, ShieldEllipsis, UserRound, Users } from 'lucide-react';
import { WORKSPACE_KIND_LABELS } from '@effinance/shared';
import { PageHeader } from '@/components/ui/misc';
import { ResponsiveSegmentedControl } from '@/components/ui/segmented-control';
import { useAuth } from '@/features/auth/auth-context';
import { ProfileTab } from '../tabs/profile-tab';
import { SecurityTab } from '../tabs/security-tab';
import { MembersTab } from '../tabs/members-tab';
import { SubscriptionTab } from '../tabs/subscription-tab';
import { PrivacyTab } from '../tabs/privacy-tab';
import { IntegrationsTab } from '../tabs/integrations-tab';
import { IS_DESKTOP } from '@/lib/demo';

// The backup screens pull in the in-browser database: the inlined env check drops them from other builds.
const BackupSettings =
  import.meta.env.VITE_DESKTOP === 'true' ? lazy(() => import('@/desktop/backup-panel').then((m) => ({ default: m.BackupSettings }))) : () => null;

const ALL_TABS = ['perfil', 'seguranca', 'membros', 'assinatura', 'backup', 'integracoes', 'privacidade'] as const;
type Tab = (typeof ALL_TABS)[number];
// The desktop app has no subscription; it has local backups instead.
// Nor members: it is one person's app, with no shared workspaces.
const TABS: readonly Tab[] = ALL_TABS.filter((t) => (IS_DESKTOP ? t !== 'assinatura' && t !== 'membros' : t !== 'backup'));

export default function SettingsPage() {
  const { workspace } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('aba');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'perfil';

  function select(next: Tab) {
    // Tab-specific params (e.g. ?simular= from the fake checkout) don't carry over.
    setParams(next === 'perfil' ? {} : { aba: next }, { replace: true });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Conta"
        title="Configurações"
        description={
          IS_DESKTOP ? (
            'Perfil, segurança, backup e privacidade.'
          ) : workspace ? (
            <>
              Conta, segurança e o espaço <span className="font-semibold text-fg">{workspace.name}</span> ({WORKSPACE_KIND_LABELS[workspace.kind]}).
            </>
          ) : (
            'Conta, segurança e assinatura.'
          )
        }
      />
      {/* Narrow screens get a select instead of a scrolling tab bar. */}
      <div>
        <ResponsiveSegmentedControl
          variant="solid"
          ariaLabel="Seções das configurações"
          value={tab}
          onChange={select}
          options={[
            { value: 'perfil', label: 'Perfil', icon: <UserRound /> },
            { value: 'seguranca', label: 'Segurança', icon: <ShieldCheck /> },
            ...(IS_DESKTOP ? [] : [{ value: 'membros' as const, label: 'Membros', icon: <Users /> }]),
            ...(IS_DESKTOP
              ? [{ value: 'backup' as const, label: 'Backup', icon: <DatabaseBackup /> }]
              : [{ value: 'assinatura' as const, label: 'Assinatura', icon: <CreditCard /> }]),
            { value: 'integracoes', label: 'Integrações', icon: <Plug /> },
            { value: 'privacidade', label: 'Privacidade', icon: <ShieldEllipsis /> },
          ]}
        />
      </div>
      {tab === 'perfil' ? <ProfileTab /> : null}
      {tab === 'seguranca' ? <SecurityTab /> : null}
      {tab === 'membros' && !IS_DESKTOP ? <MembersTab /> : null}
      {tab === 'assinatura' ? <SubscriptionTab /> : null}
      {tab === 'backup' ? (
        <Suspense fallback={null}>
          <BackupSettings />
        </Suspense>
      ) : null}
      {tab === 'integracoes' ? <IntegrationsTab /> : null}
      {tab === 'privacidade' ? <PrivacyTab /> : null}
    </div>
  );
}
