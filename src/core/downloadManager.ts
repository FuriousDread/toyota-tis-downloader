import type { Session } from "electron";
import { join } from "path";
import { ElectronPageRenderer } from "./browser/electronRenderer";
import { documentToManualSpec, isManualDocument } from "./catalog/links";
import { downloadStandaloneDocument } from "./documents/downloadDocument";
import { TisHttp } from "./http/tisHttp";
import { SessionExpiredError } from "./session/session";
import { downloadManual } from "./manual/downloadManual";
import type {
  DownloadPayload,
  DownloadSummary,
  ManualSpec,
  ProgressCallback,
} from "./types";
import { sanitizeName } from "./util/files";

/** Add one worker's counters to the overall run summary. */
function merge(into: DownloadSummary, add: DownloadSummary): void {
  into.downloaded += add.downloaded;
  into.skipped += add.skipped;
  into.failed += add.failed;
}

function dedupeManuals(manuals: ManualSpec[]): ManualSpec[] {
  const map = new Map<string, ManualSpec>();
  for (const manual of manuals) {
    const key = `${manual.directory ?? "auto"}:${manual.id}:${manual.year ?? "all"}:${manual.kind}`.toLowerCase();
    map.set(key, manual);
  }
  return [...map.values()];
}

export async function runDownload(
  ses: Session,
  partition: string,
  payload: DownloadPayload,
  progress?: ProgressCallback
): Promise<DownloadSummary> {
  // One HTTP client and renderer are reused for the complete sequential run.
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, failed: 0 };
  const http = new TisHttp(ses);
  const renderer = new ElectronPageRenderer(partition);

  // Organize output by vehicle so repeated runs naturally resume in place.
  const vehicleRoot = join(
    payload.output,
    sanitizeName(payload.vehicle.division),
    sanitizeName(payload.vehicle.model),
    sanitizeName(payload.vehicle.year)
  );

  try {
    // Split catalog results into multi-page manuals and standalone documents.
    const catalogManuals = payload.documents
      .filter(isManualDocument)
      .map((doc) => documentToManualSpec(doc, Number.parseInt(payload.vehicle.year, 10)));

    const manuals = dedupeManuals([...catalogManuals, ...payload.manualSpecs]);
    const standalone = payload.documents.filter((doc) => !isManualDocument(doc));

    // Deliberately sequential: it is easier on TIS and makes progress/resume predictable.
    for (const manual of manuals) {
      progress?.({ phase: "manual", message: `Starting ${manual.id}...` });
      try {
        const result = await downloadManual(
          http,
          renderer,
          manual,
          join(vehicleRoot, "Manuals"),
          progress
        );
        merge(summary, result);
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        summary.failed++;
        progress?.({ phase: "error", message: `Manual ${manual.id} failed: ${String(error)}` });
      }
    }

    for (const doc of standalone) {
      const result = await downloadStandaloneDocument(
        http,
        renderer,
        doc,
        join(vehicleRoot, "Documents"),
        progress
      );
      merge(summary, result);
    }

    progress?.({
      phase: "done",
      message: `Finished. Downloaded ${summary.downloaded}, skipped ${summary.skipped}, failed ${summary.failed}.`,
    });
    return summary;
  } finally {
    await renderer.close();
  }
}
