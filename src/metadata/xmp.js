// XMP packet with standard Dublin Core fields and custom Italian-named fields
// in the "scontrini" namespace.

// --------------------------------------------------------------------------
// XMP (campi personalizzati in italiano)
// --------------------------------------------------------------------------
const xmlEsc = (s) =>
  String(s ?? '').replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c],
  );

const BOM = String.fromCharCode(0xfeff); // required by the XMP packet header

// A URN, not a URL: stable forever and tied to no domain we would have to own
const XMP_NS = 'urn:scountrini:xmp:1.0:';

function xmpGps(deg, pos, neg) {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${d},${m.toFixed(6)}${deg >= 0 ? pos : neg}`;
}

/**
 * @param {object} f
 *  title, description, creator, keywords[], createDate (ISO), dateCreated (YYYY-MM-DD),
 *  gps {lat,lon}, custom: { NomeCampo: valore } (namespace "scontrini")
 */
export function buildXmp(f) {
  const alt = (v) => `<rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(v)}</rdf:li></rdf:Alt>`;
  const lines = [];
  if (f.title) lines.push(`<dc:title>${alt(f.title)}</dc:title>`);
  if (f.description) lines.push(`<dc:description>${alt(f.description)}</dc:description>`);
  if (f.creator) lines.push(`<dc:creator><rdf:Seq><rdf:li>${xmlEsc(f.creator)}</rdf:li></rdf:Seq></dc:creator>`);
  if (f.keywords?.length)
    lines.push(
      `<dc:subject><rdf:Bag>${f.keywords.map((k) => `<rdf:li>${xmlEsc(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>`,
    );
  lines.push(`<dc:language><rdf:Bag><rdf:li>it</rdf:li></rdf:Bag></dc:language>`);
  if (f.createDate) {
    lines.push(`<xmp:CreateDate>${xmlEsc(f.createDate)}</xmp:CreateDate>`);
    lines.push(`<xmp:MetadataDate>${xmlEsc(f.createDate)}</xmp:MetadataDate>`);
  }
  if (f.creatorTool) lines.push(`<xmp:CreatorTool>${xmlEsc(f.creatorTool)}</xmp:CreatorTool>`);
  if (f.dateCreated) lines.push(`<photoshop:DateCreated>${xmlEsc(f.dateCreated)}</photoshop:DateCreated>`);
  if (f.gps) {
    lines.push(`<exif:GPSLatitude>${xmpGps(f.gps.lat, 'N', 'S')}</exif:GPSLatitude>`);
    lines.push(`<exif:GPSLongitude>${xmpGps(f.gps.lon, 'E', 'W')}</exif:GPSLongitude>`);
  }
  for (const [k, v] of Object.entries(f.custom || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) throw new Error(`Invalid XMP property name: ${k}`);
    lines.push(`<scontrini:${k}>${xmlEsc(v)}</scontrini:${k}>`);
  }
  return `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:scontrini="${XMP_NS}">
   ${lines.join('\n   ')}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
