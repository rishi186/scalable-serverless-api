import express from 'express';
import * as dynamoClientModule from './lib/dynamoClient';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createItem } from './handlers/createItem';
import { getItem } from './handlers/getItem';
import { listItems } from './handlers/listItems';
import { updateItem } from './handlers/updateItem';
import { deleteItem } from './handlers/deleteItem';
import { healthCheck } from './handlers/healthCheck';

// ─── In-memory DynamoDB mock ──────────────────────────────────────────────
// Intercepts SDK commands so the full API works without Java/Docker/AWS

type DBRecord = Record<string, any>;
const tables: Map<string, Map<string, DBRecord>> = new Map();

function getTable(name: string): Map<string, DBRecord> {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name)!;
}

function getKey(item: DBRecord, keyName: string): string {
  return String(item[keyName]);
}

const inMemoryClient = {
  send: async (command: any): Promise<any> => {
    const input = command.input;

    // PutCommand
    if (command instanceof PutCommand) {
      const table = getTable(input.TableName);
      const key = getKey(input.Item, 'identifier' in input.Item ? 'identifier' : 'itemId');
      if (input.ConditionExpression === 'attribute_not_exists(itemId)') {
        if (table.has(key)) {
          const err = new Error('Conditional check failed');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
      }
      table.set(key, { ...input.Item });
      return {};
    }

    // GetCommand
    if (command instanceof GetCommand) {
      const table = getTable(input.TableName);
      const key = String(Object.values(input.Key)[0]);
      const item = table.get(key);
      return { Item: item || undefined };
    }

    // ScanCommand
    if (command instanceof ScanCommand) {
      const table = getTable(input.TableName);
      let items = Array.from(table.values());

      if (input.FilterExpression) {
        // Simple filter: status = :status or category = :category
        const match = input.FilterExpression?.match(/(\w+)\s*=\s*:(\w+)/);
        if (match) {
          const field = match[1];
          const valKey = match[2];
          const val = input.ExpressionAttributeValues?.[`:${valKey}`];
          items = items.filter((i) => i[field] === val);
        }
      }

      const limit = input.Limit || 20;
      const lastKey = input.ExclusiveStartKey
        ? items.findIndex((i) => getKey(i, 'itemId') === String(Object.values(input.ExclusiveStartKey)[0])) + 1
        : 0;
      const slice = items.slice(lastKey, lastKey + limit);
      const hasMore = lastKey + limit < items.length;

      return {
        Items: slice,
        Count: slice.length,
        LastEvaluatedKey: hasMore ? { itemId: getKey(slice[slice.length - 1], 'itemId') } : undefined,
      };
    }

    // QueryCommand
    if (command instanceof QueryCommand) {
      const table = getTable(input.TableName);
      let items = Array.from(table.values());

      // Parse KeyConditionExpression: #field = :value
      const match = input.KeyConditionExpression?.match(/#(\w+)\s*=\s*:(\w+)/);
      if (match) {
        const field = input.ExpressionAttributeNames?.[`#${match[1]}`] || match[1];
        const val = input.ExpressionAttributeValues?.[`:${match[2]}`];
        items = items.filter((i) => i[field] === val);
      }

      return { Items: items, Count: items.length };
    }

    // UpdateCommand
    if (command instanceof UpdateCommand) {
      const table = getTable(input.TableName);
      const key = String(Object.values(input.Key)[0]);

      if (input.ConditionExpression === 'attribute_exists(itemId)') {
        if (!table.has(key)) {
          const err = new Error('Conditional check failed');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
      }

      // For rate limiter: just return the Attributes from ExpressionAttributeValues
      if (input.TableName?.includes('RateLimit')) {
        const tokens = input.ExpressionAttributeValues?.[':tokens'];
        const lastRefill = input.ExpressionAttributeValues?.[':lastRefill'];
        if (tokens !== undefined) {
          const record = { identifier: key, tokens, lastRefill, ttl: Date.now() / 1000 + 3600 };
          table.set(key, record);
          return { Attributes: record };
        }
        // Fallback: return existing or new bucket
        const existing = table.get(key) || { identifier: key, tokens: 20, lastRefill: Date.now() / 1000, ttl: Date.now() / 1000 + 3600 };
        table.set(key, existing);
        return { Attributes: existing };
      }

      // For items: apply SET updates
      const existing = table.get(key) || {};
      const updated = { ...existing };

      if (input.UpdateExpression) {
        const setMatch = input.UpdateExpression.match(/SET\s+(.+)/);
        if (setMatch) {
          const assignments = setMatch[1].split(', ');
          for (const assignment of assignments) {
            const m = assignment.match(/#?(\w+)\s*=\s*:(\w+)/);
            if (m) {
              const field = input.ExpressionAttributeNames?.[`#${m[1]}`] || m[1];
              updated[field] = input.ExpressionAttributeValues?.[`:${m[2]}`];
            }
          }
        }
      }

      table.set(key, updated);
      return { Attributes: updated };
    }

    // DeleteCommand
    if (command instanceof DeleteCommand) {
      const table = getTable(input.TableName);
      const key = String(Object.values(input.Key)[0]);

      if (input.ConditionExpression === 'attribute_exists(itemId)') {
        if (!table.has(key)) {
          const err = new Error('Conditional check failed');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
      }

      table.delete(key);
      return {};
    }

    return {};
  },
} as unknown as DynamoDBDocumentClient;

// ─── Set up environment ───────────────────────────────────────────────────
process.env.ITEMS_TABLE = 'local-ItemsTable';
process.env.RATE_LIMIT_TABLE = 'local-RateLimitTable';
process.env.RATE_LIMIT_CAPACITY = '20';
process.env.RATE_LIMIT_REFILL_RATE = '10';
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';
process.env.AWS_REGION = 'us-east-1';

// Patch the docClient singleton used by handlers
dynamoClientModule.docClient = inMemoryClient;

// ─── Express server ───────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`  [${timestamp}] ${req.method} ${req.path}`);
  next();
});

// CORS preflight handler — use middleware to catch all OPTIONS requests
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Correlation-Id');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.status(204).end();
    return;
  }
  next();
});

