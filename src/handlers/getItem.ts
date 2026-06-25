import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../lib/dynamoClient';
import { success, error } from '../lib/response';
import { validatePathParam } from '../lib/validator';
import { withRateLimit } from '../middleware/rateLimitMiddleware';
import { withCorrelationId } from '../middleware/correlationId';
import { withErrorHandler } from '../middleware/errorHandler';

const logger = new Logger({ serviceName: 'get-item' });
const TABLE_NAME = process.env.ITEMS_TABLE || 'prod-ItemsTable';

export async function getItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const paramResult = validatePathParam(event, 'itemId');
  if (!paramResult.success) {
    return paramResult.response;
  }

  const { value: itemId } = paramResult;

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { itemId },
      }),
    );

    if (!result.Item) {
      return error(404, `Item with ID ${itemId} not found`);
    }

    return success(200, result.Item);
  } catch (err) {
    logger.error('Failed to get item', { itemId, error: err });
    return error(500, 'Failed to retrieve item');
  }
}

export const handler = withCorrelationId(withErrorHandler(withRateLimit(getItem, { capacity: 30, refillRate: 10 })));
