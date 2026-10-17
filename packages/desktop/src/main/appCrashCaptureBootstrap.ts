import { logger } from "./logger.js";
import { initializeCrashCapture, registerCrashEventMonitor } from "./desktopCrashCapture.js";

// Initialize local dump capture after the early data-directory bootstrap.
const crashCapturePaths = initializeCrashCapture(logger);
registerCrashEventMonitor(logger, crashCapturePaths);
