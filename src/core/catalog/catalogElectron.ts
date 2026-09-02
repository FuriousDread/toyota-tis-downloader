import { BrowserWindow } from "electron";
import { CATALOG_FIELDS, TIS_CATALOG_URL } from "../constants";
import { isLoginRedirectUrl, SessionExpiredError } from "../session/session";
import type { SelectOption, ToyotaDocument, VehicleSelection } from "../types";
import {
  dedupeDocuments,
  extractUrlCandidates,
  pageLabelFromLink,
  parseToyotaDocumentLink,
} from "./links";

const SETTLE_MS = 2500;
const SEARCH_SETTLE_MS = 4000;
const RESULT_TIMEOUT_MS = 15000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hidden windows share the same persistent partition as the visible login window. */
function makeHiddenWindow(partition: string): BrowserWindow {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
}

async function selectOptions(win: BrowserWindow, name: string): Promise<SelectOption[]> {
  // Results may live in the main document or nested frames; scan both.
  for (const frame of win.webContents.mainFrame.framesInSubtree) {
    const options = await frame
      .executeJavaScript(`(() => {
        const el = document.querySelector('select[name=${JSON.stringify(name)}]');
        if (!el) return undefined;
        return [...el.options]
          .filter(o => o.value)
          .map(o => ({ value: o.value, label: (o.textContent || o.value).trim() }));
      })()`)
      .catch(() => undefined) as SelectOption[] | undefined;
    if (options) return options;
  }
  return [];
}

async function setSelect(win: BrowserWindow, name: string, value: string): Promise<void> {
  let found = false;
  for (const frame of win.webContents.mainFrame.framesInSubtree) {
    const result = await frame
      .executeJavaScript(`(() => {
        const el = document.querySelector('select[name=${JSON.stringify(name)}]');
        if (!el) return { found: false };
        const requested = ${JSON.stringify(value)};
        if (![...el.options].some(option => option.value === requested)) {
          return { found: true, selected: false };
        }
        el.value = requested;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, selected: el.value === requested };
      })()`)
      .catch(() => undefined) as { found?: boolean; selected?: boolean } | undefined;
    if (!result?.found) continue;
    found = true;
    if (!result.selected) throw new Error(`Toyota TIS rejected the selected value '${value}'.`);
    break;
  }
  if (!found) throw new Error(`Missing Toyota TIS select '${name}'. The catalog page may have changed.`);

  // Toyota rebuilds dependent selects after each change; allow that update to finish.
  await sleep(SETTLE_MS);
  if (isLoginRedirectUrl(win.webContents.getURL())) throw new SessionExpiredError();
}

interface PageLink {
  value: string;
  title?: string;
}

/** Collect hrefs and popup-handler URLs from the main document and every iframe. */
async function anchorsAcrossFrames(win: BrowserWindow): Promise<PageLink[]> {
  const rows: Array<{ href: string; title?: string }> = [];
  for (const frame of win.webContents.mainFrame.framesInSubtree) {
    const found = await frame
      .executeJavaScript(`(() => [...document.querySelectorAll('a')].flatMap(a => {
        const title = (a.textContent || a.getAttribute('title') || '').trim() || undefined;
        return [
          a.href,
          a.getAttribute('href'),
          a.getAttribute('onclick'),
          a.getAttribute('data-href'),
          a.getAttribute('data-url')
        ].filter(Boolean).map(href => ({ href, title }));
      }))()`)
      .catch(() => [] as Array<{ href: string; title?: string }>);
    rows.push(...(found as Array<{ href: string; title?: string }>));
  }
  return rows.map((row) => ({ value: row.href, title: row.title }));
}

async function collectDocumentsOnCurrentPage(win: BrowserWindow): Promise<ToyotaDocument[]> {
  const docs: ToyotaDocument[] = [];
  for (const anchor of await anchorsAcrossFrames(win)) {
    const doc = parseToyotaDocumentLink(anchor.value, anchor.title);
    if (doc) docs.push(doc);
  }
  return docs;
}

/** Click the search control in whichever frame owns it. */
async function clickSearch(win: BrowserWindow): Promise<void> {
  for (const frame of win.webContents.mainFrame.framesInSubtree) {
    const clicked = await frame
      .executeJavaScript(`(() => {
        const controls = [...document.querySelectorAll('input, button')];
        const button = controls.find(el => {
          const label = (el.value || el.textContent || '').trim().toLowerCase();
          return el.id === 'searchButton' || label === 'search';
        });
        if (!button) return false;
        button.click();
        return true;
      })()`)
      .catch(() => false);
    if (clicked) return;
  }
  throw new Error("Toyota TIS Search button not found. The catalog page may have changed.");
}

