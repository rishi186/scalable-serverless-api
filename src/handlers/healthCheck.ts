import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { success } from '../lib/response';

/**
 * Health check endpoint.
 * Returns 200 with service status and timestamp.
 * Used by load balancers and monitoring to verify service availability.
 *
 * Note: This endpoint is NOT wrapped with rate limiting or auth middleware
 * so it can be called freely by health checkers.
 */
export async function healthCheck(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return success(200, {
    status: 'healthy',
    service: 'serverless-api-gateway',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || '1.0.0',
  });
}
