// logger.js

const shouldLog = true;

const LOG_LEVELS = {
  NONE: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4
};

// Change this per module if you want
let CURRENT_LEVEL = LOG_LEVELS.DEBUG;

function log(levelName, levelValue, source, message, details) {
  if (!shouldLog) return;
  if (levelValue > CURRENT_LEVEL) return;

  const timestamp = formatDateNZ();
  // use %s for non-bold, which the browser automatically applies
  if (details) {
    console.groupCollapsed(
      "%s %s %s %s",
      `[${timestamp}]`,
      `[${levelName}]`,
      `[${source}]`,
      message
    );
    console.log(details);
    console.groupEnd();
  } else {
    console.log(
      "%s %s %s %s",
      `[${timestamp}]`,
      `[${levelName}]`,
      `[${source}]`,
      message
    );
  }
}


export const logger = {
  setLevel(level) {
    CURRENT_LEVEL = level;
  },

  error(source, message, details) {
    log("ERROR", LOG_LEVELS.ERROR, source, message, details);
  },

  warn(source, message, details) {
    log("WARN", LOG_LEVELS.WARN, source, message, details);
  },

  info(source, message, details) {
    log("INFO", LOG_LEVELS.INFO, source, message, details);
  },

  debug(source, message, details) {
    log("DEBUG", LOG_LEVELS.DEBUG, source, message, details);
  }
};

export { LOG_LEVELS };

export function formatDateNZ() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);

  const get = type => parts.find(p => p.type === type).value;

  return `${get("year")}-${get("month")}-${get("day")} `
       + `${get("hour")}:${get("minute")}:${get("second")} NZ`;
}
