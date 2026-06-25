import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'error-handler' });

type HandlerFn = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

export interface AppError {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * Wraps a handler with a catch-all error boundary.
 * Ensures no unhandled exceptions leak stack traces to clients.
 * Logs the full error with correlation context for debugging.
 */
export function withErrorHandler(handler: HandlerFn): HandlerFn {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      return await handler(event);
    } catch (err) {
      const correlationId = event.headers?.['x-correlation-id'] || 'unknown';

      // Check if it's a known AppError
      if (err && typeof err === 'object' && 'statusCode' in err) {
        const appError = err as AppError;
        logger.error('Handled application error', {
          correlationId,
          statusCode: appError.statusCode,
          code: appError.code,
          message: appError.message,
        });

        return {
          statusCode: appError.statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Correlation-Id': correlationId,
          },
          body: JSON.stringify({
            error: appError.message,
            code: appError.code || 'APP_ERROR',
            ...(appError.details ? { details: appError.details } : {}),
          }),
        };
      }

      // Unknown error — never leak internals
      logger.error('Unhandled error in handler', {
        correlationId,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });

      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      };
    }
  };
}

/**
 * Helper to create typed application errors.
 */
export function createAppError(statusCode: number, message: string, code?: string, details?: unknown): AppError {
  return { statusCode, message, code, details };
}
