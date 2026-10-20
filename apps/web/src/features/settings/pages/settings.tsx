import { useSearchParams } from 'react-router';
import { CreditCard, ShieldCheck, ShieldEllipsis, UserRound, Users } from 'lucide-react';
import { WORKSPACE_KIND_LABELS } from '@effinance/shared';
import { PageHeader } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useAuth } from '@/features/auth/auth-context';
import { ProfileTab } from '../tabs/profile-tab';
import { SecurityTab } from '../tabs/security-tab';
import { MembersTab } from '../tabs/members-tab';
import { SubscriptionTab } from '../tabs/subscription-tab';
import { PrivacyTab } from '../tabs/privacy-tab';

const TABS = ['perfil', 'seguranca', 'membros', 'assinatura', 'privacidade'] as const;
type Tab = (typeof TABS)[number];

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
          workspace ? (
            <>
              Conta, segurança e o espaço <span className="font-semibold text-fg">{workspace.name}</span> ({WORKSPACE_KIND_LABELS[workspace.kind]}).
            </>
          ) : (
            'Conta, segurança e assinatura.'
          )
        }
      />
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <SegmentedControl
          variant="solid"
          ariaLabel="Seções das configurações"
          value={tab}
          onChange={select}
          options={[
            { value: 'perfil', label: 'Perfil', icon: <UserRound /> },
            { value: 'seguranca', label: 'Segurança', icon: <ShieldCheck /> },
            { value: 'membros', label: 'Membros', icon: <Users /> },
            { value: 'assinatura', label: 'Assinatura', icon: <CreditCard /> },
            { value: 'privacidade', label: 'Privacidade', icon: <ShieldEllipsis /> },
          ]}
        />
      </div>
      {tab === 'perfil' ? <ProfileTab /> : null}
      {tab === 'seguranca' ? <SecurityTab /> : null}
      {tab === 'membros' ? <MembersTab /> : null}
      {tab === 'assinatura' ? <SubscriptionTab /> : null}
      {tab === 'privacidade' ? <PrivacyTab /> : null}
    </div>
  );
}
