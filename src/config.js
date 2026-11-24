// App configuration. Microsoft values come from build-time env vars
// (.env.local or CI secrets, see README) so no IDs live in the source.

import { version } from '../package.json';

export const CONFIG = {
  appName: 'Scountrini',
  version, // single source: package.json

  msal: {
    // Application (client) ID of the Microsoft Entra app registration (SPA)
    clientId: import.meta.env.VITE_MS_CLIENT_ID || 'INSERISCI-QUI-IL-CLIENT-ID',
  },
  // Files.ReadWrite.All is required to write into a folder shared by another user
  scopes: ['User.Read', 'Files.ReadWrite.All'],

  // Optional sharing link of the "scontrini" folder, pre-filled for everyone
  defaultShareUrl: import.meta.env.VITE_SHARE_URL || '',

  // `code` names the OneDrive folder and goes in file names (no "/" allowed
  // there); `label` is the official abbreviation shown in the app; `name` is
  // read by screen readers.
  branche: [
    { code: 'LC', label: 'L/C', name: 'Lupetti e Coccinelle' },
    { code: 'EG', label: 'E/G', name: 'Esploratori e Guide' },
    { code: 'RS', label: 'R/S', name: 'Rover e Scolte' },
    { code: 'GRUPPO', label: 'Gruppo', name: 'Gruppo' },
    { code: 'CDG', label: 'C.d.G.', name: 'Casa delle Guardie' },
  ],

  // The associative year starts on October 1st
  yearStartMonth: 10,

  // Image processing
  maxPhotoSide: 4000, // long side cap for imported photos (px)
  maxPagePixels: 12_000_000, // cap for one perspective-corrected photo
  maxOutputPixels: 16_000_000, // cap for the final image (iOS canvas limit)
  maxOutputSide: 16_000, // WebP format limit is 16383
  webpQuality: 0.86,
  montageGap: 24, // black gap between photos that could not be stitched (px)

  // Upload
  simpleUploadLimit: 4 * 1024 * 1024, // Graph simple upload limit
  uploadChunkSize: 320 * 1024 * 16, // resumable chunks must be multiples of 320 KiB (5 MiB)
};

export const LIMITS = {
  maxPagesPerDocument: 10,
};
