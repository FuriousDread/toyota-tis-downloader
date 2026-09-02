# Toyota TIS Downloader

This is my first real programming project and also my first GitHub repository so its not the cleanest but it works most of the time.

I originally started it because I wanted to make a few changes to [`iamtheyammer/fetch-toyota-service-manuals`](https://github.com/iamtheyammer/fetch-toyota-service-manuals), and at first I expected this to just become a fork. The scope kept growing, though, and eventually most of the program was rewritten around a desktop interface and a different workflow. At that point it made more sense to keep it as its own project.

I mainly made this for myself, so I don't expect to keep adding major features or actively maintaining it long-term. I may fix something if I run into a problem, but this is how it'll probably stay.

The basic idea is simple: sign into Toyota TechInfo through the app, choose a vehicle, select the manuals/documents you want, and download them into organized folders for offline use.

> **Important:** This project is not affiliated with or endorsed by Toyota. It does not provide a Toyota TechInfo subscription, include Toyota service information, or bypass Toyota login/MFA. You need your own valid TIS access and are responsible for following Toyota's terms of service and any applicable copyright laws.

## Table of Contents

- [Running it](#running-it)
  - [Option 1: Use the `.exe`](#option-1-use-the-exe)
  - [Option 2: Run it from the source code](#option-2-run-it-from-the-source-code)
- [Basic use](#basic-use)
- [If something goes wrong](#if-something-goes-wrong)
- [FAQ](#faq)
- [What it supports](#what-it-supports)
- [Download folders](#download-folders)
- [For anyone looking through the code](#for-anyone-looking-through-the-code)
- [License, attribution, and Toyota content](#license-attribution-and-toyota-content)

## Running it

There are two main ways to use the program.

### Option 1: Use the `.exe`

This is the easiest option.

If you downloaded a packaged Windows release, just run the installer or portable `.exe` and open **Toyota TIS Downloader**.

No Node.js setup is needed for the packaged version.

### Option 2: Run it from the source code

You will need:

- Windows 10 or 11
- [Node.js](https://nodejs.org/) 22 or newer
- Your own active Toyota TechInfo subscription

Download or clone the repository, open a terminal in the project folder, and run:

```powershell
npm ci
npm run dev
```

That builds the TypeScript and launches Electron.

If you want to make your own Windows package:

```powershell
npm run package:win
```

For a portable `.exe` instead:

```powershell
npm run package:portable
```

Electron Builder puts packaged builds in the `release` folder.

## Basic use

The interface is meant to be fairly self-explanatory:

1. Click **Open TIS Login**.
2. Sign into Toyota normally and complete MFA if asked.
3. Wait for the app to detect the login, or press **I finished logging in**.
4. Choose the division/make, model, and year.
5. Click **Find TIS Documents**.
6. Select what you want to download.
7. Choose an output folder.
8. Click **Download Selected**.

The program remembers the Toyota browser session between launches. Use **Clear saved TIS session** if you want to remove it and sign in again from scratch.

Obsolete Toyota publications are shown separately and are not selected automatically, but they can still be manually selected and downloaded.

## If something goes wrong

### Toyota says I am logged in, but the app does not

Give the automatic login check a few seconds, or click **I finished logging in**.

If that still fails, make sure the actual Toyota catalog works inside the login window. You can also use **Clear saved TIS session** and log in again.

Toyota may replace an existing TIS session if the same account is being used somewhere else, so logging in from another browser/device can also cause problems.

### Division/model/year does not load

Usually this means either the TIS session expired or Toyota changed something on the website.

Try clearing the saved session and logging in again first.

### Search finds nothing

Check the same vehicle manually on Toyota TIS. If Toyota itself shows documents but this program does not, Toyota may have changed its catalog/result-page layout and you might need to add the links manually.

### Downloads suddenly start failing

The first thing I would try is signing in again. The program has session-expiry detection, but Toyota does not always fail in exactly the same way.

You can rerun the same download afterward. Files that already downloaded correctly should be skipped.

### A download was interrupted

Just run it again. Completed files are validated and skipped, while incomplete `.part` files or invalid files are downloaded again.

### One manual cannot be found

The **Advanced manual input** box accepts manual IDs and Toyota viewer links, so a known manual can sometimes be added manually even if catalog detection fails.

Examples:

```text
RM12345
RM12345@2016
cr/BM30N0U
cr/BM30N0U@2016
https://techinfo.toyota.com/...viewer URL...
```

## FAQ

### Do I need a Toyota TechInfo/TIS subscription?

Yes. The program only downloads information that your own Toyota account can already access. It does not bypass Toyota authentication, MFA, or subscription requirements.

### Does the app save my Toyota username or password?

No. You sign in through Toyota's own website inside a separate Electron window. The app keeps the authenticated browser session so you do not normally have to sign in again every time.

### Why might Windows warn me when I run the `.exe`?

Public builds may be unsigned, so Windows SmartScreen can show an **Unknown publisher** or **Windows protected your PC** warning. The source code is available in this repository if you want to inspect or build it yourself.

### Can I use Toyota TIS in another browser while the downloader is running?

I would avoid signing into the same TIS account somewhere else during a large download. Toyota can replace or invalidate an existing session, which can interrupt the downloader.

### What happens if a download is interrupted?

Run it again. Valid completed files are skipped, while incomplete or invalid files are downloaded again.

### Why are downloads processed one at a time?

Mostly to keep the program predictable and avoid putting unnecessary load on Toyota TIS. It also makes resume behavior simpler.

### Which vehicles does this work with?

I have not tested every Toyota/Lexus/Scion model and model year. The downloader follows Toyota's current catalog/manual formats, so coverage should be fairly broad, but Toyota can change TIS and there will probably be edge cases I have never seen.

If you find a vehicle, manual, or publication that consistently fails, feel free to open an issue with enough information to reproduce it.

### Why did you make this?

I wanted an easier way to save the Toyota service information I had access to without manually opening and printing everything. I originally planned to make a few changes to an existing downloader, but the changes kept growing until it made more sense to turn it into a standalone desktop app.

### Are pull requests or fixes welcome even if the project is not actively maintained?

Yes. I do not expect to keep adding major features myself, but useful fixes and pull requests are welcome.

## What it supports

The program can:

- use the real Toyota login page and share that authenticated session with the downloader;
- load vehicle choices directly from TIS;
- search Toyota's catalog, including results hidden in frames/tabs;
- download normal repair/body/manual pages as PDFs;
- download older manuals that wrap an existing Toyota PDF;
- download newer electrical wiring diagram resources;
- download standalone publications such as service bulletins;
- detect obsolete publications and keep them out of the normal bulk selection;
- filter some manuals using Toyota's model-year information;
- resume interrupted downloads by skipping files that are already valid;
- create Windows-safe filenames and use temporary `.part` files to avoid treating partial downloads as finished.

Manual-like TIS types currently recognized by the downloader are:

```text
rm
bm
cr
atm
ncf
whr
ewd
ewdappu
em
```

## Download folders

The general layout is:

```text
Output/
  Division/
    Model/
      Year/
        Manuals/
          ...
        Documents/
          document-type/
            publication-number.pdf
```

Normal downloaded manuals also contain a small local `index.html` accessor. You can paste a Toyota TechInfo page link into it and, when the matching TOC information exists, it will point you to the corresponding downloaded PDF.

## For anyone looking through the code

The current program is the Electron/TypeScript application under `src/`.

The most useful places to start are:

```text
src/app/                 Electron windows, IPC, login/session handling
src/core/catalog/        Toyota vehicle catalog and search parsing
src/core/manual/         Manual parsing and downloading
src/core/documents/      Standalone document downloading
src/core/ewd/            Modern electrical wiring diagrams
src/core/session/        Session-expiry/login-page detection
src/ui/                  Local interface
```

Toyota-specific behavior is separated as much as I reasonably could, since the most likely thing to break in the future is Toyota changing TIS rather than Electron itself.

If you actually want to modify or repair the program, [ARCHITECTURE.md](ARCHITECTURE.md) has a more useful map of how the pieces connect without repeating every feature listed here.

## License, attribution, and Toyota content

The source code in this repository is licensed under the GNU General Public License v3. See [LICENSE](LICENSE).

This project started from work based on `iamtheyammer/fetch-toyota-service-manuals`, with some ideas also informed by the GPL-3.0 `maburlik/fetch-toyota-service-manuals` fork. The short provenance/attribution note is in [NOTICE.md](NOTICE.md).

No Toyota manuals, bulletins, wiring diagrams, or other Toyota service-information documents are included in this repository. Anything downloaded through the program comes from the user's own authenticated Toyota TIS session.
