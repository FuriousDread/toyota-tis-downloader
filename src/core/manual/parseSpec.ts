import { MODERN_EWD_TYPES } from "../constants";
import type { ManualSpec } from "../types";

/** Separate an optional @YYYY suffix from an advanced manual entry. */
function splitYear(input: string): { spec: string; year?: number } {
  const at = input.lastIndexOf("@");
  if (at < 0) return { spec: input };
  const yearText = input.slice(at + 1);
  if (!/^\d{4}$/.test(yearText)) throw new Error(`Invalid model year in ${input}`);
  return { spec: input.slice(0, at), year: Number.parseInt(yearText, 10) };
}

export function parseManualSpec(input: string): ManualSpec {
  const rawInput = input.trim();
  if (!rawInput) throw new Error("Manual input is empty.");

  if (/^https?:\/\//i.test(rawInput)) {
    // URLs are preferable because they provide Toyota's exact directory/type.
    const url = new URL(rawInput);
    const ewdNo = url.searchParams.get("ewdNo");
    if (ewdNo) return { raw: ewdNo, id: ewdNo, kind: "modern-ewd" };

    const dirParam = url.searchParams.get("dir");
    const publication = url.searchParams.get("publicationNumber");
    const objType = url.searchParams.get("objType")?.toLowerCase();
    const modelYear = url.searchParams.get("MY");

    const parts = (dirParam ?? "").split("/").filter(Boolean);
    const directory = (parts[0] || objType || undefined)?.toLowerCase();
    const id = publication || parts[1];
    if (!id) throw new Error("Could not determine a publication number from that TIS URL.");

    const year = modelYear && /^\d{4}$/.test(modelYear)
      ? Number.parseInt(modelYear, 10)
      : undefined;

    return {
      raw: year ? `${id}@${year}` : id,
      id,
      year,
      directory,
      kind: directory && MODERN_EWD_TYPES.has(directory) ? "modern-ewd" : "generic",
    };
  }

  // Plain entries allow either ID or explicit directory/ID syntax.
  const { spec, year } = splitYear(rawInput);
  const slash = spec.indexOf("/");
  const directory = slash > 0 ? spec.slice(0, slash).toLowerCase() : undefined;
  const id = slash > 0 ? spec.slice(slash + 1) : spec;
  if (!id) throw new Error(`Invalid manual input: ${input}`);

  const kind = (!directory && id.slice(0, 2).toUpperCase() === "EM") ||
    (directory ? MODERN_EWD_TYPES.has(directory) : false)
    ? "modern-ewd"
    : "generic";

  return {
    raw: year ? `${id}@${year}` : id,
    id,
    year,
    directory,
    kind,
  };
}

export function candidateDirectories(manual: ManualSpec): string[] {
  // An explicit directory is authoritative; never probe alternatives in that case.
  if (manual.directory) return [manual.directory];

  switch (manual.id.slice(0, 2).toUpperCase()) {
    case "RM":
      // Some RM-prefixed publications are stored under the older atm directory.
      return ["rm", "atm"];
    case "BM":
      // Collision manuals have appeared under both cr and bm.
      return ["cr", "bm"];
    default:
      throw new Error(
        `Cannot safely guess the Toyota directory for ${manual.id}. ` +
        `Paste the full TIS URL or use directory/ID (for example atm/${manual.id}).`
      );
  }
}
