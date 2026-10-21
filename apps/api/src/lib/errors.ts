/** Domain errors converted to `{ error, message, details? }` by the central error handler. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Registro não encontrado') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'conflict', message, details);
  }
}

/** Input is well-formed but violates a business rule. */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, 'unprocessable_entity', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sessão expirada. Faça login novamente.') {
    super(401, 'unauthorized', message);
  }
}

/** Authenticated, but the role does not allow it (e.g. a viewer trying to write). */
export class ForbiddenError extends AppError {
  constructor(message = 'Você não tem permissão para esta ação') {
    super(403, 'forbidden', message);
  }
}

/** Per-account abuse limits (MFA attempts, e-mails sent), on top of the per-IP rate limit. */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') {
    super(429, 'too_many_requests', message);
  }
}

/** The workspace has no valid subscription: reads still work, writes need a plan. */
export class SubscriptionRequiredError extends AppError {
  constructor(message = 'Sua assinatura não está ativa. Assine um plano para voltar a editar.') {
    super(402, 'subscription_required', message);
  }
}

/** Unique constraints whose violation the user can cause (races, double submits) → friendly 409. */
const UNIQUE_CONFLICTS: Record<string, string> = {
  users_email_unique: 'Já existe uma conta com este e-mail',
  workspace_invites_pending_email_uq: 'Já existe um convite pendente para este e-mail',
  workspace_members_single_owner_uq: 'Este espaço já tem um proprietário',
};

/**
 * Maps integrity errors raised by Postgres (Drizzle wraps them; PGlite in the demo too) to 409:
 * unique violations (23505) from concurrent requests and foreign-key violations (23503) when a
 * referenced row was deleted meanwhile. Anything else stays an unexpected error (500).
 */
export function fromDatabaseError(error: unknown): AppError | null {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    const constraint = String(e.constraint_name ?? e.constraint ?? '');
    if (e.code === '23505') {
      return new ConflictError(
        UNIQUE_CONFLICTS[constraint] ?? 'Este registro já existe ou foi alterado ao mesmo tempo. Atualize e tente novamente.',
      );
    }
    if (e.code === '23503') {
      return new ConflictError('Um registro relacionado foi alterado ou excluído. Atualize e tente novamente.');
    }
    current = e.cause;
  }
  return null;
}
