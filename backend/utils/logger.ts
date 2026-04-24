type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
const minLevel = LEVEL_PRIORITY[configuredLevel] ?? LEVEL_PRIORITY.info;

function shouldLog(level: LogLevel) {
  return LEVEL_PRIORITY[level] >= minLevel;
}

export const logger = {
  debug: (...args: any[]) => shouldLog("debug") && console.debug(...args),
  info: (...args: any[]) => shouldLog("info") && console.info(...args),
  warn: (...args: any[]) => shouldLog("warn") && console.warn(...args),
  error: (...args: any[]) => shouldLog("error") && console.error(...args),
};
