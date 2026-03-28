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
let CURRENT_LEVEL = LOG_LEVELS.WATCH;

function log(levelName, levelValue, source, message, details, options = {}) {
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
  const header = `[${timestamp}] [${levelName}] [${source}]`;

  // If multiline formatting is requested
  if (options.multiline) {
    const formatted = formatMultiline(message, {
      lineNumbers: options.lineNumbers
    });
    printStyledBlock(header, formatted);
    return;
  }

  // Normal logging
  if (details !== undefined) {
    console.log("%c" + header + " " + message, style, details);
  } else {
    console.log("%c" + header + " " + message, style);
  }
}



function formatMultiline(text, { lineNumbers = false } = {}) {
  if (!text || typeof text !== "string") return text;

  let output = text;

  if (lineNumbers) {
    output = output
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(3, " ")} | ${line}`)
      .join("\n");
  }

  return output;
}

function printStyledBlock(header, text) {
  console.log(
    `%c${header}\n${text}`,
    "white-space: pre; font-family: monospace; line-height: 1.4; color: #2c3e50; background: #ecf0f1; padding: 6px; border-radius: 4px;"
  );
}


export const logger = {
  setLevel(level) {
    CURRENT_LEVEL = level;
  },

  error(source, message, details, options) {
    log("ERROR", LOG_LEVELS.ERROR, source, message, details, options);
  },

  watch(source, message, details, options) {
    log("WATCH", LOG_LEVELS.WATCH, source, message, details, options);
    // Trigger a browser alert for WATCH logs
    if (source === "createNewID") {
      alert(`New UUID generated: ${message}`);
    }
  },

  warn(source, message, details, options) {
    log("WARN", LOG_LEVELS.WARN, source, message, details, options);
  },

  info(source, message, details, options) {
    log("INFO", LOG_LEVELS.INFO, source, message, details, options);
  },

  debug(source, message, details, options) {
    log("DEBUG", LOG_LEVELS.DEBUG, source, message, details, options);
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
