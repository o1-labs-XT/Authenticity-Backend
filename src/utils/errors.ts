export class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public field?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  validationError: (message: string, field?: string) =>
    new ApiError('VALIDATION_ERROR', 400, message, field),

  missingField: (field: string) =>
    new ApiError('MISSING_FIELD', 400, `${field} is required`, field),

  notFound: (resource: string) => new ApiError('NOT_FOUND', 404, `${resource} not found`),

  duplicateSubmission: () =>
    new ApiError('DUPLICATE_SUBMISSION', 409, 'User has already submitted for this challenge'),

  internal: (message = 'An unexpected error occurred') =>
    new ApiError('INTERNAL_ERROR', 500, message),
};
