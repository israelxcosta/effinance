// SaaS contract: workspaces (tenants), members, plans/subscriptions (Mercado Pago), hardened auth
// (sessions, MFA, password reset) and LGPD (export / delete).
//
// Tenancy model: every financial record belongs to a WORKSPACE (the subscriber). A user can belong
// to several workspaces (their personal one plus family/business ones) with a role. Isolation is
// enforced by PostgreSQL Row Level Security on `workspace_id`, and sensitive fields are encrypted
// with a per-workspace data key (envelope encryption, AWS KMS in production).

import { z } from 'zod';
import type { User } from './types';

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

export const WORKSPACE_KINDS = ['personal', 'family', 'business'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const WORKSPACE_KIND_LABELS: Record<WorkspaceKind, string> = {
  personal: 'Pessoal',
  family: 'Família',
  business: 'Empresa',
};

export const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Proprietário',
  editor: 'Editor',
  viewer: 'Leitor',
};

export const MEMBER_ROLE_HINTS: Record<MemberRole, string> = {
  owner: 'Controle total, incluindo assinatura, membros e exclusão',
  editor: 'Cria e edita lançamentos, contas e cadastros',
  viewer: 'Apenas visualiza dados e relatórios',
};

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'pending',
  'active',
  'past_due',
  'canceled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Período de teste',
  pending: 'Aguardando pagamento',
  active: 'Ativa',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
  expired: 'Expirada',
};

/** Days of free trial for a new workspace (no card required). */
export const TRIAL_DAYS = 14;
/** Days a `past_due` subscription keeps write access while the payment is retried. */
export const GRACE_DAYS = 7;

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const PLAN_CODES = ['individual_monthly', 'individual_yearly', 'family_monthly', 'business_monthly'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface Plan {
  code: PlanCode;
  name: string;
  description: string;
  /** Price per interval in cents (BRL). */
  priceCents: number;
  interval: BillingInterval;
  maxMembers: number;
  /** Workspace kinds this plan can be used for. */
  workspaceKinds: readonly WorkspaceKind[];
  highlights: readonly string[];
}

/** Prices are placeholders — adjust before launch (they are also sent to Mercado Pago). */
export const PLANS: readonly Plan[] = [
  {
    code: 'individual_monthly',
    name: 'Individual',
    description: 'Para organizar as finanças de uma pessoa.',
    priceCents: 1990,
    interval: 'month',
    maxMembers: 1,
    workspaceKinds: ['personal'],
    highlights: ['Contas, cartões e metas ilimitados', 'Relatórios e insights', 'Criptografia dos seus dados'],
  },
  {
    code: 'individual_yearly',
    name: 'Individual anual',
    description: 'O plano Individual com 2 meses grátis.',
    priceCents: 19900,
    interval: 'year',
    maxMembers: 1,
    workspaceKinds: ['personal'],
    highlights: ['Tudo do Individual', '2 meses grátis'],
  },
  {
    code: 'family_monthly',
    name: 'Família',
    description: 'Finanças da casa compartilhadas com quem mora com você.',
    priceCents: 3490,
    interval: 'month',
    maxMembers: 5,
    workspaceKinds: ['personal', 'family'],
    highlights: ['Até 5 membros', 'Permissões por membro', 'Tudo do Individual'],
  },
  {
    code: 'business_monthly',
    name: 'Empresa',
    description: 'Contas a pagar e receber da empresa com a equipe.',
    priceCents: 7990,
    interval: 'month',
    maxMembers: 15,
    workspaceKinds: ['business'],
    highlights: ['Até 15 membros', 'Log de auditoria', 'Tudo do Família'],
  },
];

export function getPlan(code: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.code === code);
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface SubscriptionSummary {
  planCode: PlanCode | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Whether the workspace can create/edit data now (trialing, active, or past_due within grace). */
  canWrite: boolean;
}

export interface Subscription extends SubscriptionSummary {
  provider: 'mercadopago' | 'fake' | null;
  plan: Plan | null;
  memberCount: number;
  maxMembers: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** Role of the current user in this workspace. */
  role: MemberRole;
  subscription: SubscriptionSummary;
}

export interface MeUser extends User {
  mfaEnabled: boolean;
}

/** GET /auth/me — the signed-in user and the active workspace. */
export interface MeResponse {
  user: MeUser;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}

/** POST /auth/login when the account has two-factor authentication enabled. */
export interface MfaChallengeResponse {
  mfaRequired: true;
  /** Short-lived token to send with the TOTP code to /auth/mfa/verify. */
  mfaToken: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  /** IP with the last octet masked (e.g. 189.6.12.x). */
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface MfaSetupResponse {
  /** Base32 secret (show for manual entry). */
  secret: string;
  /** otpauth:// URL to render as a QR code. */
  otpauthUrl: string;
}

export interface MfaEnableResponse {
  /** One-time recovery codes, shown once. */
  recoveryCodes: string[];
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
  isYou: boolean;
}

export interface Invite {
  id: string;
  email: string;
  role: Exclude<MemberRole, 'owner'>;
  createdAt: string;
  expiresAt: string;
  /** Present in development / when e-mail delivery is disabled, so the link can be shared manually. */
  inviteUrl?: string;
}

export interface InvitePreview {
  workspaceName: string;
  workspaceKind: WorkspaceKind;
  invitedBy: string;
  email: string;
  role: Exclude<MemberRole, 'owner'>;
  expired: boolean;
}

export interface CheckoutResponse {
  /** Mercado Pago checkout (init_point) — redirect the browser here. */
  checkoutUrl: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  userName: string | null;
  ip: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** New passwords: 10+ chars with letters and numbers. */
export const newPasswordSchema = z
  .string()
  .min(10, { message: 'A senha deve ter ao menos 10 caracteres' })
  .max(128, { message: 'Senha muito longa' })
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'Use letras e números' });

const totpCode = z
  .string()
  .trim()
  .regex(/^(\d{6}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4})$/, { message: 'Código inválido' });

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(10),
  /** 6-digit TOTP code or a recovery code (xxxx-xxxx). */
  code: totpCode,
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaCodeSchema = z.object({
  code: totpCode,
  /**
   * Current password. Enabling 2FA requires it unless the session logged in a few minutes ago
   * (re-authentication before adding a factor); ignored by /mfa/disable, which checks the code.
   */
  password: z.string().min(1).max(1024).optional(),
});
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'Informe a senha atual' }),
  newPassword: newPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email({ message: 'E-mail inválido' }).trim().toLowerCase(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: newPasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().min(1, { message: 'Informe sua senha' }),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const switchWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
});

export const workspaceInputSchema = z.object({
  name: z.string().trim().min(1, { message: 'Informe o nome' }).max(60),
  kind: z.enum(['family', 'business']),
});
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1, { message: 'Informe o nome' }).max(60),
});

export const deleteWorkspaceSchema = z.object({
  /** Must match the workspace name (typed confirmation). */
  confirmName: z.string().trim().min(1),
});

export const inviteInputSchema = z.object({
  email: z.email({ message: 'E-mail inválido' }).trim().toLowerCase(),
  role: z.enum(['editor', 'viewer']),
});
export type InviteInput = z.infer<typeof inviteInputSchema>;

export const memberRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});

export const checkoutSchema = z.object({
  planCode: z.enum(PLAN_CODES),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
