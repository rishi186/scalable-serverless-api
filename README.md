# Serverless API Gateway

A production-grade serverless CRUD API built with **AWS SAM**, **TypeScript**, **DynamoDB**, and **multi-layer rate-limiting**.

## Production Features

- **Two-layer rate limiting** — API Gateway usage plans + DynamoDB token-bucket
- **Correlation IDs** — Every request gets a traceable `X-Correlation-Id` header
- **Error boundary middleware** — No unhandled exceptions leak stack traces
- **Health check endpoint** — `GET /health` for load balancer / monitoring integration
- **DynamoDB encryption at rest** — SSE-KMS on all tables
- **Point-in-time recovery** — Enabled on ItemsTable
- **CloudWatch alarms** — Error rate, latency, and API 4XX/5XX monitoring
- **Structured logging** — Powertools logger with JSON output for CloudWatch
- **CI/CD pipeline** — GitHub Actions for lint, test, build, and deploy
- **OpenAPI spec** — Full API documentation in `openapi.yaml`
- **Input validation** — Zod schemas with detailed error messages
- **CORS support** — Configured at both API Gateway and application level

## Architecture

```
                    ┌──────────────────────────────────────────────────────┐
                    │                     AWS Cloud                         │
                    │                                                      │
  Client ─────────►│  API Gateway ──── Usage Plan (100 req/min, 1000/day)  │
  Request          │       │                                              │
                   │       ├─► GET    /health ──► HealthCheckFunction ──►  │
                   │       ├─► POST   /items ──► CreateItemFunction ──►   │
                   │       ├─► GET    /items ──► ListItemsFunction  ──►   │
                   │       ├─► GET    /items/{id} ► GetItemFunction  ──►  │
                   │       ├─► PUT    /items/{id} ► UpdateItemFunction ►  │
                   │       └─► DELETE /items/{id} ► DeleteItemFunction ►  │
                   │                                              │       │
                   │              ┌──────────────────────────────┐       │
                   │              │     DynamoDB (On-Demand)      │       │
                   │              │  ┌─────────────┐ ┌─────────┐ │       │
                   │              │  │ ItemsTable  │ │RateLimit│ │       │
                   │              │  │ PK: itemId  │ │Table    │ │       │
                   │              │  │ GSI: status │ │PK: id   │ │       │
                   │              │  │ GSI: category│ │TTL: 1h  │ │       │
                   │              │  └─────────────┘ └─────────┘ │       │
                   │              └──────────────────────────────┘       │
                    └──────────────────────────────────────────────────────┘
```

## Rate Limiting (Two Layers)

1. **API Gateway Usage Plans** (coarse, per API key)
   - 100 requests/minute burst, 50 req/sec rate, 1000 requests/day quota
   - Returns `429` before reaching Lambda — no compute cost

2. **DynamoDB Token-Bucket** (fine-grained, per IP or per user)
   - Configurable per endpoint (e.g. POST: 5 req/sec, GET: 10 req/sec)
   - Atomic conditional update in DynamoDB for correctness under concurrency
   - `Retry-After` header in `429` response
   - Falls back to client IP when no API key is provided
   - Fails open on DynamoDB errors (availability over strictness)

## Tech Stack

| Component | Technology |
|---|---|
| IaC | AWS SAM (YAML) |
| Runtime | Node.js 20.x + TypeScript |
| HTTP | API Gateway (REST API) |
| Database | DynamoDB (on-demand billing) |
| Rate Limiting | API Gateway Usage Plans + DynamoDB Token-Bucket |
| Validation | Zod |
| Logging | Powertools for AWS Lambda |
| Testing | Jest + aws-sdk-client-mock |
| Linting | ESLint + Prettier |

## Prerequisites

