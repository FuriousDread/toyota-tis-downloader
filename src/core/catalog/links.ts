import { MANUAL_OBJ_TYPES, MODERN_EWD_TYPES, TIS_ORIGIN } from "../constants";
import type { ManualSpec, ToyotaDocument } from "../types";

/**
 * Turn an anchor value into URL candidates.
 *
 * TIS normally uses a plain href, but some portal versions put the real viewer
 * URL inside an inline JavaScript handler. Keeping that compatibility here
 * means the Electron page adapter does not need to understand every popup
 * function name Toyota has used.
 */
export function extractUrlCandidates(raw: string): string[] {
  const decoded = raw
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .trim();
  const candidates = new Set<string>();

  // A normal absolute/relative link can be parsed as-is.
  if (!/^javascript:/i.test(decoded)) candidates.add(decoded);

  // Popup handlers commonly pass the target as a quoted argument.
  for (const match of decoded.matchAll(/(["'])(.*?)\1/g)) {
    const value = match[2].trim();
    if (/^(?:https?:\/\/|\/|t3Portal\/)/i.test(value) || /[?&](?:publicationNumber|ewdNo|dir)=/i.test(value)) {
      candidates.add(value);
    }
  }

  return [...candidates].filter(Boolean);
}

function documentIsObsolete(href: string, title?: string): boolean {
  try {
    const url = new URL(href);

    // Toyota explicitly puts "OBSOLETE" in the docTitle query parameter
    // for superseded publications.
    const docTitle = url.searchParams.get("docTitle") ?? "";

    // Also check the visible title as a fallback in case Toyota provides
    // a document without docTitle in its URL.
    return (
      /\bobsolete\b/i.test(docTitle) ||
      /\bobsolete\b/i.test(title ?? "")
    );
  } catch {
    return /\bobsolete\b/i.test(title ?? "");
  }
}

/** URLSearchParams names are treated case-insensitively because portal casing has varied. */
function getParam(url: URL, ...names: string[]): string | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [name, value] of url.searchParams) {
    if (wanted.has(name.toLowerCase()) && value.trim()) return value.trim();
  }
  return undefined;
}

/** Infer a useful document type when a link omits objType. */
function inferType(publicationNumber: string): string {
  const prefix = publicationNumber.slice(0, 2).toUpperCase();
  if (prefix === "RM") return "rm";
  if (prefix === "BM") return "bm";
  if (prefix === "EM") return "ewdappu";
  return "unknown";
}

/**
 * Parse one TIS result link into the small, stable shape used by the UI.
 * Supports both catalog links containing publicationNumber and viewer links
 * where the publication ID exists only in dir=rm/RM12345.
 */
export function parseToyotaDocumentLink(raw: string, title?: string): ToyotaDocument | undefined {
  for (const candidate of extractUrlCandidates(raw)) {
    try {
      const url = new URL(candidate, TIS_ORIGIN);
      const ewdNo = getParam(url, "ewdNo");
      if (ewdNo) {
        const obsolete = documentIsObsolete(url.toString(), title);

        return {
          type: "ewdappu",
          publicationNumber: ewdNo,
          title,
          href: url.toString(),
          ...(obsolete ? { obsolete: true } : {}),
        };
      }

      const directoryParts = (getParam(url, "dir") ?? "")
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);

      const publicationNumber =
        getParam(
          url,
          "publicationNumber",
          "publicationNo",
          "pubNo"
        ) ?? directoryParts[1];

      if (!publicationNumber) continue;

      const type = (getParam(url, "objType") ?? directoryParts[0] ?? inferType(publicationNumber))
        .toLowerCase();

      const obsolete = documentIsObsolete(url.toString(), title);

      return {
        type,
        publicationNumber,
        title,
        href: url.toString(),
        ...(obsolete ? { obsolete: true } : {}),
      };
    } catch {
      // Try the next candidate extracted from the same anchor/onclick value.
    }
  }
  return undefined;
}

/** Extract a portal tab's page label from either a normal link or a popup wrapper. */
export function pageLabelFromLink(raw: string): string {
  for (const candidate of extractUrlCandidates(raw)) {
    try {
      const label = getParam(new URL(candidate, TIS_ORIGIN), "_pageLabel");
      if (label) return label;
    } catch {
      // Ignore malformed candidates; callers use an empty label as "not a tab".
    }
  }
  return "";
}

export function dedupeDocuments(docs: ToyotaDocument[]): ToyotaDocument[] {
  const map = new Map<string, ToyotaDocument>();
  for (const doc of docs) {
    // The portal sometimes changes only the casing of the same publication.
    const key = `${doc.type}:${doc.publicationNumber}`.toLowerCase();
    const existing = map.get(key);

    if (!existing) {
      map.set(key, doc);
      continue;
    }

    const obsolete = Boolean(existing.obsolete || doc.obsolete);

    map.set(key, {
      ...existing,
      title: existing.title || doc.title,
      ...(obsolete ? { obsolete: true } : {}),
    });
  }
  return [...map.values()];
}

export function isManualDocument(doc: ToyotaDocument): boolean {
  return MANUAL_OBJ_TYPES.has(doc.type.toLowerCase());
}

export function documentToManualSpec(doc: ToyotaDocument, year?: number): ManualSpec {
  const type = doc.type.toLowerCase();

  // Modern EWDs have their own title.xml layout and do not use the generic TOC.
  if (MODERN_EWD_TYPES.has(type)) {
    return {
      raw: doc.publicationNumber,
      id: doc.publicationNumber,
      kind: "modern-ewd",
    };
  }

  // Model-year filtering is meaningful only for manuals whose TOC carries year metadata.
  const useYear = ["rm", "bm", "cr"].includes(type) ? year : undefined;
  return {
    raw: useYear ? `${doc.publicationNumber}@${useYear}` : doc.publicationNumber,
    id: doc.publicationNumber,
    year: useYear,
    directory: type,
    kind: "generic",
  };
}
