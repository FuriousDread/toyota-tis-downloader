// All network locations are centralized so a Toyota path change has one
// obvious starting point during troubleshooting.
export const TIS_ORIGIN = "https://techinfo.toyota.com";
export const TIS_CONTENT_BASE = `${TIS_ORIGIN}/t3Portal/external/en/`;
export const TIS_CATALOG_URL =
  `${TIS_ORIGIN}/t3Portal/appmanager/t3/ti?_nfpb=true&_pageLabel=t3_tis`;

// A persistent Electron partition lets login, catalog, and download windows
// share one authenticated Chromium cookie jar without copying Cookie headers.
export const TIS_PARTITION = "persist:tis";

// Keep portal-specific field names here so a future TIS markup change remains
// isolated from the rest of the catalog and download code.
export const CATALOG_FIELDS = {
  division: "repairformwlw-select_key:{actionForm.division}",
  model: "repairformwlw-select_key:{actionForm.model}",
  year: "repairformwlw-select_key:{actionForm.year}",
} as const;

// These types represent multi-page manuals. Every other catalog result is
// handled as a standalone document/PDF.
export const MANUAL_OBJ_TYPES = new Set([
  "rm",
  "bm",
  "cr",
  "atm",
  "ncf",
  "whr",
  "ewd",
  "ewdappu",
  "em",
]);

export const MODERN_EWD_TYPES = new Set(["ewdappu", "em"]);
