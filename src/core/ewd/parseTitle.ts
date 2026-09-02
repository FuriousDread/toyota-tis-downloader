import { xml2js } from "xml-js";

export interface ParsedTitle {
  [documentTitle: string]: string;
}

export default function parseTitle(titleXml: string): ParsedTitle {
  // Modern EWD title.xml files list a display name, figure ID, and file type.
  const xmlobj: any = xml2js(titleXml, {
    compact: true,
    trim: true,
    ignoreDoctype: true,
    ignoreDeclaration: true,
  });

  if (!xmlobj?.TitleList) throw new Error("Response does not contain TitleList.");

  // Toyota has changed the child element name. Collect structural children so
  // both a single entry object and the multi-entry array form are supported.
  const entries = Object.entries(xmlobj.TitleList).flatMap(([key, value]) => {
    if (key.startsWith("_")) return [];
    if (Array.isArray(value)) return value;
    return value && typeof value === "object" ? [value] : [];
  }) as any[];
  const result: ParsedTitle = {};

  for (const entry of entries) {
    const title = entry?.name?._text;
    const fig = entry?.fig?._text;
    const type = entry?.fig?._attributes?.type?.toLowerCase();
    // Ignore metadata elements and unknown formats rather than saving corrupt files.
    if (!title || !fig || !type || !["pdf", "svg", "svgz"].includes(type)) continue;
    result[`${String(title).replace(/\//g, "-")} (${fig})`] = `${fig}.${type}`;
  }

  return result;
}
