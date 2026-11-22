// Branch (branca) lookups. Codes are stored and used for folders and file
// names; labels are what people read.

import { CONFIG } from '../config.js';

const byCode = new Map(CONFIG.branche.map((b) => [b.code, b]));

/** Official abbreviation for display, e.g. "RS" → "R/S". Unknown codes pass through. */
export const brancaLabel = (code) => byCode.get(code)?.label ?? code ?? '';

/** Options for the segmented branch selector (visible label + spoken name). */
export const brancaOptions = () =>
  CONFIG.branche.map((b) => ({
    value: b.code,
    label: b.label,
    ariaLabel: b.name !== b.label ? `${b.label}, ${b.name}` : undefined,
  }));
