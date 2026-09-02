import { xml2js } from "xml-js";

/** Nested directory names map to either another branch or a Toyota page href. */
export interface ParsedToC {
  [name: string]: ParsedToC | string;
}

interface ToCData {
  _attributes?: { fromyear?: string; toyear?: string };
}

interface ItemElement {
  item?: ItemElement | ItemElement[];
  tocdata?: ToCData | ToCData[];
  name?: { _text?: string };
  _attributes?: { href?: string };
}

function applicable(data: ToCData | undefined, year: number): boolean {
  // Missing/malformed ranges should include the item rather than silently lose content.
  if (!data?._attributes) return true;
  const from = Number.parseInt(data._attributes.fromyear ?? "0", 10);
  const to = Number.parseInt(data._attributes.toyear ?? "9999", 10);
  if (Number.isNaN(from) || Number.isNaN(to)) return true;
  return year >= from && year <= to;
}

function filteredChildren(item: ItemElement, year?: number): ItemElement[] {
  if (!item.item) return [];
  const children = Array.isArray(item.item) ? item.item : [item.item];
  if (!year || !item.tocdata) return children;

  const metadata = Array.isArray(item.tocdata) ? item.tocdata : [item.tocdata];
  if (metadata.length && !applicable(metadata[0], year)) return [];
  if (metadata.length <= 1) return children;

  const childMetadata = metadata.slice(1);
  return children.filter((_, index) => applicable(childMetadata[index], year));
}

function putLeaf(root: ParsedToC, path: string[], name: string, href: string): void {
  let cursor = root;
  for (const segment of path) {
    if (!cursor[segment] || typeof cursor[segment] === "string") cursor[segment] = {};
    cursor = cursor[segment] as ParsedToC;
  }
  cursor[name] = href;
}

function walk(item: ItemElement, root: ParsedToC, path: string[], year?: number): void {
  // Recursively convert Toyota's XML hierarchy into a filesystem-friendly tree.
  const name = item.name?._text?.trim();
  if (!name) return;

  const ownMetadata = Array.isArray(item.tocdata) ? item.tocdata[0] : item.tocdata;
  if (year && ownMetadata && !applicable(ownMetadata, year)) return;

  const children = filteredChildren(item, year);
  if (children.length) {
    for (const child of children) walk(child, root, [...path, name], year);
    return;
  }

  const href = item._attributes?.href;
  if (href) putLeaf(root, path, name, href);
}

export default function parseToC(xml: string, year?: number): ParsedToC {
  // Compact mode preserves element/attribute structure without a full DOM dependency.
  const parsed: any = xml2js(xml, {
    compact: true,
    trim: true,
    ignoreDoctype: true,
    ignoreDeclaration: true,
  });

  if (!parsed?.xmltoc) throw new Error("Response does not contain <xmltoc>.");
  const rootItems = Array.isArray(parsed.xmltoc.item)
    ? parsed.xmltoc.item
    : parsed.xmltoc.item
      ? [parsed.xmltoc.item]
      : [];
  if (!rootItems.length) throw new Error("Toyota TOC contains no items.");

  const result: ParsedToC = {};
  for (const item of rootItems) walk(item, result, [], year);
  if (!Object.keys(result).length) throw new Error("Toyota TOC produced no applicable pages.");
  return result;
}
