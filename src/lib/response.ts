import { APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Correlation-Id',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export function success(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

export function error(
  statusCode: number,
  message: string,
  additionalHeaders?: Record<string, string>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...additionalHeaders },
    body: JSON.stringify({ error: message }),
  };
}

export function rateLimitError(retryAfter: number): APIGatewayProxyResult {
  return {
    statusCode: 429,
    headers: {
      ...CORS_HEADERS,
      'Retry-After': String(Math.ceil(retryAfter)),
    },
    body: JSON.stringify({
      error: 'Rate limit exceeded. Please retry after the specified delay.',
      retryAfter: Math.ceil(retryAfter),
    }),
  };
}

/**
 * Standardized error response with error code for machine-readable handling.
 */
export function structuredError(
  statusCode: number,
  message: string,
  code: string,
  additionalHeaders?: Record<string, string>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...additionalHeaders },
    body: JSON.stringify({ error: message, code }),
  };
}
