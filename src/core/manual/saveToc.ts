import { copyFile, mkdir } from "fs/promises";
import { join } from "path";
import { sanitizeName, writeFileAtomic } from "../util/files";
import type { ParsedToC } from "./parseToc";
import type { ResolvedToc } from "./resolveToc";

/** Mirror the downloader's filename transformation for the offline locator. */
export function localizeToc(toc: ParsedToC): ParsedToC {
  const localized: ParsedToC = {};
  for (const [name, value] of Object.entries(toc)) {
    localized[sanitizeName(name)] = typeof value === "string"
      ? value
      : localizeToc(value);
  }
  return localized;
}

/**
 * Copy the static offline manual locator into a downloaded manual folder.
 *
 * Every manual gets the same index.html. Normal manuals also get toc.js,
 * which makes the locator functional. Modern EWDs do not use toc.js, but
 * keeping a copy of index.html there is harmless.
 */
export async function copyManualAccessor(output: string): Promise<void> {
  await mkdir(output, { recursive: true });

  const appRoot = process.env.TIS_APP_ROOT || process.cwd();

  const source = join(
    appRoot,
    "accessor",
    "index.html"
  );

  const destination = join(
    output,
    "index.html"
  );

  try {
    await copyFile(source, destination);
  } catch (error) {
    // Do not destroy an otherwise successful manual download just because
    // the optional offline locator could not be copied.
    console.error(
      `Could not copy manual accessor from '${source}' to '${destination}':`,
      error
    );
  }
}

/**
 * Save the table-of-contents files used by normal Toyota manuals and add the
 * offline locator beside them.
 */
export async function saveTocAndAccessor(
  output: string,
  resolved: ResolvedToc
): Promise<void> {
  await mkdir(output, { recursive: true });

  await Promise.all([
    // Toyota's original full TOC.
    writeFileAtomic(
      join(output, "toc-full.xml"),
      resolved.tocXml
    ),

    // TOC after the selected model-year filtering has been applied.
    writeFileAtomic(
      join(output, "toc-downloaded.json"),
      JSON.stringify(resolved.toc, null, 2)
    ),

    // Browser-readable form consumed by accessor/index.html. Its keys must
    // match the safe local directory and PDF names used by the downloader.
    writeFileAtomic(
      join(output, "toc.js"),
      `document.toc = ${JSON.stringify(localizeToc(resolved.toc))};`
    ),
  ]);

  await copyManualAccessor(output);
}
