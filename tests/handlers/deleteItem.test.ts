import { DynamoDBDocumentClient, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../src/handlers/deleteItem';

const docClientMock = mockClient(DynamoDBDocumentClient);

describe('deleteItem handler', () => {
  beforeEach(() => {
    docClientMock.reset();
    process.env.ITEMS_TABLE = 'test-ItemsTable';
    process.env.RATE_LIMIT_TABLE = 'test-RateLimitTable';
    process.env.RATE_LIMIT_CAPACITY = '10';
    process.env.RATE_LIMIT_REFILL_RATE = '2';
    docClientMock.on(UpdateCommand).resolves({
      Attributes: { tokens: 10, lastRefill: Date.now() / 1000 },
    });
  });

  afterEach(() => {
    docClientMock.reset();
  });

  it('should delete an item successfully', async () => {
    docClientMock.on(DeleteCommand).resolves({});

    const event = {
      httpMethod: 'DELETE',
      path: '/items/abc-123',
      headers: {},
      pathParameters: { itemId: 'abc-123' },
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(204);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('deleted');
  });

  it('should return 404 when item does not exist', async () => {
    const conditionalError = new Error('Conditional check failed');
    conditionalError.name = 'ConditionalCheckFailedException';
    docClientMock.on(DeleteCommand).rejects(conditionalError);

    const event = {
      httpMethod: 'DELETE',
      path: '/items/nonexistent',
      headers: {},
      pathParameters: { itemId: 'nonexistent' },
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('not found');
  });

  it('should return 400 when missing path parameter', async () => {
    const event = {
      httpMethod: 'DELETE',
      path: '/items',
      headers: {},
      pathParameters: null,
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(400);
  });
});
