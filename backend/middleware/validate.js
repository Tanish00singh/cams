'use strict';
const { validationResult } = require('express-validator');

/**
 * Run after express-validator chains. Returns 422 with field errors on failure.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error('Validation failed.');
    err.status  = 422;
    err.code    = 'VALIDATION_ERROR';
    err.details = errors.array().map(e => ({ field: e.path, message: e.msg }));
    return next(err);
  }
  next();
}

module.exports = validate;
