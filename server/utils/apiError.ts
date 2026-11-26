import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Standard API error class for consistent error responses
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Common API error types for consistent error handling
 */
export const ApiErrors = {
  unauthorized: (message = 'Unauthorized') => 
    new ApiError(401, message, 'UNAUTHORIZED'),
  
  forbidden: (message = 'Forbidden') => 
    new ApiError(403, message, 'FORBIDDEN'),
  
  notFound: (resource = 'Resource') => 
    new ApiError(404, `${resource} not found`, 'NOT_FOUND'),
  
  badRequest: (message: string, details?: Record<string, unknown>) => 
    new ApiError(400, message, 'BAD_REQUEST', details),
  
  insufficientCredits: (required: number, available: number) =>
    new ApiError(402, `Insufficient credits. Required: ${required}, Available: ${available}`, 'INSUFFICIENT_CREDITS', {
      required,
      available
    }),
  
  internalError: (message = 'Internal server error') => 
    new ApiError(500, message, 'INTERNAL_ERROR'),
  
  serviceUnavailable: (service: string) =>
    new ApiError(503, `${service} is currently unavailable`, 'SERVICE_UNAVAILABLE', { service }),
};

/**
 * Standard error handler for Express routes
 * Converts any error into a consistent JSON response
 */
export function handleApiError(error: unknown, res: Response): Response {
  // Handle ApiError instances
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details && { details: error.details })
    });
  }
  
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: {
        issues: error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message
        }))
      }
    });
  }
  
  // Handle standard Error instances
  if (error instanceof Error) {
    console.error('[Unexpected Error]', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      error: error.message || 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
  
  // Handle unknown errors
  console.error('[Unknown Error Type]', error);
  return res.status(500).json({
    error: 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR'
  });
}

/**
 * Async route wrapper that automatically handles errors
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: any, res: Response, next?: any) => Promise<any>
) {
  return (req: any, res: Response, next: any) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      handleApiError(error, res);
    });
  };
}
