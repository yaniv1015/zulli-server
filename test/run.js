// Offline tests: parse sample files in the official format, merge two chains by barcode,
// and price a basket with promotions and a loyalty club.
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeFile, parsePrices, parsePromos, parseStores } from '../src/parse.js';
import { emptyDb, addPrices, addPromos, addStores, buildSummary, dealFor, packDeal } from '../src/normalize.js';
import { compareBasket, linePrice } from '../src/compare.js';
import { pickLatest, parsePublishPrice } from '../src/adapters.js';

const MILK = '7290004131074', BAMBA = '7290000066318', SHAMPOO = '7290108350692';

const priceXml = (chainId, store, rows) => `<?xml version="1.0" encoding="utf-8"?>
<root><ChainId>${chainId}</ChainId><SubChainId>001</SubChainId><StoreId>${store}</StoreId><BikoretNo>1</BikoretNo>
<Items Count="${rows.length}">${rows.map(([code, name, mfr, price, w]) => `
  <Item><PriceUpdateDate>2026-10-11 08:00</PriceUpdateDate><ItemCode>${code}</ItemCode><ItemType>1</ItemType>
  <ItemName>${name}</ItemName><ManufacturerName>${mfr}</ManufacturerName><ManufactureCountry>IL</ManufactureCountry>
  <UnitQty>ליטר</UnitQty><Quantity>1.00</Quantity><bIsWeighted>${w ? 1 : 0}</bIsWeighted><UnitOfMeasure>ליטר</UnitOfMeasure>
  <QtyInPackage>1</QtyInPackage><ItemPrice>${price}</ItemPrice><UnitOfMeasurePrice>${price}</UnitOfMeasurePrice><AllowDiscount>1</AllowDiscount><ItemStatus>1</ItemStatus></Item>`).join('')}
</Items></root>`;

// Shufersal-style file (UTF-8, gzipped) and Rami Levy-style file (UTF-16 with BOM, different tag casing)
const shuf = priceXml('7290027600007', '413', [[MILK, 'חלב 3% תנובה 1 ל&apos;', 'תנובה', '7.10'], [BAMBA, 'במבה 80 גרם', 'אסם', '5.90'], [SHAMPOO, 'שמפו פנטן 500 מ"ל', 'P&amp;G', '22.90'], ['123', 'עגבניות', '', '8.90', 1]]);
const ramiXml = priceXml('7290058140886', '039', [[MILK, 'חלב תנובה 3% קרטון', 'תנובה', '7.10'], [BAMBA, 'במבה אסם 80ג', 'אסם', '4.90']]).replace(/ChainId/g, 'ChainID').replace(/StoreId/g, 'StoreID');
const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ramiXml, 'utf16le')]);

const promoXml = `<?xml version="1.0" encoding="utf-8"?><root><ChainId>7290027600007</ChainId><StoreId>413</StoreId><Promotions Count="2">
<Promotion><PromotionId>9001</PromotionId><PromotionDescription>במבה 3 ב-15</PromotionDescription><PromotionStartDate>2026-01-01</PromotionStartDate><PromotionStartHour>00:00</PromotionStartHour>
<PromotionEndDate>2099-12-31</PromotionEndDate><PromotionEndHour>23:59</PromotionEndHour><RewardType>1</RewardType><MinQty>3</MinQty><DiscountedPrice>15</DiscountedPrice>
<Clubs><ClubId>0</ClubId></Clubs><PromotionItems Count="1"><Item><ItemCode>${BAMBA}</ItemCode><ItemType>1</ItemType></Item></PromotionItems></Promotion>
<Promotion><PromotionId>9002</PromotionId><PromotionDescription>שמפו 20% למועדון</PromotionDescription><PromotionStartDate>2026-01-01</PromotionStartDate>
<PromotionEndDate>2099-12-31</PromotionEndDate><RewardType>3</RewardType><MinQty>1</MinQty><DiscountRate>2000</DiscountRate>
<Clubs><ClubId>3</ClubId></Clubs><PromotionItems Count="1"><Item><ItemCode>${SHAMPOO}</ItemCode></Item></PromotionItems></Promotion>
</Promotions></root>`;

