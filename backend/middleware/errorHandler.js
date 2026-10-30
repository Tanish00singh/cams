'use strict';

/**
 * Centralized error handler — never leaks stack traces to client.
 */
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const isDev  = process.env.NODE_ENV !== 'production';

  // Log full error server-side
  console.error(`[ERROR] ${req.method} ${req.path} → ${err.message}`);
  if (isDev) console.error(err.stack);

  const payload = {
    success: false,
    message: status === 500 ? 'An internal server error occurred.' : (err.message || 'Request failed.'),
  };

  if (err.code)    payload.code    = err.code;
  if (err.details) payload.details = err.details;

  res.status(status).json(payload);
}

module.exports = errorHandler;
