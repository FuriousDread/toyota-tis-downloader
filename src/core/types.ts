// Shared data contracts used across the Electron main process, preload bridge,
// catalog adapter, and downloader. They intentionally contain no Electron types.
export type ManualKind = "generic" | "modern-ewd";

/** Values submitted to Toyota's division/model/year catalog form. */
export interface VehicleSelection {
  division: string;
  model: string;
  year: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Normalized representation of one link discovered in the TIS catalog. */
export interface ToyotaDocument {
  type: string;
  publicationNumber: string;
  title?: string;
  href?: string;
  /** Toyota marks some old/superseded publications as obsolete. */
  obsolete?: boolean;
}

/** Parsed form of an advanced manual entry or a catalog manual. */
export interface ManualSpec {
  raw: string;
  id: string;
  year?: number;
  directory?: string;
  kind: ManualKind;
}

/** Small events rendered in the status area while work proceeds sequentially. */
export interface ProgressEvent {
  phase: "login" | "catalog" | "manual" | "ewd" | "document" | "done" | "error";
  message: string;
  current?: number;
  total?: number;
  file?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

/** Counts returned after a complete download run. */
export interface DownloadSummary {
  downloaded: number;
  skipped: number;
  failed: number;
}

/** Download request sent from the desktop renderer to the main process. */
export interface DownloadPayload {
  vehicle: VehicleSelection;
  documents: ToyotaDocument[];
  manualSpecs: ManualSpec[];
  output: string;
}
