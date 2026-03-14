// device.js
// device.js
import { logger } from "./logger.js";

logger.debug("device", "device.js loaded from:", import.meta.url);

let deviceId = localStorage.getItem("deviceId");
logger.debug("device", "Loaded deviceId from localStorage:", deviceId);

if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("deviceId", deviceId);
    logger.debug("device", "Generated NEW deviceId:", deviceId);
} else {
    logger.debug("device", "Using EXISTING deviceId:", deviceId);
}

export { deviceId };
