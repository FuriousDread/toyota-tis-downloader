import { join } from "path";
import { TIS_ORIGIN } from "../constants";
import { ElectronPageRenderer } from "../browser/electronRenderer";
import { TisHttp, withDocumentSuffix } from "../http/tisHttp";
import { SessionExpiredError } from "../session/session";
import { extractPdfHref } from "../manual/legacy";
import type { DownloadSummary, ProgressCallback, ToyotaDocument } from "../types";
import { isValidPdf, sanitizeName, writeFileAtomic } from "../util/files";

export function wrapperUrl(doc: ToyotaDocument): string {
  // Prefer the catalog's exact link because standalone types do not all follow
  // one stable directory convention.
  if (doc.href) {
    try {
      const viewer = new URL(doc.href, TIS_ORIGIN);
      const embeddedHref = viewer.searchParams.get("href");
      const dir = viewer.searchParams.get("dir");
      if (embeddedHref) {
        if (/^https?:\/\//i.test(embeddedHref)) return embeddedHref;
        if (embeddedHref.startsWith("/")) return new URL(embeddedHref, TIS_ORIGIN).toString();

        const relativeHref = embeddedHref.replace(/^\.\//, "");
        if (dir) {
          const directory = dir.replace(/^\/+|\/+$/g, "");
          const alreadyIncludesDirectory = relativeHref
            .toLowerCase()
            .startsWith(`${directory.toLowerCase()}/`);
          const path = alreadyIncludesDirectory
            ? relativeHref
            : `${directory}/${relativeHref}`;
          return new URL(`/t3Portal/document/${path}`, TIS_ORIGIN).toString();
        }

        return new URL(`/t3Portal/document/${relativeHref}`, TIS_ORIGIN).toString();
      }
    } catch {
      // use conventional fallback below
    }
  }

  // Conservative fallback used only when the catalog did not provide a usable href.
  return `${TIS_ORIGIN}/t3Portal/document/${doc.type}/${doc.publicationNumber}/xhtml/${doc.publicationNumber}.html`;
}

export function resolvePdfHref(href: string, wrapper: string): string {
  if (/^t3Portal\//i.test(href)) return new URL(`/${href}`, TIS_ORIGIN).toString();
  return new URL(href, wrapper).toString();
}

export async function downloadStandaloneDocument(
  http: TisHttp,
  renderer: ElectronPageRenderer,
  doc: ToyotaDocument,
  outputRoot: string,
  progress?: ProgressCallback
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, failed: 0 };
  const destination = join(
    outputRoot,
    sanitizeName(doc.type),
    `${sanitizeName(doc.publicationNumber)}.pdf`
  );

  if (isValidPdf(destination)) {
    // Existing valid output is the resume marker.
    summary.skipped++;
    return summary;
  }

  progress?.({ phase: "document", message: `Downloading ${doc.type}/${doc.publicationNumber}`, file: destination });

  try {
    const wrapper = withDocumentSuffix(wrapperUrl(doc));
    const html = await http.text(wrapper);
    const pdfHref = extractPdfHref(html);

    if (pdfHref) {
      // Most bulletins are small XHTML wrappers around a real PDF.
      const buffer = await http.buffer(withDocumentSuffix(resolvePdfHref(pdfHref, wrapper)));
      await writeFileAtomic(destination, buffer);
      if (!isValidPdf(destination)) throw new Error("Downloaded file is not a valid PDF.");
      summary.downloaded++;
      return summary;
    }

    // Fallback for a standalone document that TIS renders as HTML instead of
    // exposing through the normal XHTML->PDF wrapper.
    if (doc.href) {
      await renderer.goto(doc.href);
      await renderer.remove(".footer");
      await renderer.savePdf(destination);
      if (!isValidPdf(destination)) throw new Error("Rendered file is not a valid PDF.");
      summary.downloaded++;
      return summary;
    }

    throw new Error("No PDF link was found for this document.");
  } catch (error) {
    if (error instanceof SessionExpiredError) throw error;
    summary.failed++;
    progress?.({ phase: "error", message: `Failed ${doc.type}/${doc.publicationNumber}: ${String(error)}`, file: destination });
    return summary;
  }
}
