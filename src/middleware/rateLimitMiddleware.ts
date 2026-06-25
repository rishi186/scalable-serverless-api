import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { docClient } from '../lib/dynamoClient';
import { checkRateLimit, RateLimitConfig } from '../lib/rateLimiter';
import { rateLimitError } from '../lib/response';

const logger = new Logger({ serviceName: 'rate-limit-middleware' });

/**
 * Extracts the rate-limit identifier from the request.
 * Priority: x-api-key header → API Gateway API key → client IP.
 */
function getIdentifier(event: APIGatewayProxyEvent): string {
  const apiKey = event.headers?.['x-api-key'];
  if (apiKey) return `key:${apiKey}`;

  const apiKeyFromContext = event.requestContext?.identity?.apiKey;
  if (apiKeyFromContext) return `key:${apiKeyFromContext}`;

  const ip = event.requestContext?.identity?.sourceIp || 'unknown';
  return `ip:${ip}`;
}

/**
 * Higher-order function that wraps a Lambda handler with rate-limiting.
 * If the rate limit is exceeded, returns 429 immediately without calling
 * the wrapped handler.
 */
type HandlerFn = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

export function withRateLimit(
  handler: HandlerFn,
  config?: Partial<RateLimitConfig>,
): HandlerFn {
  const rateLimitConfig: RateLimitConfig = {
    capacity: config?.capacity ?? parseInt(process.env.RATE_LIMIT_CAPACITY || '20', 10),
    refillRate: config?.refillRate ?? parseInt(process.env.RATE_LIMIT_REFILL_RATE || '10', 10),
  };

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const identifier = getIdentifier(event);

    try {
      const result = await checkRateLimit(docClient, identifier, rateLimitConfig);

      if (!result.allowed) {
        logger.warn('Request rate-limited', { identifier, retryAfter: result.retryAfter });
        return rateLimitError(result.retryAfter);
      }

      const response = await handler(event);

      if (response.headers) {
        response.headers['X-RateLimit-Remaining'] = String(result.remaining);
      }

      return response;
    } catch (err) {
      logger.error('Rate limit middleware error, failing open', { error: err });
      return handler(event);
    }
  };
}
