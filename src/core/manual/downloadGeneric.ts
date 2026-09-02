import { mkdir } from "fs/promises";
import { join } from "path";
import { TIS_ORIGIN } from "../constants";
import { ElectronPageRenderer } from "../browser/electronRenderer";
import { SessionExpiredError } from "../session/session";
import type { DownloadSummary, ProgressCallback } from "../types";
import { isValidPdf, sanitizeName } from "../util/files";
import type { ParsedToC } from "./parseToc";

function countLeaves(toc: ParsedToC): number {
  let total = 0;
  for (const value of Object.values(toc)) total += typeof value === "string" ? 1 : countLeaves(value);
  return total;
}

export async function downloadHtmlManual(
  renderer: ElectronPageRenderer,
  toc: ParsedToC,
  output: string,
  progress?: ProgressCallback
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, failed: 0 };
  const total = countLeaves(toc);
  const state = { current: 0 };

  async function recurse(path: string, branch: ParsedToC): Promise<void> {
    // Directory branches mirror the table-of-contents hierarchy on disk.
    for (const [name, value] of Object.entries(branch)) {
      if (typeof value !== "string") {
        const child = join(path, sanitizeName(name));
        await mkdir(child, { recursive: true });
        await recurse(child, value);
        continue;
      }

      state.current++;
      const destination = `${join(path, sanitizeName(name))}.pdf`;
      if (isValidPdf(destination)) {
        summary.skipped++;
        progress?.({ phase: "manual", message: `Skipping existing ${name}`, current: state.current, total, file: destination });
        continue;
      }

      progress?.({ phase: "manual", message: `Downloading ${name}`, current: state.current, total, file: destination });
      try {
        // URL() handles both /absolute and relative hrefs; string concatenation
        // produced invalid URLs when a TOC value did not start with '/'.
        const url = new URL(value, `${TIS_ORIGIN}/`).toString();
        await renderer.goto(url);
        await renderer.remove(".footer");
        await renderer.savePdf(destination);
        if (!isValidPdf(destination)) throw new Error("Rendered file is not a valid PDF.");
        summary.downloaded++;
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        summary.failed++;
        progress?.({ phase: "error", message: `Failed ${name}: ${String(error)}`, current: state.current, total, file: destination });
      }
    }
  }

  await recurse(output, toc);
  return summary;
}
