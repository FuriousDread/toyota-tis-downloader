import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import { mkdir, rename, rm, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { dirname } from "path";

const MAX_COMPONENT_BYTES = 120;

/** Truncate by UTF-8 bytes (not JavaScript characters) to stay safe on Windows. */
function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character, "utf8") > maxBytes) break;
    result += character;
  }
  return result;
}

/** Convert a Toyota title into a safe, bounded filename/directory component. */
export function sanitizeName(name: string): string {
  let cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!cleaned) return "unnamed";

  // Windows reserves these names even when an extension is present.
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`;

  if (Buffer.byteLength(cleaned, "utf8") <= MAX_COMPONENT_BYTES) return cleaned;
  const suffix = `-${createHash("sha256").update(cleaned).digest("hex").slice(0, 8)}`;
  return `${truncateUtf8(cleaned, MAX_COMPONENT_BYTES - Buffer.byteLength(suffix))
    .replace(/[. ]+$/g, "")}${suffix}`;
}

export function isValidPdf(path: string): boolean {
  // A PDF signature plus a minimum size avoids treating an HTML/login response as complete.
  if (!existsSync(path) || statSync(path).size < 100) return false;
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(5);
    return readSync(fd, buffer, 0, 5, 0) === 5 && buffer.toString("ascii") === "%PDF-";
  } finally {
    closeSync(fd);
  }
}

export function isValidExistingFile(path: string, minBytes = 32): boolean {
  return existsSync(path) && statSync(path).size >= minBytes;
}

export async function writeFileAtomic(path: string, data: Buffer | string): Promise<void> {
  // Write to .part first so crashes do not leave a half-written final filename.
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  await rm(part, { force: true }).catch(() => undefined);
  await writeFile(part, data);
  await rm(path, { force: true }).catch(() => undefined);
  await rename(part, path);
}
