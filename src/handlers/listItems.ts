import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../lib/dynamoClient';
import { success, error } from '../lib/response';
import { withRateLimit } from '../middleware/rateLimitMiddleware';
import { withCorrelationId } from '../middleware/correlationId';
import { withErrorHandler } from '../middleware/errorHandler';

const logger = new Logger({ serviceName: 'list-items' });
const TABLE_NAME = process.env.ITEMS_TABLE || 'prod-ItemsTable';
const PAGE_SIZE = 20;

export async function listItems(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const status = event.queryStringParameters?.status;
  const category = event.queryStringParameters?.category;
  const lastEvaluatedKey = event.queryStringParameters?.lastKey
    ? JSON.parse(Buffer.from(event.queryStringParameters.lastKey, 'base64').toString())
    : undefined;

  try {
    let result;

    if (status) {
      result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'StatusIndex',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': status },
          Limit: PAGE_SIZE,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
    } else if (category) {
      result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'CategoryIndex',
          KeyConditionExpression: '#category = :category',
          ExpressionAttributeNames: { '#category': 'category' },
          ExpressionAttributeValues: { ':category': category },
          Limit: PAGE_SIZE,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
    } else {
      result = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          Limit: PAGE_SIZE,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
    }

    const items = result.Items || [];
    const nextKey = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    const response: Record<string, unknown> = {
      items,
      count: items.length,
    };

    if (nextKey) {
      response.nextKey = nextKey;
    }

    return success(200, response);
  } catch (err) {
    logger.error('Failed to list items', { error: err });
    return error(500, 'Failed to list items');
  }
}

export const handler = withCorrelationId(withErrorHandler(withRateLimit(listItems, { capacity: 30, refillRate: 10 })));
