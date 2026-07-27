/**
 * Feedback page access helpers.
 * Feedback From Users is available to all signed-in users (no identity blocklist).
 */

export function isUserHiddenFromFeedbackPage(
  _profileDisplayName?: string | undefined,
  _profileEmail?: string | undefined,
  _authSessionEmail?: string | undefined,
): boolean {
  return false
}
