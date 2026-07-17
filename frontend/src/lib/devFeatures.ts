/**
 * Dev-only feature gates. Never true in production builds (`import.meta.env.PROD`).
 */

/** Weekly/monthly off-price analytics from daily runs. */
export function isDevAnalyticsEnabled(): boolean {
  return Boolean(import.meta.env.DEV)
}