/** Poll for slow portal navigation/AJAX until recognizable results appear. */
async function waitForSearchResults(win: BrowserWindow): Promise<PageLink[]> {
  const deadline = Date.now() + RESULT_TIMEOUT_MS;
  let links: PageLink[] = [];
  do {
    if (isLoginRedirectUrl(win.webContents.getURL())) throw new SessionExpiredError();
    links = await anchorsAcrossFrames(win);
    if (
      links.some((link) =>
        parseToyotaDocumentLink(link.value, link.title) || /^lib_[a-z]+_page$/i.test(pageLabelFromLink(link.value))
      )
    ) {
      return links;
    }
    await sleep(300);
  } while (Date.now() < deadline);
  return links;
}

/** Resolve a normal URL from a tab href or JavaScript popup wrapper. */
function navigableUrl(raw: string): string | undefined {
  return extractUrlCandidates(raw)
    .map((candidate) => {
      try {
        return new URL(candidate, TIS_CATALOG_URL).toString();
      } catch {
        return undefined;
      }
    })
    .find((candidate): candidate is string => Boolean(candidate && /^https?:/i.test(candidate)));
}

export async function verifyTisLogin(partition: string): Promise<boolean> {
  const win = makeHiddenWindow(partition);
  try {
    await win.loadURL(TIS_CATALOG_URL);
    await sleep(1200);
    if (isLoginRedirectUrl(win.webContents.getURL())) return false;
    // The form itself is a stronger login signal than merely avoiding a redirect.
    const divisions = await selectOptions(win, CATALOG_FIELDS.division);
    return divisions.length > 0;
  } catch {
    return false;
  } finally {
    win.destroy();
  }
}

export async function getVehicleOptions(
  partition: string,
  selection: Partial<VehicleSelection>
): Promise<{ divisions: SelectOption[]; models: SelectOption[]; years: SelectOption[] }> {
  const win = makeHiddenWindow(partition);
  try {
    await win.loadURL(TIS_CATALOG_URL);
    await sleep(1200);
    if (isLoginRedirectUrl(win.webContents.getURL())) throw new SessionExpiredError();

    const divisions = await selectOptions(win, CATALOG_FIELDS.division);
    let models: SelectOption[] = [];
    let years: SelectOption[] = [];

    if (selection.division) {
      await setSelect(win, CATALOG_FIELDS.division, selection.division);
      models = await selectOptions(win, CATALOG_FIELDS.model);
    }
    if (selection.division && selection.model) {
      await setSelect(win, CATALOG_FIELDS.model, selection.model);
      years = await selectOptions(win, CATALOG_FIELDS.year);
    }

    return { divisions, models, years };
  } finally {
    win.destroy();
  }
}

export async function collectDocumentsElectron(
  partition: string,
  vehicle: VehicleSelection
): Promise<ToyotaDocument[]> {
  const win = makeHiddenWindow(partition);
  try {
    await win.loadURL(TIS_CATALOG_URL);
    await sleep(1200);
    if (isLoginRedirectUrl(win.webContents.getURL())) throw new SessionExpiredError();

    await setSelect(win, CATALOG_FIELDS.division, vehicle.division);
    await setSelect(win, CATALOG_FIELDS.model, vehicle.model);
    await setSelect(win, CATALOG_FIELDS.year, vehicle.year);

    await clickSearch(win);
    await sleep(SEARCH_SETTLE_MS);
    if (isLoginRedirectUrl(win.webContents.getURL())) throw new SessionExpiredError();

    const docs: ToyotaDocument[] = [];
    const resultLinks = await waitForSearchResults(win);
    docs.push(...(await collectDocumentsOnCurrentPage(win)));

    // TIS exposes separate library tabs using _pageLabel=lib_<type>_page.
    // Visit one representative URL for each distinct tab, not every link.
    const currentLabel = pageLabelFromLink(win.webContents.getURL());
    const tabs = new Map<string, string>();
    for (const anchor of resultLinks) {
      const label = pageLabelFromLink(anchor.value);
      const href = navigableUrl(anchor.value);
      if (href && /^lib_[a-z]+_page$/i.test(label) && label !== currentLabel && !tabs.has(label)) {
        tabs.set(label, href);
      }
    }

    for (const href of tabs.values()) {
      await win.loadURL(href).catch(() => undefined);
      await sleep(SETTLE_MS);
      if (isLoginRedirectUrl(win.webContents.getURL())) throw new SessionExpiredError();
      await waitForSearchResults(win);
      docs.push(...(await collectDocumentsOnCurrentPage(win)));
    }

    const unique = dedupeDocuments(docs).sort((a, b) => {
      const t = a.type.localeCompare(b.type);
      return t || a.publicationNumber.localeCompare(b.publicationNumber);
    });
    if (!unique.length) {
      throw new Error(
        `Toyota TIS returned no recognizable document links. Scanned ` +
        `${win.webContents.mainFrame.framesInSubtree.length} frame(s) and ${resultLinks.length} link value(s) ` +
        `at ${win.webContents.getURL()}. Recheck the vehicle, confirm the TIS page shows results in the login window, ` +
        `and see ARCHITECTURE.md > Catalog search troubleshooting.`
      );
    }
    return unique;
  } finally {
    win.destroy();
  }
}
