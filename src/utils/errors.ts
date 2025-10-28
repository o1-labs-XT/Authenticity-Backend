/**
 * REST API Error Class
 * All errors in the application should be converted to this type
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ApiError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const Errors = {
  // 400 Bad Request
  badRequest: (message: string, field?: string) => new ApiError(400, message, field),

  // 403 Forbidden
  forbidden: (message: string, field?: string) => new ApiError(403, message, field),

  // 404 Not Found
  notFound: (resource: string) => new ApiError(404, `${resource} not found`),

  // 409 Conflict
  conflict: (message: string) => new ApiError(409, message),

  // 500 Internal Server Error
  internal: (message = 'Internal server error') => new ApiError(500, message),
};
