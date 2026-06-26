/**
 * Production-safe logger for Libriofy.
 *
 * - In development: all log levels output to console.
 * - In production: only warn/error output; debug/info are no-ops.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.debug("[scan]", "QR detected:", value);
 *   logger.info("[auth]", "Login redirect resolved");
 *   logger.warn("[redis]", "Connection failed, retrying...");
 *   logger.error("[critical]", "Unhandled exception", error);
 */

const isDev =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.DEV
    : typeof process !== "undefined" && process.env
      ? process.env.NODE_ENV !== "production" && process.env.APP_ENV !== "production"
      : false;

const noop = (..._args: unknown[]) => {};

export const logger = {
  /** Verbose debug output — stripped in production builds. */
  debug: isDev ? console.log.bind(console) : noop,

  /** Informational messages — stripped in production builds. */
  info: isDev ? console.info.bind(console) : noop,

  /** Warnings — always output. */
  warn: console.warn.bind(console),

  /** Errors — always output. */
  error: console.error.bind(console),
} as const;

export type Logger = typeof logger;
