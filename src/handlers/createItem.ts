import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../lib/dynamoClient';
import { success, error } from '../lib/response';
import { validateBody } from '../lib/validator';
import { createItemSchema, Item } from '../models/item';
import { withRateLimit } from '../middleware/rateLimitMiddleware';
import { withCorrelationId } from '../middleware/correlationId';
import { withErrorHandler } from '../middleware/errorHandler';

const logger = new Logger({ serviceName: 'create-item' });
const TABLE_NAME = process.env.ITEMS_TABLE || 'prod-ItemsTable';

export async function createItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const validation = validateBody(event, createItemSchema);
  if (!validation.success) {
    return validation.response;
  }

  const now = new Date().toISOString();
  const item: Item = {
    itemId: uuidv4(),
    name: validation.data.name,
    description: validation.data.description,
    category: validation.data.category,
    status: validation.data.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(itemId)',
      }),
    );

    logger.info('Item created', { itemId: item.itemId });
    return success(201, item);
  } catch (err) {
    logger.error('Failed to create item', { error: err });
    return error(500, 'Failed to create item');
  }
}

export const handler = withCorrelationId(withErrorHandler(withRateLimit(createItem, { capacity: 20, refillRate: 5 })));
