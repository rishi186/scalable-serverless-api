import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../src/handlers/createItem';

const docClientMock = mockClient(DynamoDBDocumentClient);

describe('createItem handler', () => {
  beforeEach(() => {
    docClientMock.reset();
    process.env.ITEMS_TABLE = 'test-ItemsTable';
    process.env.RATE_LIMIT_TABLE = 'test-RateLimitTable';
    process.env.RATE_LIMIT_CAPACITY = '20';
    process.env.RATE_LIMIT_REFILL_RATE = '5';
    // Rate limiter mock — always allow
    docClientMock.on(UpdateCommand).resolves({
      Attributes: { tokens: 20, lastRefill: Date.now() / 1000 },
    });
  });

  afterEach(() => {
    docClientMock.reset();
  });

  it('should create an item successfully', async () => {
    docClientMock.on(PutCommand).resolves({});

    const event = {
      httpMethod: 'POST',
      path: '/items',
      headers: {},
      body: JSON.stringify({
        name: 'Test Item',
        description: 'A test item',
        category: 'electronics',
        status: 'active',
      }),
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.name).toBe('Test Item');
    expect(body.itemId).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it('should return 400 for missing body', async () => {
    const event = {
      httpMethod: 'POST',
      path: '/items',
      headers: {},
      body: null,
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('body is required');
  });

  it('should return 400 for invalid body (missing required fields)', async () => {
    const event = {
      httpMethod: 'POST',
      path: '/items',
      headers: {},
      body: JSON.stringify({ name: 'Test' }),
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Validation failed');
  });

  it('should return 400 for invalid JSON', async () => {
    const event = {
      httpMethod: 'POST',
      path: '/items',
      headers: {},
      body: 'not-json',
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Invalid JSON');
  });
});
