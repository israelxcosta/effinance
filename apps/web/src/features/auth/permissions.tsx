import { cloneElement, type ReactElement } from 'react';
import type { MemberRole } from '@effinance/shared';
import { Tooltip } from '@/components/ui/tooltip';
import { useAuth } from './auth-context';

export interface Permissions {
  role: MemberRole | null;
  isOwner: boolean;
  /** The subscription allows writes (trialing, active or past_due within the grace period). */
  subscriptionActive: boolean;
  /** The current user may create/edit/delete data in the active workspace. */
  canWrite: boolean;
  /** Why writes are blocked (shown in tooltips and toasts); null when they are allowed. */
  readOnlyReason: string | null;
}

export const VIEWER_REASON = 'Você tem acesso somente leitura neste espaço.';
export const SUBSCRIPTION_REASON = 'Assinatura inativa: o espaço está em modo somente leitura.';

/** Role + subscription state of the active workspace, from `GET /auth/me`. */
export function usePermissions(): Permissions {
  const { workspace } = useAuth();
  const role = workspace?.role ?? null;
  const subscriptionActive = workspace?.subscription.canWrite ?? false;
  const readOnlyReason = !workspace
    ? null
    : role === 'viewer'
      ? VIEWER_REASON
      : !subscriptionActive
        ? SUBSCRIPTION_REASON
        : null;
  return {
    role,
    isOwner: role === 'owner',
    subscriptionActive,
    canWrite: !!workspace && readOnlyReason === null,
    readOnlyReason,
  };
}

/**
 * Wraps a create/edit control: when the workspace is read-only the control is disabled and a
 * tooltip explains why (the wrapper stays focusable so keyboard users get the tooltip too).
 */
export function WriteGate({ children, reason }: { children: ReactElement<{ disabled?: boolean }>; reason?: string | null }) {
  const { readOnlyReason } = usePermissions();
  const blocked = reason ?? readOnlyReason;
  if (!blocked) return children;
  return (
    <Tooltip content={blocked}>
      <span tabIndex={0} className="inline-flex cursor-not-allowed rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/25">
        {cloneElement(children, { disabled: true })}
      </span>
    </Tooltip>
  );
}
