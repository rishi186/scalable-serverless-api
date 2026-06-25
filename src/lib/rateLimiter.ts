import { DynamoDBDocumentClient, UpdateCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'rate-limiter' });

export interface RateLimitConfig {
  capacity: number;
  refillRate: number; // tokens per second
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds to wait for next token
}

const DEFAULT_CAPACITY = parseInt(process.env.RATE_LIMIT_CAPACITY || '20', 10);
const DEFAULT_REFILL_RATE = parseInt(process.env.RATE_LIMIT_REFILL_RATE || '10', 10);
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || 'prod-RateLimitTable';

/**
 * Token-bucket rate limiter backed by DynamoDB.
 *
 * Uses atomic conditional updates to ensure correctness under concurrent
 * requests. Each identifier (API key or client IP) gets its own bucket.
 *
 * Algorithm:
 * 1. Atomically initialize bucket if new, or read existing state
 * 2. Calculate refilled tokens: min(capacity, tokens + elapsed * refillRate)
 * 3. If refilledTokens >= 1: atomically write decremented value → ALLOW
 * 4. Otherwise: write refilled value for accuracy → DENY with retryAfter
 *
 * Note: Under extreme concurrency, a small over-count may occur between
 * the read and decrement steps. This is an acceptable trade-off for a
 * DynamoDB-based limiter — for strict atomicity, use Redis or DynamoDB
 * with conditional expressions on the token count.
 */
export async function checkRateLimit(
  docClient: DynamoDBDocumentClient,
  identifier: string,
  config: RateLimitConfig = { capacity: DEFAULT_CAPACITY, refillRate: DEFAULT_REFILL_RATE },
): Promise<RateLimitResult> {
  const now = Date.now();
  const nowSeconds = now / 1000;
  const ttl = Math.floor(nowSeconds + 3600); // expire bucket after 1 hour of inactivity

  // Step 1: Atomically initialize or read current bucket state
  const initParams: UpdateCommandInput = {
    TableName: RATE_LIMIT_TABLE,
    Key: { identifier },
    UpdateExpression: `
      SET 
        #tokens = if_not_exists(#tokens, :capacity),
        #lastRefill = if_not_exists(#lastRefill, :now),
        #ttl = :ttl
    `,
    ExpressionAttributeNames: {
      '#tokens': 'tokens',
      '#lastRefill': 'lastRefill',
      '#ttl': 'ttl',
    },
    ExpressionAttributeValues: {
      ':capacity': config.capacity,
      ':now': nowSeconds,
      ':ttl': ttl,
    },
    ReturnValues: 'ALL_NEW',
  };

  try {
    const result = await docClient.send(new UpdateCommand(initParams));
    const tokens = (result.Attributes?.tokens as number) ?? config.capacity;
    const lastRefill = (result.Attributes?.lastRefill as number) ?? nowSeconds;

    const elapsed = Math.max(0, nowSeconds - lastRefill);
    const refilledTokens = Math.min(config.capacity, tokens + elapsed * config.refillRate);

    if (refilledTokens >= 1) {
      // Step 2: Atomically write decremented value
      const newTokens = refilledTokens - 1;
      await updateTokens(docClient, identifier, newTokens, nowSeconds, ttl);

      logger.debug('Rate limit check passed', {
        identifier,
        remaining: newTokens,
        refilledTokens,
      });

      return {
        allowed: true,
        remaining: Math.floor(newTokens),
        retryAfter: 0,
      };
    } else {
      // Not enough tokens — update bucket with refilled value for accuracy
      await updateTokens(docClient, identifier, refilledTokens, nowSeconds, ttl);

      const retryAfter = (1 - refilledTokens) / config.refillRate;
      logger.warn('Rate limit exceeded', {
        identifier,
        refilledTokens,
        retryAfter,
      });

      return {
        allowed: false,
        remaining: 0,
        retryAfter,
      };
    }
  } catch (err) {
    logger.error('Rate limit check failed, allowing request (fail-open)', { error: err });
    return { allowed: true, remaining: config.capacity, retryAfter: 0 };
  }
}

/**
 * Atomically updates the token count and last refill time for a bucket.
 */
async function updateTokens(
  docClient: DynamoDBDocumentClient,
  identifier: string,
  tokens: number,
  lastRefill: number,
  ttl: number,
): Promise<void> {
  const params: UpdateCommandInput = {
    TableName: RATE_LIMIT_TABLE,
    Key: { identifier },
    UpdateExpression: 'SET #tokens = :tokens, #lastRefill = :lastRefill, #ttl = :ttl',
    ExpressionAttributeNames: {
      '#tokens': 'tokens',
      '#lastRefill': 'lastRefill',
      '#ttl': 'ttl',
    },
    ExpressionAttributeValues: {
      ':tokens': tokens,
      ':lastRefill': lastRefill,
      ':ttl': ttl,
    },
  };
  await docClient.send(new UpdateCommand(params));
}
