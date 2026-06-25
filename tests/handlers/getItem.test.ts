import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../src/handlers/getItem';

const docClientMock = mockClient(DynamoDBDocumentClient);

describe('getItem handler', () => {
  beforeEach(() => {
    docClientMock.reset();
    process.env.ITEMS_TABLE = 'test-ItemsTable';
    process.env.RATE_LIMIT_TABLE = 'test-RateLimitTable';
    process.env.RATE_LIMIT_CAPACITY = '30';
    process.env.RATE_LIMIT_REFILL_RATE = '10';
    docClientMock.on(UpdateCommand).resolves({
      Attributes: { tokens: 30, lastRefill: Date.now() / 1000 },
    });
  });

  afterEach(() => {
    docClientMock.reset();
  });

  it('should return an item when found', async () => {
    const mockItem = {
      itemId: 'abc-123',
      name: 'Test Item',
      description: 'A test item',
      category: 'electronics',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    docClientMock.on(GetCommand).resolves({ Item: mockItem });

    const event = {
      httpMethod: 'GET',
      path: '/items/abc-123',
      headers: {},
      pathParameters: { itemId: 'abc-123' },
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.itemId).toBe('abc-123');
    expect(body.name).toBe('Test Item');
  });

  it('should return 404 when item not found', async () => {
    docClientMock.on(GetCommand).resolves({ Item: undefined });

    const event = {
      httpMethod: 'GET',
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

  it('should return 400 when itemId path parameter is missing', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/items',
      headers: {},
      pathParameters: null,
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Missing path parameter');
  });
});
