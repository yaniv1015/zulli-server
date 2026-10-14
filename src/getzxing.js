// one-off: fetch the ZXing barcode reader build so the app can ship it as a local file
import fs from 'node:fs';import zlib from 'node:zlib';
(async()=>{
  const out={};
  for(const u of ['https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js','https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js']){
    try{const r=await fetch(u);const t=await r.text();out[u]={status:r.status,len:t.length};if(r.ok&&t.length>100000){out.js=t;out.from=u;break}}catch(e){out[u]={err:String(e)}}
  }
  fs.mkdirSync('data',{recursive:true});
  const js=out.js;delete out.js;
  fs.writeFileSync('data/diag.json',JSON.stringify({from:out.from,len:js&&js.length,tries:out,gz:js?zlib.gzipSync(js).toString('base64'):null}));
})();
