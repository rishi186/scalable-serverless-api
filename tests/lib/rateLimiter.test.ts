import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { checkRateLimit } from '../../src/lib/rateLimiter';
import { docClient } from '../../src/lib/dynamoClient';

const docClientMock = mockClient(DynamoDBDocumentClient);

describe('Rate Limiter', () => {
  beforeEach(() => {
    docClientMock.reset();
    process.env.RATE_LIMIT_TABLE = 'test-RateLimitTable';
    process.env.RATE_LIMIT_CAPACITY = '5';
    process.env.RATE_LIMIT_REFILL_RATE = '2';
  });

  afterEach(() => {
    docClientMock.reset();
  });

  it('should allow request when tokens are available (new bucket)', async () => {
    const now = Date.now() / 1000;
    docClientMock.on(UpdateCommand).resolves({
      Attributes: { identifier: 'ip:127.0.0.1', tokens: 5, lastRefill: now, ttl: now + 3600 },
    });

    const result = await checkRateLimit(
      docClient,
      'ip:127.0.0.1',
      { capacity: 5, refillRate: 2 },
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
    expect(result.retryAfter).toBe(0);
  });

  it('should deny request when tokens are exhausted', async () => {
    const now = Date.now() / 1000;
    // Simulate a bucket with 0 tokens and recent lastRefill (no refill yet)
    docClientMock.on(UpdateCommand).resolves({
      Attributes: { identifier: 'ip:127.0.0.1', tokens: 0, lastRefill: now, ttl: now + 3600 },
    });

    const result = await checkRateLimit(
      docClient,
      'ip:127.0.0.1',
      { capacity: 5, refillRate: 2 },
    );

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('should refill tokens based on elapsed time', async () => {
    const now = Date.now() / 1000;
    // Bucket with 0 tokens but lastRefill was 3 seconds ago
    // refillRate=2 → 3*2=6 tokens refilled, capped at capacity=5
    docClientMock.on(UpdateCommand).resolves({
      Attributes: { identifier: 'ip:127.0.0.1', tokens: 0, lastRefill: now - 3, ttl: now + 3600 },
    });

    const result = await checkRateLimit(
      docClient,
      'ip:127.0.0.1',
      { capacity: 5, refillRate: 2 },
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it('should cap refilled tokens at capacity', async () => {
    const now = Date.now() / 1000;
    // Bucket with 4 tokens, lastRefill 100 seconds ago → would refill way beyond capacity
    docClientMock.on(UpdateCommand).resolves({
      Attributes: { identifier: 'ip:127.0.0.1', tokens: 4, lastRefill: now - 100, ttl: now + 3600 },
    });

    const result = await checkRateLimit(
      docClient,
      'ip:127.0.0.1',
      { capacity: 5, refillRate: 2 },
    );

    expect(result.allowed).toBe(true);
    // After capping at 5 and decrementing by 1, remaining should be 4
    expect(result.remaining).toBe(4);
  });

  it('should fail open on DynamoDB error', async () => {
    docClientMock.on(UpdateCommand).rejects(new Error('DynamoDB connection failed'));

    const result = await checkRateLimit(
      docClient,
      'ip:127.0.0.1',
      { capacity: 5, refillRate: 2 },
    );

    expect(result.allowed).toBe(true);
  });
});
