// Small helpers for validating query strings and bodies without extra dependencies.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true; // safe to show to the client
  }
}

export function intParam(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

export function oneOf(value, name, allowed) {
  if (value === undefined || value === '') return undefined;
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${name} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

// Wraps an async route so thrown errors reach Express's error handler.
export const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
