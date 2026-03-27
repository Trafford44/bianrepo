// logger.js


const LOG_LEVELS = {
  NONE: 0,
  WATCH: 1,  
  ERROR: 2, 
  WARN: 3,
  INFO: 4,
  DEBUG: 5
};


// Change this per module if you want different log levels for different parts of the app
let CURRENT_LEVEL = LOG_LEVELS.DEBUG;

function log(levelName, levelValue, source, message, details) {
  if (CURRENT_LEVEL === LOG_LEVELS.NONE) return;
  if (levelValue > CURRENT_LEVEL) return;

  const timestamp = formatDateNZ();

  const colours = {
    INFO:  "color: #4da3ff",
    DEBUG: "color: #337e36",
    WARN:  "color: #e6a700",
    ERROR: "color: #ff4d4d",
    WATCH: "color: #ce13e7"
  };

  const style = colours[levelName] || "color: inherit";

  const header = `[${timestamp}] [${levelName}] [${source}] ${message}`;

  if (details !== undefined) {
    // Print header + details on the SAME line
    console.log("%c" + header, style, details);
  } else {
    console.log("%c" + header, style);
  }
}




export const logger = {
  setLevel(level) {
    CURRENT_LEVEL = level;
  },

  error(source, message, details) {
    log("ERROR", LOG_LEVELS.ERROR, source, message, details);
  },

  watch(source, message, details) {
    log("WATCH", LOG_LEVELS.WATCH, source, message, details);
    // Trigger a browser alert for WATCH logs
    // if (source === "createNewID") {
    alert(`New UUID generated: ${message}`);
    //}
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