- [Node.js 20.x](https://nodejs.org/)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- [AWS CLI](https://aws.amazon.com/cli/) (configured with credentials)
- [Docker](https://www.docker.com/) (for `sam local`)

## Quick Start

### Install Dependencies

```bash
npm install
```

### Run Tests

```bash
npm test
```

### Lint & Format

```bash
npm run lint
npm run format
```

### Local Development

Start a local dev server with an in-memory database (no Docker, Java, or AWS credentials needed):

```bash
npm run dev
```

The API will be available at `http://localhost:3000`. Data resets on restart.

For SAM Local (requires Docker + SAM CLI):
```bash
npm run sam-build
npm run sam-local
```

### Deploy to AWS

```bash
npm run deploy
```

This runs `sam build` followed by `sam deploy --guided`. On first deploy, you'll be prompted for:
- **Stack Name**: `serverless-api-gateway` (default)
- **AWS Region**: `us-east-1` (default)
- **Confirm changeset**: yes
- **Allow SAM CLI IAM role creation**: Y
- **Save arguments to configuration file**: Y

After deployment, the output will include:
- `ApiEndpoint`: The URL of your deployed API
- `ApiKeyId`: The API key ID (retrieve the value via AWS Console)

## API Endpoints

### Create Item

```bash
curl -X POST https://{api-endpoint}/prod/items \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "name": "Wireless Mouse",
    "description": "Ergonomic wireless mouse with USB-C",
    "category": "electronics",
    "status": "active"
  }'
```

**Response** (201 Created):
```json
{
  "itemId": "a1b2c3d4-...",
  "name": "Wireless Mouse",
  "description": "Ergonomic wireless mouse with USB-C",
  "category": "electronics",
  "status": "active",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Get Item

```bash
curl -X GET https://{api-endpoint}/prod/items/{itemId} \
  -H "x-api-key: YOUR_API_KEY"
```

### List Items

```bash
# List all (paginated)
curl -X GET https://{api-endpoint}/prod/items \
  -H "x-api-key: YOUR_API_KEY"

# Filter by status
curl -X GET "https://{api-endpoint}/prod/items?status=active" \
  -H "x-api-key: YOUR_API_KEY"

# Filter by category
curl -X GET "https://{api-endpoint}/prod/items?category=electronics" \
  -H "x-api-key: YOUR_API_KEY"

# Paginate using nextKey
curl -X GET "https://{api-endpoint}/prod/items?lastKey=BASE64_ENCODED_KEY" \
  -H "x-api-key: YOUR_API_KEY"
```

**Response** (200 OK):
```json
{
  "items": [...],
  "count": 20,
  "nextKey": "eyJpdGVtSWQiOiAiYWJjLTEyMyJ9"
}
```

### Update Item

```bash
curl -X PUT https://{api-endpoint}/prod/items/{itemId} \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "name": "Updated Name",
    "status": "inactive"
  }'
```

### Delete Item

```bash
curl -X DELETE https://{api-endpoint}/prod/items/{itemId} \
  -H "x-api-key: YOUR_API_KEY"
```

### Rate Limit Exceeded (429)

```json
{
  "error": "Rate limit exceeded. Please retry after the specified delay.",
  "retryAfter": 2
}
```

Headers:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 2
X-RateLimit-Remaining: 0
```

## Project Structure

```
Api/
├── template.yaml              # SAM template — all AWS resources
├── samconfig.toml             # SAM deploy config
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
├── jest.config.js
├── sam-env.json               # Local dev environment variables
├── .github/workflows/         # CI/CD pipeline
│   └── ci-cd.yml
├── src/
│   ├── handlers/              # Lambda function handlers
│   │   ├── createItem.ts
│   │   ├── getItem.ts
│   │   ├── listItems.ts
│   │   ├── updateItem.ts
│   │   ├── deleteItem.ts
│   │   ├── healthCheck.ts      # Health check endpoint
│   │   └── local-server.ts     # Express dev server (in-memory DB)
│   ├── lib/                   # Core libraries
│   │   ├── dynamoClient.ts    # DynamoDB Document Client singleton
│   │   ├── response.ts        # HTTP response helpers + CORS
│   │   ├── validator.ts       # Zod-based input validation
│   │   └── rateLimiter.ts     # Token-bucket rate limiter
│   ├── middleware/
│   │   ├── rateLimitMiddleware.ts  # Rate limiting HOC
│   │   ├── correlationId.ts       # Request tracing
│   │   └── errorHandler.ts        # Error boundary
│   └── models/
│       └── item.ts            # Item type + Zod schemas
├── tests/                     # Jest unit tests
│   ├── handlers/
│   └── lib/
├── events/                    # SAM Local test events
└── openapi.yaml               # OpenAPI 3.0 specification
```

## Configuration

Rate limit parameters can be tuned via SAM template parameters:

| Parameter | Default | Description |
|---|---|---|
| `RateLimitCapacity` | 20 | Token-bucket max burst size |
| `RateLimitRefillRate` | 10 | Tokens refilled per second |
| `StageName` | prod | API Gateway stage name |

Override during deploy:
```bash
sam deploy --parameter-overrides RateLimitCapacity=50 RateLimitRefillRate=20
```

## License

MIT
