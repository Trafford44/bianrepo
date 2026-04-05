// logger.js


const LOG_LEVELS = {
  NONE: 0,
  WATCH: 1,  
  ERROR: 2, 
  WARN: 3,
  INFO: 4,
  DEBUG: 5
};

let LOG_ENTRY_COUNTER = 0;

// Change this per module if you want different log levels for different parts of the app
let CURRENT_LEVEL = LOG_LEVELS.ERROR;

// use like:  logger.debug("PUML", pumlText, null, { multiline: true, lineNumbers: true });
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
  const header = `#${++LOG_ENTRY_COUNTER} [${timestamp}] [${levelName}] [${source}]`;


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

  // Normalize newlines
  const lines = text.replace(/\r\n|\r/g, "\n").split("\n");


Copy

  if (lineNumbers) {
    return lines
      .map((line, i) => `${String(i + 1).padStart(3, " ")} | ${line}`)
      .join("\n");
  }

  return lines.join("\n");
}

function printStyledBlock(header, text) {
  // Combine into one string to ensure everything stays together
  console.log("DEBUG: printStyledBlock was called"); // Temporary check
  const output = `--- ${header} ---\n${text}`;

  console.log(
    `%c${output}`,
    `
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      color: #333;
      background: #fdfdfd;
      display: block;
      white-space: pre;
      padding: 10px;
      border-left: 5px solid #ce13e7;
    `
  );
}


export const logger = {
  setLevel(level) {
    CURRENT_LEVEL = level;
  },

  error(source, message, details = null, options = {}) {
    log("ERROR", LOG_LEVELS.ERROR, source, message, details, options);
  },

  watch(source, message, details = null, options = {}) {
    log("WATCH", LOG_LEVELS.WATCH, source, message, details, options);
    // Trigger a browser alert for WATCH logs
    if (source === "createNewID" ) {
      alert(`New UUID generated: ${message}`);
    }
    if (source === "logIdAnomaly" ) {
      alert(`Add ID anomaly detected!: ${message}`);
    }  
    if (source === "mergeWorkspace:id-missing" ) {
      alert(`Missing ID detected!: ${message}`);
    }        
  },

  warn(source, message, details = null, options = {}) {
    log("WARN", LOG_LEVELS.WARN, source, message, details, options);
  },

  info(source, message, details = null, options = {}) {
    log("INFO", LOG_LEVELS.INFO, source, message, details, options);
  },

  debug(source, message, details = null, options = {}) {
    log("DEBUG", LOG_LEVELS.DEBUG, source, message, details, options);
  },

  // semantic highlight channel
  debugSyncing(source, message, details = null, options = {}) {
    // use to enable filtering of specific "Syncing" debug messages in the console. These are still logged at DEBUG level but have a special source tag.
    log("DEBUG", LOG_LEVELS.DEBUG, `${source}-SYNCING`, message, details, options);
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


export function getCallerName(currentFunctionName) {
  const stack = new Error().stack;
  if (!stack) return "unknown";

  const lines = stack.split("\n").map(l => l.trim());

  // Remove the first line ("Error")
  lines.shift();

  for (const line of lines) {
    const match = line.match(/at (\S+)/);
    const fn = match ? match[1] : null;

    if (!fn) continue;

    // Skip internal / current function
    if (fn.includes("getCallerName")) continue;
    if (fn.includes(currentFunctionName)) continue;

    return fn;
  }

  return "unknown";
}

export function saveEmergencySnapshot(reason, extra = {}) {
    const tree = getWorkspace();
    const flat = flattenWorkspace(tree);
    const metadata = loadMetadata();

    const snapshot = {
        reason,
        timestamp: new Date().toISOString(),
        tree,
        flat,
        metadata,
        ...extra
    };

    localStorage.setItem(
        `emergencySnapshot:${Date.now()}`,
        JSON.stringify(snapshot, null, 2)
    );

    return snapshot;
}


export function exportSnapshot(snapshot) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json"
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `emergency-${snapshot.reason}-${Date.now()}.json`;
    a.click();
}