function toApiGatewayEvent(
  method: string,
  path: string,
  body: unknown,
  pathParameters: Record<string, string> | null,
  queryStringParameters: Record<string, string> | null,
  headers: Record<string, string>,
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    body: body ? JSON.stringify(body) : null,
    pathParameters,
    queryStringParameters,
    headers,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      identity: {
        sourceIp: headers['x-forwarded-for'] || '127.0.0.1',
      },
    } as any,
    isBase64Encoded: false,
  } as APIGatewayProxyEvent;
}

async function runHandler(
  fn: (event: APIGatewayProxyEvent) => Promise<any>,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const event = toApiGatewayEvent(
    req.method,
    req.path,
    req.body,
    (req.params as Record<string, string>) || null,
    (req.query as Record<string, string>) || null,
    req.headers as Record<string, string>,
  );

  try {
    const result = await fn(event);
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, String(value));
      }
    }
    res.status(result.statusCode || 200);

    if (result.body) {
      res.json(JSON.parse(result.body));
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Routes
app.get('/health', (req, res) => runHandler(healthCheck, req, res));
app.post('/items', (req, res) => runHandler(createItem, req, res));
app.get('/items', (req, res) => runHandler(listItems, req, res));
app.get('/items/:itemId', (req, res) => runHandler(getItem, req, res));
app.put('/items/:itemId', (req, res) => runHandler(updateItem, req, res));
app.delete('/items/:itemId', (req, res) => runHandler(deleteItem, req, res));

app.listen(PORT, () => {
  console.log(`\n  Serverless API Gateway (local dev — in-memory DB)`);
  console.log(`  ──────────────────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\n  Endpoints:`);
  console.log(`    GET    /health          — Health check`);
  console.log(`    POST   /items           — Create item`);
  console.log(`    GET    /items           — List items (supports ?status= or ?category=)`);
  console.log(`    GET    /items/:itemId   — Get single item`);
  console.log(`    PUT    /items/:itemId   — Update item`);
  console.log(`    DELETE /items/:itemId   — Delete item`);
  console.log(`\n  Try it (PowerShell):`);
  console.log(`    Invoke-RestMethod -Uri http://localhost:${PORT}/items -Method POST -ContentType application/json -Body '{"name":"Test","description":"Desc","category":"electronics","status":"active"}'`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n  Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('  Unhandled promise rejection:', reason);
});