const storesXml = `<Root><ChainId>7290027600007</ChainId><SubChains><SubChain><Stores>
<Store><StoreId>413</StoreId><StoreName>שופרסל ONLINE</StoreName><City>תל אביב</City><Address>רחוב לדוגמה 1</Address><StoreType>2</StoreType></Store>
<Store><StoreId>001</StoreId><StoreName>שופרסל דיל רמת אביב</StoreName><City>תל אביב</City><StoreType>1</StoreType></Store></Stores></SubChain></SubChains></Root>`;

// 1. decoding + parsing
const p1 = parsePrices(decodeFile(gzipSync(Buffer.from(shuf))));
assert.equal(p1.storeId, '413');
assert.equal(p1.items.length, 4);
assert.equal(p1.items[0].name, "חלב 3% תנובה 1 ל'");
assert.equal(p1.items[2].manufacturer, 'P&G');
assert.equal(p1.items[3].weighted, true);
const p2 = parsePrices(decodeFile(utf16));
assert.equal(p2.storeId, '39');
assert.equal(p2.items[1].price, 4.9);
const pr = parsePromos(promoXml);
assert.equal(pr.promos.length, 2);
assert.deepEqual(pr.promos[1].clubs, ['3']);
const st = parseStores(storesXml);
assert.equal(st.stores.length, 2);
assert.equal(st.stores[1].storeId, '1');

// 2. merge by barcode
const db = emptyDb();
addStores(db, 'shufersal', 'שופרסל', st);
addPrices(db, 'shufersal', 'שופרסל', p1);
addPrices(db, 'rami', 'רמי לוי', p2);
addPromos(db, 'shufersal', pr);
assert.deepEqual(db.products[MILK].prices, { shufersal: { 413: 7.1 }, rami: { 39: 7.1 } });
assert.ok(db.products['shufersal:123'], 'short internal codes are kept per chain');
assert.deepEqual(db.products[BAMBA].promos.shufersal['413'], ['9001']);
const sum = buildSummary(db);
assert.equal(sum.products[BAMBA].p.rami, 4.9);
assert.deepEqual(sum.stores.shufersal.map((x) => x.city), ['תל אביב', 'תל אביב']);

// 3. promotions
assert.equal(linePrice(5.9, 3, [db.promos.shufersal['9001']]).total, 15);
assert.equal(linePrice(5.9, 4, [db.promos.shufersal['9001']]).total, 20.9);
assert.equal(linePrice(5.9, 2, [db.promos.shufersal['9001']]).total, 11.8, 'below MinQty → no promo');
assert.equal(linePrice(22.9, 1, [db.promos.shufersal['9002']]).total, 22.9, 'club promo needs membership');
assert.equal(linePrice(22.9, 1, [db.promos.shufersal['9002']], { clubs: ['3'] }).total, 18.32);

// 4. basket comparison with delivery
const basket = [{ barcode: MILK, qty: 2 }, { barcode: BAMBA, qty: 3 }];
const res = compareBasket(db, [
  { chain: 'shufersal', storeId: '413', delivery: { fee: 29.9, min: 0 } },
  { chain: 'rami', storeId: '39', delivery: { fee: 29.9, min: 0 } },
], basket);
// Shufersal: 14.20 + 15.00 (3 for 15) = 29.20 · Rami Levy: 14.20 + 14.70 = 28.90 → Rami Levy wins by 30 agorot
assert.equal(res[0].chain, 'rami');
assert.equal(res[0].total, 58.8);
assert.equal(res[1].promoSave, 2.7);
console.log(res.map((r) => `${r.chain}: ${r.sub} + ${r.fee} = ${r.total} (promo −${r.promoSave})`).join('\n'));

