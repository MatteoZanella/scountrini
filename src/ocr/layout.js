// Rebuilds the visual rows of a receipt from the OCR line boxes. Tesseract may
// read a right-aligned price column as a separate block, so "TOTALE EURO" and
// its "8,50" come out far apart in the text; pieces whose vertical centres are
// within half a line height sit on the same printed row and are joined back,
// left to right. Pure function: unit-tested in tests/receipt-parser.test.js.

/**
 * @param {{text: string, bbox: {x0:number, y0:number, x1:number, y1:number}}[]} lines
 * @returns {{text: string, height: number}[]} rows from top to bottom
 */
export function rowsFromLines(lines) {
  const rows = [];
  const byTop = lines.filter((l) => l.text.trim()).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  for (const line of byTop) {
    const height = line.bbox.y1 - line.bbox.y0;
    const centre = (line.bbox.y0 + line.bbox.y1) / 2;
    const row = rows.find((r) => Math.abs(r.centre - centre) < Math.min(r.height, height) / 2);
    if (row) {
      row.items.push(line);
      row.height = Math.max(row.height, height);
    } else {
      rows.push({ centre, height, items: [line] });
    }
  }
  return rows
    .sort((a, b) => a.centre - b.centre)
    .map((r) => ({
      text: r.items
        .sort((a, b) => a.bbox.x0 - b.bbox.x0)
        .map((l) => l.text.trim())
        .join('  '),
      height: r.height,
    }));
}
