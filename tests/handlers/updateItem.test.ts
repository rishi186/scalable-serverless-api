import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../src/handlers/updateItem';

const docClientMock = mockClient(DynamoDBDocumentClient);

// Mock the rate limiter so it always allows — avoids UpdateCommand conflict
jest.mock('../../src/lib/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 15, retryAfter: 0 }),
}));

describe('updateItem handler', () => {
  beforeEach(() => {
    docClientMock.reset();
    process.env.ITEMS_TABLE = 'test-ItemsTable';
    process.env.RATE_LIMIT_TABLE = 'test-RateLimitTable';
    process.env.RATE_LIMIT_CAPACITY = '15';
    process.env.RATE_LIMIT_REFILL_RATE = '3';
  });

  afterEach(() => {
    docClientMock.reset();
  });

  it('should update an item successfully', async () => {
    const updatedItem = {
      itemId: 'abc-123',
      name: 'Updated Item',
      description: 'Original description',
      category: 'electronics',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-06-01T00:00:00Z',
    };

    docClientMock.on(UpdateCommand).resolves({ Attributes: updatedItem });

    const event = {
      httpMethod: 'PUT',
      path: '/items/abc-123',
      headers: {},
      pathParameters: { itemId: 'abc-123' },
      body: JSON.stringify({ name: 'Updated Item' }),
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.name).toBe('Updated Item');
  });

  it('should return 404 when item does not exist', async () => {
    const conditionalError = new Error('Conditional check failed');
    conditionalError.name = 'ConditionalCheckFailedException';
    docClientMock.on(UpdateCommand).rejects(conditionalError);

    const event = {
      httpMethod: 'PUT',
      path: '/items/nonexistent',
      headers: {},
      pathParameters: { itemId: 'nonexistent' },
      body: JSON.stringify({ name: 'Updated' }),
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('not found');
  });

  it('should return 400 when no fields provided for update', async () => {
    const event = {
      httpMethod: 'PUT',
      path: '/items/abc-123',
      headers: {},
      pathParameters: { itemId: 'abc-123' },
      body: JSON.stringify({}),
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('At least one field');
  });

  it('should return 400 when missing path parameter', async () => {
    const event = {
      httpMethod: 'PUT',
      path: '/items',
      headers: {},
      pathParameters: null,
      body: JSON.stringify({ name: 'Updated' }),
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(400);
  });
});
