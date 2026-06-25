import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../lib/dynamoClient';
import { success, error } from '../lib/response';
import { validateBody, validatePathParam } from '../lib/validator';
import { updateItemSchema } from '../models/item';
import { withRateLimit } from '../middleware/rateLimitMiddleware';
import { withCorrelationId } from '../middleware/correlationId';
import { withErrorHandler } from '../middleware/errorHandler';

const logger = new Logger({ serviceName: 'update-item' });
const TABLE_NAME = process.env.ITEMS_TABLE || 'prod-ItemsTable';

export async function updateItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const paramResult = validatePathParam(event, 'itemId');
  if (!paramResult.success) {
    return paramResult.response;
  }

  const { value: itemId } = paramResult;

  const validation = validateBody(event, updateItemSchema);
  if (!validation.success) {
    return validation.response;
  }

  const updates = validation.data;
  const hasUpdates = Object.keys(updates).length > 0;
  if (!hasUpdates) {
    return error(400, 'At least one field must be provided for update');
  }

  const now = new Date().toISOString();
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const expressionAttributeValues: Record<string, unknown> = { ':updatedAt': now };

  for (const [key, value] of Object.entries(updates)) {
    const placeholder = `:${key}`;
    const namePlaceholder = `#${key}`;
    updateExpressions.push(`${namePlaceholder} = ${placeholder}`);
    expressionAttributeNames[namePlaceholder] = key;
    expressionAttributeValues[placeholder] = value;
  }

  updateExpressions.push('#updatedAt = :updatedAt');

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { itemId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ConditionExpression: 'attribute_exists(itemId)',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      }),
    );

    logger.info('Item updated', { itemId });
    return success(200, result.Attributes);
  } catch (err: unknown) {
    const isConditionalCheckFailed =
      err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException';

    if (isConditionalCheckFailed) {
      return error(404, `Item with ID ${itemId} not found`);
    }

    logger.error('Failed to update item', { itemId, error: err });
    return error(500, 'Failed to update item');
  }
}

export const handler = withCorrelationId(withErrorHandler(withRateLimit(updateItem, { capacity: 15, refillRate: 3 })));
