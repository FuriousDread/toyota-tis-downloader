import { mkdir } from "fs/promises";
import { join } from "path";
import { ElectronPageRenderer } from "../browser/electronRenderer";
import { TisHttp } from "../http/tisHttp";
import type { DownloadSummary, ManualSpec, ProgressCallback } from "../types";
import { sanitizeName } from "../util/files";
import { downloadEwd } from "../ewd/downloadEwd";
import { downloadHtmlManual } from "./downloadGeneric";
import { downloadLegacyManual, isLegacyPdfManual } from "./legacy";
import { resolveManualToc } from "./resolveToc";
import {
  copyManualAccessor,
  saveTocAndAccessor,
} from "./saveToc";

export async function downloadManual(
  http: TisHttp,
  renderer: ElectronPageRenderer,
  manual: ManualSpec,
  outputRoot: string,
  progress?: ProgressCallback
): Promise<DownloadSummary> {
  // manual.raw includes any @year suffix, keeping differently filtered runs separate.
  const output = join(outputRoot, sanitizeName(manual.raw));
  await mkdir(output, { recursive: true });

  if (manual.kind === "modern-ewd") {
    // EWDs do not have the normal toc.js structure, but keep the same accessor
    // file in the manual root for a consistent downloaded-manual layout.
    await copyManualAccessor(output);
    return downloadEwd(http, manual, output, progress);
  }

  // Generic/legacy manuals first resolve and validate the correct Toyota directory.
  const resolved = await resolveManualToc(http, manual);
  progress?.({ phase: "manual", message: `Resolved ${manual.id} to Toyota directory '${resolved.directory}'.` });
  await saveTocAndAccessor(output, resolved);

  if (await isLegacyPdfManual(http, resolved.toc)) {
    progress?.({ phase: "manual", message: `${manual.id} uses Toyota's legacy PDF-wrapper format.` });
    return downloadLegacyManual(http, resolved.toc, output, progress);
  }

  return downloadHtmlManual(renderer, resolved.toc, output, progress);
}
