const config = require("./config");

const levels = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

function canLog(level) {
  const activeLevel = levels[config.logLevel] ?? levels.info;
  return activeLevel >= levels[level];
}

function write(level, args) {
  if (!canLog(level)) {
    return;
  }

  console[level === "warn" ? "warn" : level === "error" ? "error" : "log"](...args);
}

module.exports = {
  debug(...args) {
    write("debug", args);
  },
  error(...args) {
    write("error", args);
  },
  info(...args) {
    write("info", args);
  },
  warn(...args) {
    write("warn", args);
  }
};
