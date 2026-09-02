/** A recognizable error lets callers stop immediately instead of counting every file as failed. */
export class SessionExpiredError extends Error {
  constructor() {
    super(
      "The Toyota TIS session expired or was replaced. Log in again and rerun the download; valid files already on disk will be skipped."
    );
    this.name = "SessionExpiredError";
  }
}

export function isLoginRedirectUrl(url: string): boolean {
  // Toyota has used several identity-provider and concurrent-login routes.
  const lower = url.toLowerCase();
  return (
    lower.includes("custom-login-response") ||
    lower.includes("concurrentloginfailure") ||
    lower.includes("/openam/") ||
    lower.includes("/agent/custom-login") ||
    /\/login(?:[/?#]|$)/i.test(lower)
  );
}

export function looksLikeSessionLost(body: string): boolean {
  // Some authenticated endpoints return a login HTML page with HTTP 200, so
  // response status alone cannot establish that the session is still valid.
  const head = body.slice(0, 5000).toLowerCase();
  return (
    head.includes("concurrentloginfailure") ||
    head.includes("custom-login-response") ||
    head.includes("/openam/") ||
    head.includes("j_security_check") ||
    (head.includes("<html") && head.includes("login") && head.includes("toyota"))
  );
}
