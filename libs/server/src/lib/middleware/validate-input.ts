/**
 * Zod input validation (D.7).
 *
 * The dispatcher resolves the tool's input schema from the registry and
 * stamps it on `ctx.scratch.input_schema`. This middleware parses and stores
 * the validated input on `ctx.scratch.input` for `executeMw`.
 */

import type { z } from 'zod';
import type { Middleware } from './chain.js';
import { ServerError } from '../../types/errors.js';

export const validateInputMw: Middleware = async (args, ctx, next) => {
  const schema = ctx.scratch['input_schema'] as z.ZodTypeAny | undefined;
  if (!schema) {
    // No registered schema (custom tool with no zod input). Pass-through.
    ctx.scratch['input'] = args;
    return next();
  }
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ServerError({
      code: 'VALIDATION_ERROR',
      message: `invalid input at ${issue?.path.join('.') ?? '<root>'}: ${issue?.message ?? 'unknown'}`,
      cause: parsed.error,
    });
  }
  ctx.scratch['input'] = parsed.data;
  return next();
};
