import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../src/handlers/listItems';

const docClientMock = mockClient(DynamoDBDocumentClient);

describe('listItems handler', () => {
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

  it('should list items with scan (no filters)', async () => {
    const mockItems = [
      { itemId: '1', name: 'Item 1', status: 'active', category: 'electronics' },
      { itemId: '2', name: 'Item 2', status: 'inactive', category: 'books' },
    ];

    docClientMock.on(ScanCommand).resolves({ Items: mockItems });

    const event = {
      httpMethod: 'GET',
      path: '/items',
      headers: {},
      queryStringParameters: null,
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('should filter by status using GSI', async () => {
    const mockItems = [
      { itemId: '1', name: 'Item 1', status: 'active', category: 'electronics' },
    ];

    docClientMock.on(QueryCommand).resolves({ Items: mockItems });

    const event = {
      httpMethod: 'GET',
      path: '/items',
      headers: {},
      queryStringParameters: { status: 'active' },
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe('active');
  });

  it('should filter by category using GSI', async () => {
    const mockItems = [
      { itemId: '1', name: 'Item 1', status: 'active', category: 'electronics' },
    ];

    docClientMock.on(QueryCommand).resolves({ Items: mockItems });

    const event = {
      httpMethod: 'GET',
      path: '/items',
      headers: {},
      queryStringParameters: { category: 'electronics' },
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].category).toBe('electronics');
  });

  it('should include nextKey when pagination has more results', async () => {
    docClientMock.on(ScanCommand).resolves({
      Items: [{ itemId: '1', name: 'Item 1' }],
      LastEvaluatedKey: { itemId: '1' },
    });

    const event = {
      httpMethod: 'GET',
      path: '/items',
      headers: {},
      queryStringParameters: null,
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    } as any;

    const result = await (handler as any)(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.nextKey).toBeDefined();
  });
});
