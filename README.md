# Scountrini

A static, installable web app (PWA) for photographing receipts and archiving them in a shared OneDrive folder:

```
scontrini/
└── 2026-2027/            ← associative year (Oct 1st → Sep 30th)
    ├── LC/
    ├── EG/
    │   ├── 2026-11-14_18-42_EG_Lidl.webp
    │   └── 2026-11-21_10-05_EG_Cadoro.webp
    ├── RS/ GRUPPO/ CDG/
```

Each person signs in with **their own Microsoft account** (and stays signed in). The folder belongs to one owner and is shared with everyone else in edit mode. No server and no database: the build is plain static files.

## Features

- **Capture**: camera, gallery, files, paste (Ctrl/⌘+V) or drag and drop. Several photos per document. Each browser gets only the pickers it can tell apart (e.g. Firefox for Android: one _Aggiungi foto_, as it opens the same chooser for camera and gallery).
- **Document detection** (jscanify + OpenCV): suggested corners, which you can drag (with a magnifier loupe), rotate, or reset to the full image.
- **Perspective correction** at native resolution.
- **Enhancement**: shadows and uneven light removed, paper made white, then a contrast slider. Each photo opens at its **Auto** level, which gives every receipt the same ink darkness. Black and white by default (colour available); press and hold the image to compare with the original.
- **Automatic stitching** of long receipts. ORB features + RANSAC (similarity) + a maximum spanning tree, so photos can be taken in any order. The seam is found with dynamic programming along the line where the photos agree best and where there is _no text_, with a soft blend around it. Photos with nothing in common are placed side by side on black. The result is always a single image.
- **Local OCR** (Tesseract, Italian model, works offline). Suggests date, merchant and total, following the layout of the Italian _documento commerciale_ (see below). Merchants you used before are recognised, also by their P.IVA, and autocompleted.
- **Associative year** computed from the purchase date, with a manual override (for example, archiving last year's receipts in October).
- **Branca** remembered until you change it.
- **Sortable file name**: `DATE_HH-MM_BRANCA_MERCHANT.webp`, with the date and the time printed on the receipt (read by the OCR, editable). The time is left out when the receipt has none. Uploads **never overwrite** an existing file. When the name is already taken, the app downloads that file and compares the image data only, ignoring the metadata:
  - same image: it was an earlier upload whose confirmation got lost, so it is marked as uploaded;
  - different image: the receipt waits in the log as _Da controllare_. _Controlla_ shows both images side by side, with three choices: it is the same receipt (nothing is uploaded), correct date/time/merchant (new name and metadata), or upload it as a copy with `-2`, `-3`, …
- **Italian metadata** in every file: EXIF (including the Windows _Title/Comments/Author/Tags_ fields) and XMP with custom fields: `Esercente`, `DataOperazione` (date and time), `Importo`, `Branca`, `AnnoAssociativo`, `Compilatore`, `AccountMicrosoft`, `Dispositivo`, `Posizione`, `NumeroFoto`, `Composizione`, `IdDocumento`, … plus GPS.
- **Offline queue**: saves on the phone first, then uploads when there is a connection (optionally Wi-Fi only on Android). Automatic retries with backoff. A retry after a lost server response does not create a duplicate (see above).
- **Log**: what has been uploaded (✓, with an _Apri su OneDrive_ button that opens the file in its OneDrive folder), what is queued, what failed and why. File names are not shown in the app: they are only for OneDrive.
- **Drafts survive** an app restart (useful when Android kills the page while the camera is open).

## Who does what

Two roles, which can be the same person or two different people:

|                        | **App owner** (publishes the app)                                                                 | **Folder owner** (owns the receipts)   |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Needs                  | A Microsoft Entra directory + a GitHub account (or any static host)                               | A OneDrive with the `scontrini` folder |
| Does                   | Registers the app with Microsoft, publishes it, sends the app URL to the folder owner             | Shares the folder, sends invite links  |
| Access to the receipts | **None.** The app has no server: files go straight from each phone to the folder owner's OneDrive | Full                                   |

The app owner never needs access to the folder, and the folder owner never needs the code. What connects them is the app URL. The client ID baked into the build is public, not a secret.

### App owner: register the app with Microsoft (free)

A plain personal Microsoft account can no longer create app registrations on its own: you need a Microsoft Entra **directory (tenant)**. Your group's Microsoft 365 tenant works, or you can create one for free (for example by signing up for an Azure free account).

1. Sign up to Azure at <https://azure.microsoft.com/free>. Go to <https://entra.microsoft.com> → _Applications_ → _App registrations_ → **New registration**.
2. Name: `Scountrini`. Supported account types: **"Accounts in any organizational directory and personal Microsoft accounts"**.
3. Redirect URI: platform **Single-page application (SPA)**, URL = the address where you will publish the app, **with the trailing slash**, e.g. `https://<user>.github.io/scountrini/`. Also add `http://localhost:5173/` for development.
4. Under _API permissions_ add the Microsoft Graph **delegated** permissions `User.Read` and `Files.ReadWrite.All`. Each user consents for themselves on their first sign-in; the app only ever acts as the signed-in user.
5. Copy the **Application (client) ID**.

Users will see the app as from an _unverified publisher_ on the consent screen. Personal Microsoft accounts can still consent. Work/school tenants may block unverified apps; their admin can approve it, or you can complete [publisher verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview).

### App owner: build and publish

Requires **Node.js 24 LTS** (or 22.12+), see `.nvmrc`. Odd-numbered Node versions such as 23 are short-lived and are refused by `npm install`.

```sh
cp .env.example .env.local    # then set VITE_MS_CLIENT_ID=<client id>
npm install
npm run dev                   # http://localhost:5173
```

Any static HTTPS host works. HTTPS is required for the camera and the service worker.

- **GitHub Pages**: `.github/workflows/deploy.yml` is included.
  1. In the repository: _Settings → Pages → Source: **GitHub Actions**_.
  2. _Settings → Secrets and variables → Actions → **Secrets** tab → **New repository secret**_. Name: `VITE_MS_CLIENT_ID`, value: the Application (client) ID. It must be a **repository** secret: an environment secret (e.g. on `github-pages`) is not visible to the build job, and the app would say it is not configured.
  3. The ID is compiled into the app, so adding or changing the secret takes effect only with the next build: push to `main`, or _Actions → Deploy to GitHub Pages → Run workflow_.

  The client ID is not confidential: it ends up in the published JavaScript and identifies the app, not a password. The app is a public client: it has no client secret, and sign-in is protected by PKCE and by the registered redirect URIs. It is kept in a secret only so that it stays out of the repository and can be changed without a commit.

- Manually: `npm run build` and upload the contents of `dist/`.

The build uses relative paths, so it works under any sub-path. The exact published URL must be registered as a redirect URI.

Optional: if the app serves a single group, the secret `VITE_SHARE_URL` (the folder owner's sharing link) pre-fills the folder for everyone, so plain app URLs work as invites.

Then send the app URL to the folder owner.

### Folder owner: share the folder and invite people

First choose how to share the `scontrini` folder. In OneDrive: **Share** → _link settings_ → pick who the link works for, keep **Can edit**, copy the link.

|                   | **Specific people** (recommended)                   | **Anyone with the link**                                      |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Who can upload    | Only the addresses you add                          | Anyone holding the link, signed in with any Microsoft account |
| New leader        | Add their address in OneDrive, then send the invite | Just send the invite                                          |
| Someone leaves    | Remove their address: they lose access immediately  | Delete the link and send a new one to everyone                |
| If the link leaks | Useless to others                                   | The holder can modify or delete the whole folder              |

Both work with the app, and in both cases **each person signs in with their own Microsoft account**. There is no way to upload without signing in: the OneDrive API requires a signed-in user even for "anyone" links.

Then:

1. With _Specific people_, add the Microsoft account of each leader: the exact address they sign in with (Outlook/Hotmail/Live or the one they use for OneDrive).
2. Open the app, sign in, and at step 2 paste the link, or choose _"La cartella è nel mio OneDrive"_ if you will also take photos yourself.
3. _Impostazioni → Invita qualcuno_ creates an **invite link** and opens the phone's share sheet (WhatsApp, etc.). The invite contains the app URL and the folder link. Anyone already set up can forward invites the same way.
4. Whoever opens the invite only has to sign in: the folder is linked automatically and saved on the device.

If you prefer not to use the app at all, an invite is just `<app URL>?cartella=<URL-encoded sharing link>`.

To remove someone, stop sharing with them in OneDrive (or delete the "anyone" link): their uploads fail from then on.

#### When someone has no access

This typically happens with _Specific people_, when the folder was shared with an address other than the one used to sign in. The app detects it while linking the folder, when checking the device, and on failed uploads. It then opens a **Non hai accesso** screen that:

- shows the address the person is signed in with;
- offers **Richiedi accesso su OneDrive**, which opens the sharing link in OneDrive. There, OneDrive's own _Request access_ form sends the request to the owner by email, and the owner approves it from OneDrive. The person must be signed in to OneDrive with the same address: if OneDrive shows another account, the request comes from that one;
- offers _Cambia account_, in case the folder was shared with another of their accounts.

The app does not submit the request itself, because Microsoft Graph has no API to request access on someone's behalf.

## Helping people on their phones

- **Impostazioni → Il tuo dispositivo** checks everything a phone needs, with a one-tap fix where possible:
  - the Microsoft sign-in;
  - **write access to the folder**, tested for real: an upload session is opened and cancelled, so no file is created;
  - whether the app is installed;
  - whether the browser protects local data;
  - receipts stuck for more than 2 days.
- **Permission errors name the signed-in address** and lead to the _Non hai accesso_ screen described above, with a _Chiedi accesso_ button in the checklist and on failed uploads in the log.
- **iPhone, install first.** The installed app has storage separate from Safari, so setup in Safari shows an install-first box with a _Copia il link della cartella_ button. The installed app's _Incolla_ button accepts a sharing link or a whole invite link.
- **Android install button.** On Chrome/Edge, an _Installa_ button appears in the banner and in the checklist.
- **Account:** _Cambia account_ (the queue is kept and uploads with the new account) and _Esci_ (warns about receipts not yet uploaded).
- **Aiuto** in Settings: tips for good photos and long receipts, and fixes for common problems.

## Commands

| Command                           | What it does                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Dev server                                                                                                                                      |
| `npm run build`                   | Build into `dist/` (with manifest, icons and offline service worker)                                                                            |
| `npm run preview`                 | Serves the build locally                                                                                                                        |
| `npm test`                        | Unit tests (dates/associative year, naming, OCR parser, EXIF/XMP, WebP muxing)                                                                  |
| `npm run test:e2e`                | Smoke test of the real image pipeline in headless Chrome (detection, stitching, enhancement, WebP + metadata). `E2E_OUT=<dir>` saves the images |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                                                                               |

## Design and accessibility

- **Colours** from the AGESCI coordinated-image manual (2016): Viola AGESCI `#462678` as the brand colour, sand neutrals, and the branch colours (L/C `#FDC500`, E/G `#21A067`, R/S `#E74030`) as dots in the branch selector. Every text colour reaches at least 4.5:1 contrast and every control outline 3:1 (WCAG 2.2 AA), in light and dark themes.
- **Back gesture**: closes the open screen (scanner, viewer, camera), then returns to _Nuovo_, then leaves the app.
- **Adaptive layout** following the Material 3 window size classes:
  - phones (< 600 px): bottom navigation bar, the same pattern as the iOS tab bar;
  - tablets and desktop: a navigation rail on the left;
  - from 1024 px: the composer, log and settings use two columns.
- **Touch targets**: at least 44 px (Apple), most of them 48 px (Material); WCAG 2.2 asks for 24 px.
- **Text follows the system size**: Dynamic Type on iOS, font scaling on Android, all sizes in `rem`. The typeface is the system font, which is Roboto on Android (also AGESCI's official typeface) and SF on iOS.
- **Theme**: automatic (follows the system), light or dark, chosen in _Impostazioni → Aspetto_ and applied before the first paint.
- **Other**: a visible focus ring for keyboard use, "reduce motion" honoured, forced-colours (high contrast) support, icon-only buttons labelled for screen readers, and `aria-current` on the active section.

## Structure

```
index.html                 markup of the views (Italian UI)
src/
  main.js                  bootstrap + view routing
  pwa.js                   service worker registration, install prompt
  config.js                branche, limits, quality, Microsoft scopes (version from package.json)
  core/                    pure logic: dates & associative year, branche, naming, settings, device
  storage/db.js            IndexedDB: upload queue/log + current draft
  cloud/                   MSAL login, Graph client, destination folder & invites, upload queue
  imaging/                 OpenCV loader, detection, perspective, enhancement, stitching, encoding
  metadata/                EXIF read/write, XMP, WebP/JPEG container muxing, Italian fields
  ocr/                     Tesseract wrapper + receipt parser (date/merchant/total/P.IVA)
  document/                pages (photo → crop → enhance) and archiving into a job
  ui/                      views/ (setup, composer, log, settings), scanner, corner editor, viewer,
                           status bar, device checklist, access request, paste/drop intake, dialogs
  styles/                  tokens (light/dark), base, components, layout, views, overlays
  sw/sw.js                 service worker (Workbox: precache + offline)
public/icon.svg            app icon: every PNG/ICO size is generated from it at build
tests/                     unit tests (Vitest) + e2e/ (puppeteer-core)
```

### How the OCR suggestions work

Tesseract turns the enhanced photo into text. The printed rows are rebuilt from the position of each piece of text (`src/ocr/layout.js`): pieces at the same height are one row, so a price read as a separate column goes back next to its label. Then `src/ocr/receipt-parser.js` applies rules based on the _documento commerciale_ that every Italian registratore telematico prints since 2020:

- **Date**: every date in the text is scored. A date followed by a time, near "DOCUMENTO N." (the footer) or after "data/del" wins. Future dates are dropped, dates older than 6 years only score lower, and OCR mix-ups (O for 0, `)` for a final 0) are fixed. The time printed after the date is read too.
- **Total**: amounts are ranked by their label, strongest first:
  1. "TOTALE COMPLESSIVO" / "TOTALE EURO";
  2. "TOTALE";
  3. cash minus change;
  4. electronic payment;
  5. cash handed over.

  Subtotals, discounts, VAT ("DI CUI IVA"), change and item counts are ignored. When the OCR splits a label and its amount over two lines, the amount on the next line is used. A candidate equal to the **sum of the items** above the total line wins over the ranking: a large "69,00" misread as "89,00" is caught by the items adding up to 69.

- **Merchant**: the shop sign is at the top and printed larger than the rest, on one line unless the line below is just as large. In order of preference:
  1. the name you chose before for the same **P.IVA**, read from the header and validated with its check digit (the shop is then recognised even when its name is a logo);
  2. a merchant used before, only if it appears in the header (a word like "contante" in the body never matches);
  3. the tallest header line, clearly taller than the body text, joined with the line below when that is as tall (heights from the OCR layout);
  4. without layout heights: the first header line, with company-form lines (S.r.l., snc…, usually the legal subtitle) last.

  The header is the top lines before the address, P.IVA or "documento commerciale". Owner lines ("sas di Rossi Mario", "Tarta snc di …") are never the shop. A website or e-mail printed on the receipt fixes the usual OCR slip of the article ("Trattoria I Gabbiano" → "Trattoria Il Gabbiano" thanks to trattoriailgabbiano.it).

Suggestions never overwrite what the user typed. Each rule has a unit test in `tests/receipt-parser.test.js`: add a test there with the OCR text of any receipt that is parsed wrong.

### Dependencies

All dependencies come from npm and are pinned in `package-lock.json`: nothing third-party is copied into `src/`.

- **Bundled by Vite**: MSAL, jscanify (its browser build, `jscanify/client`), the WebP encoder. Tesseract.js is loaded on demand.
- **PWA** (vite-plugin-pwa): manifest, icons and favicon (from `public/icon.svg`), and the Workbox service worker with its update prompt.
- **Served as static files**: OpenCV.js and the Tesseract worker, cores and Italian model, loaded by URL at runtime. vite-plugin-static-copy serves them from `node_modules` (list in `vite.config.js`), so they are cached for offline use and updated by bumping the npm version.
- **Install scripts**: npm 11 runs only those approved in `allowScripts` in `package.json`. Only esbuild's is approved. jscanify's Node build pulls in the native `canvas` addon, which the browser build never uses, so its build is denied. tesseract.js's script only prints a funding message.

## Things to know

- **Sign-in duration**: Microsoft caps refresh tokens for SPAs at 24 hours. After that the app renews silently when it can. Otherwise a _"Accesso scaduto → Accedi"_ banner appears; one tap and the queue resumes, nothing is lost.
- **iPhone**: install the app on the home screen (Share → _Add to Home Screen_). Otherwise Safari may delete local data after 7 days of inactivity, including any receipts not yet uploaded. The app requests persistent storage and shows a reminder.
- **Uploads happen while the app is open** (on launch, when the connection returns, every 45 s). Browsers do not allow reliable background uploads with Microsoft tokens.
- **WebP on Safari**: Safari cannot encode WebP from a canvas, so a WebAssembly encoder is loaded on demand. If that fails too, the app falls back to JPEG (same metadata).
- **Resolution**: photos are capped at 4000 px on the long side and the final image at 16 Mpx / 16 000 px per side (iOS canvas and WebP limits). Receipt text stays sharp.
- **Work/school accounts**: if the folder lives in a OneDrive for Business, external people must be invited as guests of the tenant, and `VITE_MS_AUTHORITY` must point to that tenant (e.g. `https://login.microsoftonline.com/contoso.onmicrosoft.com`). With `common`, guests sign in as their personal account and cannot reach the folder.