// 5. picking newest files
const latest = pickLatest(['https://x/PriceFull7290027600007-001-413-202610110300.gz', 'https://x/PriceFull7290027600007-001-413-202610110600.gz', 'https://x/PromoFull7290027600007-001-413-202610110600.gz']);
assert.equal(latest.find((f) => f.type === 'PriceFull').stamp, '202610110600');
assert.equal(latest.find((f) => f.type === 'PriceFull').store, '413');
const cer = pickLatest(['/f/PriceFull7290058140886-039-202610110300.gz', '/f/PromoFull7290803800003-001-005-20261011-030000.xml.gz', '/f/Stores7290027600007-000-202610110201.gz']);
assert.deepEqual(cer.map((f) => `${f.type}:${f.store}:${f.stamp}`), ['PriceFull:39:202610110300', 'PromoFull:5:20261011030000', 'Stores:0:202610110201']);

// 6. PublishPrice page (Carrefour)
const pp = parsePublishPrice(`<script>const path = './20261012'; const files = [{"name":"PriceFull7290055700007-001-020-20261012-020000.gz","modified":"x"},{"name":"Stores7290055700007-000-20261012-020000.gz"}];</script>`, 'https://prices.carrefour.co.il/');
assert.deepEqual(pp, ['https://prices.carrefour.co.il/20261012/PriceFull7290055700007-001-020-20261012-020000.gz', 'https://prices.carrefour.co.il/20261012/Stores7290055700007-000-20261012-020000.gz']);
assert.equal(pickLatest(pp).find((f) => f.type === 'PriceFull').store, '20');

// 5b. Shufersal promotion layout: items under Groups/PromotionItems, one DateTime field, club text
const shufPromo = `<Root><ChainID>7290027600007</ChainID><StoreID>550</StoreID><Promotions><Promotion><PromotionID>1</PromotionID>
<PromotionDescription>במבה 3 ב-12</PromotionDescription><PromotionStartDateTime>2026-01-01T00:00:00.000</PromotionStartDateTime>
<PromotionEndDateTime>2099-08-01T02:59:00.000</PromotionEndDateTime><PromotionEndHour>02:59:00.000</PromotionEndHour><ClubID>0 - כלל הלקוחות</ClubID>
<Groups><Group><MinPurchaseAmount>0</MinPurchaseAmount><PromotionItems><PromotionItem><ItemCode>${BAMBA}</ItemCode><RewardType>1</RewardType><MinQty>3</MinQty><DiscountedPrice>12.00</DiscountedPrice></PromotionItem>
<PromotionItem><ItemCode>${MILK}</ItemCode><RewardType>1</RewardType><MinQty>3</MinQty><DiscountedPrice>12.00</DiscountedPrice></PromotionItem></PromotionItems></Group></Groups></Promotion></Promotions></Root>`;
const sp = parsePromos(shufPromo).promos[0];
assert.deepEqual(sp.barcodes, [BAMBA, MILK]);
assert.deepEqual(sp.clubs, ['0']);
assert.equal(sp.end.slice(0, 10), '2099-08-01');
assert.equal(parsePromos(shufPromo.replace('0 - כלל הלקוחות', '(2=מועדון קרפור אשראי|2=מועדון אפליקציה)')).promos[0].clubs[0], '2');

// 6. compact runs keep the best regular deal and the best club deal per chain, packed for the app
const cdb = emptyDb({ compact: true });
addPrices(cdb, 'shufersal', 'שופרסל', p1);
addPromos(cdb, 'shufersal', pr);
const cs = buildSummary(cdb);
assert.deepEqual(cs.products[BAMBA].d.shufersal.slice(0, 4), ['m', 3, 15, 0], '3 for 15, open to everyone');
assert.deepEqual(cs.products[SHAMPOO].dc.shufersal.slice(0, 4), ['p', 1, 20, 1], '20% for club members');
assert.equal(cs.products[MILK].d, undefined);
assert.equal(dealFor({ discountedPrice: 30, minQty: 1, clubs: ['0'] }, 10), null, 'not a discount');
assert.equal(dealFor({ discountedPrice: 5, minQty: 1, clubs: ['0'], end: '2001-01-01' }, 10), null, 'expired');
assert.equal(dealFor({ discountedPrice: 5, minQty: 1, clubs: ['0'], isGiftItem: true }, 10), null, 'gift');
{ // a club deal on a basket over 100 ₪, 3 units per shopper (שוק העיר, קולון ג'ל 4 ליטר 19.90)
  const d = dealFor({ discountedPrice: 19.9, minQty: 1, clubs: ['100'], minPurchaseAmount: 100, limit: 3, description: 'מוע-קולון' }, 39.9);
  assert.equal(d.price, 19.9); assert.equal(d.club, 1); assert.equal(d.min, 100); assert.equal(d.lim, 3);
  assert.deepEqual(packDeal(d).slice(6), [100, 3], 'packed with its minimum and limit');
  assert.equal(packDeal(dealFor({ discountedPrice: 5, minQty: 1, clubs: ['0'] }, 10)).length, 6, 'plain deals stay 6 long');
}

