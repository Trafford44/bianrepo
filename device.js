// device.js

logger.debug("device","device.js loaded from:", import.meta.url);

let deviceId = localStorage.getItem("deviceId");
if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("deviceId", deviceId);
}

export { deviceId };
