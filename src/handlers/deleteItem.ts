import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../lib/dynamoClient';
import { success, error } from '../lib/response';
import { validatePathParam } from '../lib/validator';
import { withRateLimit } from '../middleware/rateLimitMiddleware';
import { withCorrelationId } from '../middleware/correlationId';
import { withErrorHandler } from '../middleware/errorHandler';

const logger = new Logger({ serviceName: 'delete-item' });
const TABLE_NAME = process.env.ITEMS_TABLE || 'prod-ItemsTable';

export async function deleteItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const paramResult = validatePathParam(event, 'itemId');
  if (!paramResult.success) {
    return paramResult.response;
  }

  const { value: itemId } = paramResult;

  try {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { itemId },
        ConditionExpression: 'attribute_exists(itemId)',
      }),
    );

    logger.info('Item deleted', { itemId });
    return success(204, { message: 'Item deleted successfully', itemId });
  } catch (err: unknown) {
    const isConditionalCheckFailed =
      err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException';

    if (isConditionalCheckFailed) {
      return error(404, `Item with ID ${itemId} not found`);
    }

    logger.error('Failed to delete item', { itemId, error: err });
    return error(500, 'Failed to delete item');
  }
}

export const handler = withCorrelationId(withErrorHandler(withRateLimit(deleteItem, { capacity: 10, refillRate: 2 })));