// 6b. the chain price is the one most branches charge; branches that differ keep their own price
{
  const bdb = emptyDb({ compact: true });
  const mk = (store, bamba) => parsePrices(priceXml('7290027600007', store, [[MILK, 'חלב', 'תנובה', '7.10'], [BAMBA, 'במבה', 'אסם', bamba]]));
  addPrices(bdb, 'shufersal', 'שופרסל', mk('1', '5.90')); addPrices(bdb, 'shufersal', 'שופרסל', mk('2', '5.90')); addPrices(bdb, 'shufersal', 'שופרסל', mk('3', '4.50'));
  const bs = buildSummary(bdb);
  assert.equal(bs.products[BAMBA].p.shufersal, 5.9, 'usual price, not the one cheap branch');
  const { buildBranches, branchBucket } = await import('../src/normalize.js');
  const br = buildBranches(bdb);
  assert.deepEqual(br[branchBucket('shufersal', '3')]['shufersal:3'], { [BAMBA]: 4.5 });
  assert.deepEqual(br[branchBucket('shufersal', '1')]['shufersal:1'], {});
  assert.equal(branchBucket('rami', '039'), branchBucket('rami', '039'));
}

// 6c. branch-only deals: a deal one store has that the chain-wide data lacks, and a chain-wide deal a store lacks
{
  const { branchDealDiff } = await import('../src/normalize.js');
  const summary = { products: { '111': { p: { keshet: 10 }, d: { keshet: ['m', 2, 15, 0, '', 'chain'] } }, '222': { p: { keshet: 20 } }, '333': { p: { keshet: 8 } } } };
  const br = { 'keshet:2': { '222': 18 } };
  const f = branchDealDiff(summary, br);
  const promo = (o) => ({ minQty: 1, clubs: ['0'], barcodes: [], ...o });
  // store 1 has the chain deal on 111 and nothing else: no difference
  assert.deepEqual(f('keshet', '1', { promos: [promo({ discountedPrice: 15, minQty: 2, barcodes: ['111'] })] }), {});
  // store 2 lacks the chain deal on 111, and has its own 50% on 222 (priced against its own 18), and a club deal on 333
  const o = f('keshet', '2', { promos: [promo({ discountRate: 50, barcodes: ['222'] }), promo({ discountedPrice: 5, clubs: ['3'], barcodes: ['333'] })] });
  assert.deepEqual(o.x, ['111'], 'chain deal missing in store 2');
  assert.deepEqual(o.d['222'].slice(0, 3), ['p', 1, 50]);
  assert.deepEqual(o.c['333'].slice(0, 4), ['m', 1, 5, 1]);
}

// 7. delivery fees, deposits and club fees are not products
import('../src/normalize.js').then(({ NOT_A_PRODUCT }) => {
  for (const n of ['עלות משלוח', 'משלוח', 'פיקדון בקבוקים', 'חידוש מועדון שוק העיר', 'GOOD PHARM - שקית אל בד גדול']) assert.ok(NOT_A_PRODUCT.test(n), n);
  for (const n of ['חלב תנובה 3%', 'שקית חלב 1 ליטר', 'במבה']) assert.ok(!NOT_A_PRODUCT.test(n), n);
  console.log('all tests passed ✓');
});
