import { Building2, House, UserRound, type LucideIcon } from 'lucide-react';
import type { WorkspaceKind } from '@effinance/shared';

export const WORKSPACE_KIND_ICONS: Record<WorkspaceKind, LucideIcon> = {
  personal: UserRound,
  family: House,
  business: Building2,
};
