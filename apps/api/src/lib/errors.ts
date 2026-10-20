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

/** The workspace has no valid subscription: reads still work, writes need a plan. */
export class SubscriptionRequiredError extends AppError {
  constructor(message = 'Sua assinatura não está ativa. Assine um plano para voltar a editar.') {
    super(402, 'subscription_required', message);
  }
}
