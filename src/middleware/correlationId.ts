import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'correlation-id' });

type HandlerFn = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * Extracts or generates a correlation ID for request tracing.
 * Priority: x-correlation-id header → requestContext.requestId → generated UUID.
 */
function getCorrelationId(event: APIGatewayProxyEvent): string {
  const headerId = event.headers?.['x-correlation-id'] || event.headers?.['X-Correlation-Id'];
  if (headerId) return headerId;

  const requestId = event.requestContext?.requestId;
  if (requestId) return requestId;

  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

/**
 * Middleware that attaches a correlation ID to every request.
 * - Injects the ID into the logger context for structured log tracing.
 * - Returns the ID in the response header `X-Correlation-Id`.
 * - Propagates the ID to downstream handlers via `event.headers`.
 */
export function withCorrelationId(handler: HandlerFn): HandlerFn {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const correlationId = getCorrelationId(event);

    // Inject into headers so downstream code can access it
    if (!event.headers) {
      event.headers = {};
    }
    event.headers['x-correlation-id'] = correlationId;

    logger.appendKeys({ correlationId });

    try {
      const response = await handler(event);

      if (!response.headers) {
        response.headers = {};
      }
      response.headers['X-Correlation-Id'] = correlationId;

      return response;
    } finally {
      logger.removeKeys(['correlationId']);
    }
  };
}
