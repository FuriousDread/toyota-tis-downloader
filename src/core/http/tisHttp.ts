import type { Session } from "electron";
import { TIS_CONTENT_BASE, TIS_ORIGIN } from "../constants";
import { looksLikeSessionLost, SessionExpiredError } from "../session/session";

export class HttpStatusError extends Error {
  constructor(public readonly status: number, public readonly url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpStatusError";
  }
}

/** HTTP wrapper backed by Electron's authenticated persistent session. */
export class TisHttp {
  constructor(private readonly ses: Session) {}

  absolute(input: string): string {
    // Relative manual assets live under Toyota's external/en content root.
    if (/^https?:\/\//i.test(input)) return input;
    if (input.startsWith("/")) return `${TIS_ORIGIN}${input}`;
    return new URL(input, TIS_CONTENT_BASE).toString();
  }

  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = this.absolute(input);
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    }
    if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en-US,en;q=0.9");
    if (!headers.has("Referer")) headers.set("Referer", `${TIS_ORIGIN}/`);

    // session.fetch automatically uses the same Chromium cookie jar as login.
    const response = await this.ses.fetch(url, {
      ...init,
      credentials: "include",
      redirect: "follow",
      headers,
    });

    if (!response.ok) throw new HttpStatusError(response.status, url);
    return response;
  }

  async text(input: string, init: RequestInit = {}): Promise<string> {
    const response = await this.fetch(input, init);
    const body = await response.text();
    if (looksLikeSessionLost(body)) throw new SessionExpiredError();
    return body;
  }

  async buffer(input: string, init: RequestInit = {}): Promise<Buffer> {
    const response = await this.fetch(input, init);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const data = Buffer.from(await response.arrayBuffer());
    if (contentType.includes("text/html")) {
      const sample = data.subarray(0, 5000).toString("utf8");
      if (looksLikeSessionLost(sample)) throw new SessionExpiredError();
    }
    return data;
  }
}

export function withDocumentSuffix(url: string): string {
  // Toyota's wrapper endpoints use these flags to return the printable content.
  if (/[?&]sisuffix=/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sisuffix=ff&locale=en`;
}
