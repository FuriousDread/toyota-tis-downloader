import { BrowserWindow } from "electron";
import {
  isLoginRedirectUrl,
  looksLikeSessionLost,
  SessionExpiredError,
} from "../session/session";
import { writeFileAtomic } from "../util/files";

/**
 * Reuses one hidden authenticated Chromium window to render HTML-only Toyota
 * documents as PDFs. Keeping this separate from HTTP downloads makes the
 * expensive browser fallback explicit.
 */
export class ElectronPageRenderer {
  private readonly win: BrowserWindow;

  constructor(partition: string) {
    this.win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
  }

  async goto(url: string): Promise<string> {
    await this.win.loadURL(url);
    const finalUrl = this.win.webContents.getURL();
    if (isLoginRedirectUrl(finalUrl)) throw new SessionExpiredError();

    // Some TIS endpoints return the login page with HTTP 200 at the requested
    // document URL, so the final URL alone is not a sufficient session check.
    const htmlStart = await this.win.webContents.executeJavaScript(
      "document.documentElement?.outerHTML.slice(0, 5000) || ''"
    ) as string;
    if (looksLikeSessionLost(htmlStart)) throw new SessionExpiredError();

    return finalUrl;
  }

  async remove(selector: string): Promise<void> {
    // Missing decorative elements are harmless, so removal is best-effort.
    await this.win.webContents
      .executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.remove(); undefined;`)
      .catch(() => undefined);
  }

  async savePdf(path: string): Promise<void> {
    const pdf = await this.win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.02, bottom: 0.02, left: 0.02, right: 0.02 },
    });
    await writeFileAtomic(path, pdf);
  }

  async close(): Promise<void> {
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}
