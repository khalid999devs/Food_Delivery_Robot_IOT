const config = require("../config");
const logger = require("../logger");

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode = error.statusCode || error.status || 500;
  const isServerError = statusCode >= 500;
  const message =
    config.isProduction && isServerError ? "Internal server error" : error.message || "Request failed";

  logger.error(`[${req.requestId || "no-request-id"}] ${error.stack || error.message}`);

  res.status(statusCode).json({
    success: false,
    message,
    requestId: req.requestId
  });
}

module.exports = errorHandler;
