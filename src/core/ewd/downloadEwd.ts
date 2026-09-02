import { mkdir } from "fs/promises";
import { join } from "path";
import { HttpStatusError, TisHttp } from "../http/tisHttp";
import type { DownloadSummary, ManualSpec, ProgressCallback } from "../types";
import { SessionExpiredError } from "../session/session";
import { isValidExistingFile, isValidPdf, sanitizeName, writeFileAtomic } from "../util/files";
import parseTitle from "./parseTitle";

const EWD_SECTIONS = ["system", "routing", "overall"] as const;

export async function downloadEwd(
  http: TisHttp,
  manual: ManualSpec,
  output: string,
  progress?: ProgressCallback
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, failed: 0 };
  let foundSection = false;

  for (const section of EWD_SECTIONS) {
    // Sections are independent; older publications may legitimately omit one.
    const sectionPath = join(output, section);
    const titleRemote = `ewdappu/${manual.id}/ewd/contents/${section}/title.xml`;

    let xml: string;
    try {
      xml = await http.text(titleRemote);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) continue;
      throw error;
    }

    const files = parseTitle(xml);
    foundSection = true;
    await mkdir(sectionPath, { recursive: true });
    await writeFileAtomic(join(sectionPath, "title.xml"), xml);
    await writeFileAtomic(join(sectionPath, "title.json"), JSON.stringify(files, null, 2));

    const entries = Object.entries(files);
    let current = 0;
    for (const [title, remoteName] of entries) {
      current++;
      const extension = remoteName.split(".").pop()?.toLowerCase() || "bin";
      const destination = join(sectionPath, `${sanitizeName(title)}.${extension}`);
      const valid = extension === "pdf" ? isValidPdf(destination) : isValidExistingFile(destination);
      if (valid) {
        // Resume skips PDFs with a real signature and non-PDF figures of a sane size.
        summary.skipped++;
        continue;
      }

      progress?.({
        phase: "ewd",
        message: `Downloading ${section}: ${title}`,
        current,
        total: entries.length,
        file: destination,
      });

      try {
        // Toyota stores PDFs and vector figures in different subdirectories.
        const folder = extension === "pdf" ? "pdf" : "fig";
        const remote = `ewdappu/${manual.id}/ewd/contents/${section}/${folder}/${remoteName}`;
        const buffer = await http.buffer(remote);
        await writeFileAtomic(destination, buffer);
        const downloadedIsValid = extension === "pdf"
          ? isValidPdf(destination)
          : isValidExistingFile(destination);
        if (!downloadedIsValid) {
          throw new Error(`Downloaded ${extension.toUpperCase()} file did not pass validation.`);
        }
        summary.downloaded++;
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        summary.failed++;
        progress?.({ phase: "error", message: `Failed EWD ${section}/${title}: ${String(error)}`, current, total: entries.length, file: destination });
      }
    }
  }

  if (!foundSection) throw new Error(`No EWD sections were found for ${manual.id}.`);
  return summary;
}
