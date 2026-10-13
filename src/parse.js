// Dependency-free parser for the Israeli price-transparency XML files
// (PriceFull / PromoFull / Stores). The chains do not all use the same tag
// names or casing, so every lookup accepts several aliases.
import { gunzipSync, inflateRawSync } from 'node:zlib';

/** Decompress a downloaded file (gzip, or zip with a single entry) and decode text. */
export function decodeFile(buf) {
  let data = buf;
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data);
  else if (data[0] === 0x50 && data[1] === 0x4b) data = unzipFirstEntry(data);
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString('utf16le');
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return data.subarray(3).toString('utf8');
  return data.toString('utf8');
}

function unzipFirstEntry(buf) {
  // Minimal reader for a local file header (enough for the single-file zips some chains publish)
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip file');
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const body = buf.subarray(start, compSize ? start + compSize : undefined);
  if (method === 0) return body;
  if (method === 8) return inflateRawSync(body);
  throw new Error('unsupported zip method ' + method);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));

/** All inner texts of <tag>…</tag> for the first alias that matches (case-insensitive). */
export function blocks(xml, aliases) {
  for (const tag of aliases) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
    const out = [...xml.matchAll(re)].map((m) => m[1]);
    if (out.length) return out;
  }
  return [];
}

/** First scalar value among the aliases, trimmed and entity-decoded ('' when missing). */
export function field(xml, aliases) {
  for (const tag of aliases) {
    const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
    if (m) return decodeEntities(m[1].trim());
    if (new RegExp(`<${tag}\\s*/>`, 'i').test(xml)) return '';
  }
  return '';
}

const num = (s) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const bool = (s) => s === '1' || /^true$/i.test(s);

/** PriceFull / Price file → { chainId, storeId, items:[…] } */
export function parsePrices(xml) {
  const chainId = field(xml, ['ChainId', 'ChainID']);
  const storeId = field(xml, ['StoreId', 'StoreID']).replace(/^0+(?=\d)/, '');
  const items = blocks(xml, ['Item', 'Product']).map((b) => ({
    barcode: field(b, ['ItemCode', 'ItemCODE']),
    internal: field(b, ['ItemType']) === '0', // 0 = chain-internal code, not a real barcode
    name: field(b, ['ItemName', 'ItemNm']),
    manufacturer: field(b, ['ManufacturerName', 'ManufactureName']),
    country: field(b, ['ManufactureCountry']),
    description: field(b, ['ManufacturerItemDescription', 'ManufactureItemDescription']),
    unitQty: field(b, ['UnitQty']),
    quantity: num(field(b, ['Quantity'])),
    unitOfMeasure: field(b, ['UnitOfMeasure', 'UnitMeasure']),
    weighted: bool(field(b, ['bIsWeighted', 'BisWeighted', 'blsWeighted'])),
    qtyInPackage: num(field(b, ['QtyInPackage'])),
    price: num(field(b, ['ItemPrice'])),
    unitPrice: num(field(b, ['UnitOfMeasurePrice'])),
    allowDiscount: bool(field(b, ['AllowDiscount'])),
    updated: field(b, ['PriceUpdateDate']),
  })).filter((i) => i.barcode && i.price != null);
  return { chainId, storeId, items };
}

/** PromoFull / Promo file → { chainId, storeId, promos:[…] } */
export function parsePromos(xml) {
  const chainId = field(xml, ['ChainId', 'ChainID']);
  const storeId = field(xml, ['StoreId', 'StoreID']).replace(/^0+(?=\d)/, '');
  const promos = blocks(xml, ['Promotion', 'Sale']).map((b) => {
    const barcodes = blocks(b, ['Item', 'PromotionItem']).map((i) => field(i, ['ItemCode'])).filter(Boolean);
    if (!barcodes.length) { const one = field(b, ['ItemCode']); if (one) barcodes.push(one); }
    // club ids come as "0", "0 - כלל הלקוחות" (Shufersal) or "(2=מועדון קרפור אשראי|…)" (Carrefour): keep the number
    const clubId = (c) => (String(c).match(/\d+/) || [String(c).trim()])[0];
    const clubs = blocks(b, ['Club', 'Clubs']).map((c) => field(c, ['ClubId'])).filter(Boolean).map(clubId);
    const club = field(b, ['ClubId']);
    if (club && !clubs.includes(clubId(club))) clubs.push(clubId(club));
    return {
      id: field(b, ['PromotionId', 'PromotionID']),
      description: field(b, ['PromotionDescription', 'PromotionDesc']),
      // dates: PromotionStartDate + PromotionStartHour, or one PromotionStartDateTime (Shufersal)
      start: field(b, ['PromotionStartDateTime']).replace('T', ' ') || `${field(b, ['PromotionStartDate'])} ${field(b, ['PromotionStartHour'])}`.trim(),
      end: field(b, ['PromotionEndDateTime']).replace('T', ' ') || `${field(b, ['PromotionEndDate'])} ${field(b, ['PromotionEndHour'])}`.trim(),
      rewardType: field(b, ['RewardType']),
      minQty: num(field(b, ['MinQty'])) ?? 1,
      maxQty: num(field(b, ['MaxQty'])),
      discountedPrice: num(field(b, ['DiscountedPrice'])),
      discountedPricePerMida: num(field(b, ['DiscountedPricePerMida'])),
      discountRate: num(field(b, ['DiscountRate'])),
      minPurchaseAmount: num(field(b, ['MinPurchaseAmnt', 'MinPurchaseAmount'])),
      weightUnit: field(b, ['WeightUnit']),
      isGiftItem: bool(field(b, ['IsGiftItem'])),
      // ClubId 0 = everyone; other ids are loyalty clubs / credit-card holders
      clubs: clubs.length ? clubs : ['0'],
      barcodes,
    };
  }).filter((p) => p.barcodes.length);
  return { chainId, storeId, promos };
}

/** Stores file → [{ storeId, name, city, address, subChain }] */
export function parseStores(xml) {
  const chainId = field(xml, ['ChainId', 'ChainID']);
  const stores = blocks(xml, ['Store', 'STORE', 'Branch']).map((b) => ({
    storeId: field(b, ['StoreId', 'StoreID']).replace(/^0+(?=\d)/, ''),
    name: field(b, ['StoreName', 'StoreNm']),
    city: field(b, ['City', 'CITY']),
    address: field(b, ['Address', 'ADDRESS']),
    zip: field(b, ['ZipCode']),
    subChain: field(b, ['SubChainName', 'SUBCHAINNAME']),
    type: field(b, ['StoreType']), // 1 physical, 2 online, 3 both
  })).filter((s) => s.storeId);
  return { chainId, stores };
}
