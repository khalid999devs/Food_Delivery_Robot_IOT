const crypto = require("crypto");

function requestContext(req, res, next) {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}

module.exports = requestContext;
