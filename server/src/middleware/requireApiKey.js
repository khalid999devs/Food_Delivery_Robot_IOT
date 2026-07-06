const { apiKey } = require("../config");

function requireApiKey(req, res, next) {
  if (!apiKey) {
    return next();
  }

  if (req.header("x-api-key") !== apiKey) {
    return res.status(401).json({
      success: false,
      message: "Invalid or missing API key"
    });
  }

  return next();
}

module.exports = requireApiKey;
