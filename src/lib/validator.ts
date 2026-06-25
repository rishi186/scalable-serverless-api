import { z } from 'zod';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { error } from './response';

export function validateBody<T>(
  event: APIGatewayProxyEvent,
  schema: z.ZodSchema<T>,
): { success: true; data: T } | { success: false; response: ReturnType<typeof error> } {
  if (!event.body) {
    return { success: false, response: error(400, 'Request body is required') };
  }

  try {
    const parsed = JSON.parse(event.body);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { success: false, response: error(400, `Validation failed: ${messages}`) };
    }
    return { success: true, data: result.data };
  } catch {
    return { success: false, response: error(400, 'Invalid JSON in request body') };
  }
}

export function validatePathParam(
  event: APIGatewayProxyEvent,
  paramName: string,
): { success: true; value: string } | { success: false; response: ReturnType<typeof error> } {
  const value = event.pathParameters?.[paramName];
  if (!value) {
    return { success: false, response: error(400, `Missing path parameter: ${paramName}`) };
  }
  return { success: true, value };
}
