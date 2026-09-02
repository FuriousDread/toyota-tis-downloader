import { HttpStatusError, TisHttp } from "../http/tisHttp";
import type { ManualSpec } from "../types";
import parseToC, { ParsedToC } from "./parseToc";
import { candidateDirectories } from "./parseSpec";

export interface ResolvedToc {
  directory: string;
  tocXml: string;
  toc: ParsedToC;
}

export async function resolveManualToc(http: TisHttp, manual: ManualSpec): Promise<ResolvedToc> {
  const directories = candidateDirectories(manual);
  const failures: string[] = [];

  for (const directory of directories) {
    const path = `${directory}/${manual.id}/toc.xml`;
    try {
      const xml = await http.text(path);
      try {
        // A 200 response is not enough: login/error HTML must not be accepted as a TOC.
        const toc = parseToC(xml, manual.year);
        return { directory, tocXml: xml, toc };
      } catch (error) {
        failures.push(`${directory}: response was not a valid Toyota TOC (${String(error)})`);
      }
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) {
        // A missing candidate is expected during conservative fallback probing.
        failures.push(`${directory}: 404`);
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Could not locate ${manual.id}. Tried ${directories.join(", ")}. ${failures.join("; ")}`
  );
}
