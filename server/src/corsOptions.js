const config = require("./config");
const createHttpError = require("./httpError");

function createCorsOptions() {
  if (!config.frontendOrigins.length) {
    return undefined;
  }

  return {
    origin(origin, callback) {
      if (!origin || config.frontendOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(createHttpError(403, "CORS origin is not allowed"));
    }
  };
}

module.exports = createCorsOptions;
