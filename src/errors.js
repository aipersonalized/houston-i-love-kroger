export class AppError extends Error {
  constructor(code, message, status = 400, options = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryAfter = options.retryAfter;
  }
}

export function publicError(error) {
  if (error instanceof AppError) return error;
  return new AppError('internal_error', 'The search could not finish. Try again shortly.', 500);
}
