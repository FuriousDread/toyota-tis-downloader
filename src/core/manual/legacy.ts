import { mkdir } from "fs/promises";
import { join } from "path";
import { TIS_ORIGIN } from "../constants";
import { TisHttp, withDocumentSuffix } from "../http/tisHttp";
import { SessionExpiredError } from "../session/session";
import type { DownloadSummary, ProgressCallback } from "../types";
import { isValidPdf, sanitizeName, writeFileAtomic } from "../util/files";
import type { ParsedToC } from "./parseToc";

export function extractPdfHref(html: string): string | undefined {
  // TIS wrappers have used both a rel=pdf link and a JavaScript redirect.
  const link =
    html.match(/<link[^>]+rel=["']pdf["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']pdf["']/i);
  if (link) return link[1];
  const location = html.match(/location\s*=\s*["']([^"']+\.pdf[^"']*)["']/i);
  return location?.[1];
}

function firstLeafHref(toc: ParsedToC): string | undefined {
  for (const value of Object.values(toc)) {
    if (typeof value === "string") return value;
    const nested = firstLeafHref(value);
    if (nested) return nested;
  }
  return undefined;
}

function absoluteDocumentUrl(href: string, base = `${TIS_ORIGIN}/`): string {
  if (/^t3Portal\//i.test(href)) return new URL(`/${href}`, TIS_ORIGIN).toString();
  return new URL(href, base).toString();
}

export async function isLegacyPdfManual(http: TisHttp, toc: ParsedToC): Promise<boolean> {
  // Sampling one leaf is sufficient because a manual uses one page format consistently.
  const href = firstLeafHref(toc);
  if (!href) return false;
  const html = await http.text(withDocumentSuffix(absoluteDocumentUrl(href)));
  return extractPdfHref(html) !== undefined;
}

export async function downloadLegacyDocumentPdf(
  http: TisHttp,
  wrapperHref: string,
  destination: string
): Promise<boolean> {
  // Fetch wrapper HTML first, then follow its real PDF reference.
  const wrapperUrl = withDocumentSuffix(absoluteDocumentUrl(wrapperHref));
  const html = await http.text(wrapperUrl);
  const pdfHref = extractPdfHref(html);
  if (!pdfHref) return false;

  const pdfUrl = withDocumentSuffix(absoluteDocumentUrl(pdfHref, wrapperUrl));
  const buffer = await http.buffer(pdfUrl);
  await writeFileAtomic(destination, buffer);
  return isValidPdf(destination);
}

function countLeaves(toc: ParsedToC): number {
  let total = 0;
  for (const value of Object.values(toc)) {
    total += typeof value === "string" ? 1 : countLeaves(value);
  }
  return total;
}

export async function downloadLegacyManual(
  http: TisHttp,
  toc: ParsedToC,
  output: string,
  progress?: ProgressCallback
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, failed: 0 };
  const total = countLeaves(toc);
  const state = { current: 0 };

  async function recurse(path: string, branch: ParsedToC): Promise<void> {
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
        // Resume is file-based: a valid PDF needs no separate checkpoint record.
        summary.skipped++;
        progress?.({ phase: "manual", message: `Skipping existing ${name}`, current: state.current, total, file: destination });
        continue;
      }

      progress?.({ phase: "manual", message: `Downloading ${name}`, current: state.current, total, file: destination });
      try {
        const ok = await downloadLegacyDocumentPdf(http, value, destination);
        if (ok) summary.downloaded++;
        else summary.failed++;
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
