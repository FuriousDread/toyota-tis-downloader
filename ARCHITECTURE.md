# Architecture notes

This is mostly here for anyone who wants to change the code later, including me if I come back to it after forgetting how everything works.

The README already explains what the program does, so this file is only meant to show where the important pieces are and what is most likely to matter when debugging it.

## General flow

```text
src/ui
  |
  | window.tis
  v
src/app/preload.ts
  |
  | Electron IPC
  v
src/app/main.ts
  |
  +-- shared Toyota Electron session (persist:tis)
  +-- catalog/search code
  +-- download manager
        |
        +-- normal/legacy manuals
        +-- modern EWDs
        +-- standalone documents
```

The UI is sandboxed. It does not get normal Node.js or Electron access directly. `preload.ts` exposes the small `window.tis` bridge used by `renderer.js`.

The visible Toyota login window, catalog requests, hidden page renderer, and direct HTTP downloads all use the same persistent Electron session. That is what lets the user sign in normally on Toyota's website without the program handling their username, password, or MFA itself.

## Main files

| Path | What it is for |
| --- | --- |
| `src/app/main.ts` | Electron windows, IPC, theme, persistent Toyota session, login checks, starting downloads |
| `src/app/preload.ts` | The limited API exposed to the renderer as `window.tis` |
| `src/ui/` | HTML/CSS/JS interface |
| `src/core/downloadManager.ts` | Routes selected items to the correct downloader and processes them sequentially |
| `src/core/constants.ts` | Toyota URLs, field names, manual type sets, shared constants |
| `src/core/catalog/catalogElectron.ts` | Loads vehicle options, runs Toyota's search, checks frames/tabs |
| `src/core/catalog/links.ts` | Turns Toyota result links into normalized documents/manual specs |
| `src/core/manual/` | Manual input parsing, TOC handling, year filtering, HTML/PDF-wrapper downloads |
| `src/core/documents/` | Standalone bulletin/document downloads |
| `src/core/ewd/` | Newer electrical wiring diagram downloads |
| `src/core/http/tisHttp.ts` | Authenticated requests through Electron's Toyota session |
| `src/core/session/session.ts` | Detects redirects/pages that mean the Toyota session is no longer logged in |
| `src/core/browser/electronRenderer.ts` | Hidden authenticated page used when HTML needs to be printed to PDF |
| `src/core/util/files.ts` | Filename cleanup, file validation, `.part` writes, safe rename behavior |
| `accessor/index.html` | Offline link-to-downloaded-page helper copied into manual folders |

## Catalog/search side

`catalogElectron.ts` is the main Toyota website adapter.

It handles the dependent Division/Model/Year selectors, submits Toyota's Search button, and scans both the main document and nested frames. Toyota sometimes separates results into library tabs, so those are visited and merged as well.

`links.ts` handles the messier part of turning Toyota's different link formats into one internal document format. Toyota results can use normal URLs, JavaScript popup links, `onclick`, `data-href`, `data-url`, and viewer URLs with useful information in their query parameters.

If Toyota changes the search page and the program suddenly stops finding documents, these two files are the first place I would look.

## Manual routing

Manual input is parsed in `src/core/manual/parseSpec.ts`.

An explicit directory from Toyota or from manual input takes priority. Bare `RM...` and `BM...` IDs have a couple of conservative fallback directories, but the program intentionally does not guess arbitrary directories for unknown manual prefixes.

The TOC resolver checks that a candidate `toc.xml` actually looks like a Toyota TOC. This matters because TIS can sometimes return a login/error HTML page with HTTP 200 instead of a useful HTTP error.

Normal manuals are built from Toyota's TOC hierarchy and rendered page-by-page. Older manuals that are really wrappers around existing PDFs are detected and downloaded directly instead. Newer `em`/`ewdappu` wiring diagrams have their own downloader because their structure is different from the normal manual TOC.

## Authentication/session failures

A lot of unrelated download failures at once usually point to the Toyota session rather than every document suddenly being broken.

Session checks live mainly in:

```text
src/app/main.ts
src/core/session/session.ts
src/core/http/tisHttp.ts
```

The login verifier checks the real Toyota catalog instead of deciding that a certain URL automatically means the user is logged in.

During downloads, known login redirects and recognizable login pages are treated as an expired session so the run stops instead of producing a large number of garbage PDFs.

## Resume/file behavior

There is no database or separate checkpoint file for the overall download run.

The downloaded files themselves are the resume state. Before downloading something again, the code checks whether a usable file is already present.

Important behavior lives in `src/core/util/files.ts`:

- PDFs must be large enough and start with `%PDF-`.
- Other EWD assets have a minimum-size check.
- New downloads are first written as `.part` files.
- The temporary file is renamed only after the write succeeds.
- Windows-invalid/reserved filenames are cleaned up.
- Long path components get a stable hash suffix instead of just being chopped at a random point.

Because of this, rerunning the same selection is the normal recovery method after an interrupted download.

## Model-year filtering

Some Toyota manuals contain year applicability information in `toc.xml`.

For the manual types where the program uses that information, the selected vehicle year is passed into TOC parsing so pages that Toyota marks for other years can be left out of the downloaded tree.

The original TOC is still saved as `toc-full.xml`, while the downloaded/filtered structure is represented by the generated TOC files beside the manual.

## If Toyota changes the website

These are the most likely repair points:

| What broke | Start here |
| --- | --- |
| Division / model / year lists | `src/core/constants.ts`, `src/core/catalog/catalogElectron.ts` |
| Search results no longer detected | `src/core/catalog/catalogElectron.ts`, `src/core/catalog/links.ts` |
| Toyota changed viewer/manual URLs | `src/core/catalog/links.ts`, `src/core/manual/parseSpec.ts`, `src/core/manual/resolveToc.ts` |
| Standalone bulletins stop downloading | `src/core/documents/downloadDocument.ts` |
| Newer wiring diagrams change layout | `src/core/ewd/downloadEwd.ts` |
| Login/session expiry stops being recognized | `src/core/session/session.ts`, `src/core/http/tisHttp.ts` |

That is probably enough context to find the correct area without documenting every Toyota edge case in the repository itself.
