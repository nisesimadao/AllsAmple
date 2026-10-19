const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../hook.js'), 'utf8');
const ID = '5d073dcf-7c18-4c1c-b946-a737781dd2bd';
const OTHER = '3da11b21-df2d-496d-8661-7e44974e367a';
const media = (id = ID, expiry = Date.now() / 1000 + 300) => {
  const policy = Buffer.from(JSON.stringify({Statement:[{Condition:{DateLessThan:{'AWS:EpochTime': expiry}}}]})).toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
  return `https://assets.landr.com/samples/secure/streams/${id}/stream.mp3?Policy=${policy}&Signature=test`;
};
function setup(host = 'samples.landr.com') {
  const listeners = new Map();
  const replies = [];
  const timers = new Map();
  const clicks = [];
  const origin = 'https://' + host;
  const rows = new Map();
  let response = {};
  let error;
  class XHR {
    addEventListener(type, fn) { this.listener = fn; }
    open() { return 'opened'; }
    getResponseHeader() { return 'application/json'; }
  }
  const window = {
    addEventListener(type, fn) { listeners.set(type, fn); },
    postMessage(data, target) { assert.equal(target, origin); replies.push(data); },
    fetch: async () => { if (error) throw error; return {ok:true, url:'https://api3.landr.com/samples-bff/', headers:{get:()=> 'application/json'}, clone:()=>({json:async()=>response})}; }
  };
  const document = {
    readyState:'complete',
    querySelectorAll:()=>[],
    querySelector(selector) { const req = selector.match(/data-sfdl-req="(\d+)"/); return req ? rows.get(Number(req[1])) || null : null; }
  };
  vm.runInNewContext(source, {window, document, location:{hostname:host,origin}, XMLHttpRequest:XHR, URL, atob, Date, Number, setTimeout:(fn, ms)=>{const key={};timers.set(key,{fn,ms});return key}, clearTimeout:key=>timers.delete(key)});
  function row(reqId, id) {
    const r = {querySelector(selector) {
      if (selector === `[data-testid="row-checkbox-${id}"]` || selector === `a[href*="/sounds/sample/${id}"]`) return {};
      if (selector === 'button[aria-label="Play"]') return {click:()=>clicks.push(id)};
      return null;
    }, '__reactFiber$test':{memoizedProps:{sample:{guid:id,name:'Test_' + id}}}};
    rows.set(reqId,r);return r;
  }
  return {
    window, document, replies, clicks, timers, XHR, row,
    async fetch(body) {response=body; const result = await window.fetch('/'); await new Promise(resolve=>setImmediate(resolve));return result;},
    fail(err) {error=err;},
    resolve(id = ID, reqId = 1, extra = {}) {
      row(reqId,id);
      listeners.get('message')({source:window, origin, data:{__sfdl:'cs->page',type:'RESOLVE',reqId,id,...extra}});
    },
    dispatch(event) {listeners.get('message')(event);}
  };
}
test('LANDR uses prefetched signed URL and matching row name without starting playback', async () => {
  const h=setup();const url=media();const res=await h.fetch({data:{sampleStream:{url}}});
  assert.equal(res.ok,true);h.resolve();assert.equal(h.replies[0].url,url);
  assert.equal(h.replies[0].name,'Test_'+ID);assert.deepEqual(h.clicks,[]);
});
test('unrelated prefetch cannot resolve a pending row; matching response can', async () => {
  const h=setup();h.resolve();assert.deepEqual(h.clicks,[ID]);
  await h.fetch({data:{sampleStream:{url:media(OTHER)}}});assert.equal(h.replies.length,0);
  const url=media();await h.fetch({data:{sampleStream:{url}}});assert.equal(h.replies[0].url,url);assert.equal(h.timers.size,0);
});
test('simultaneous rows resolve independently even when responses arrive out of order', async () => {
  const h=setup();h.resolve(ID,1);h.resolve(OTHER,2);
  await h.fetch({data:{sampleStream:{url:media(OTHER)}}});assert.equal(h.replies[0].reqId,2);
  await h.fetch({data:{sampleStream:{url:media()}}});assert.equal(h.replies[1].reqId,1);
});
test('expired signatures are rejected, and missing URL times out with null', async () => {
  const h=setup();await h.fetch({data:{sampleStream:{url:media(ID,Date.now()/1000-1)}}});h.resolve();
  assert.equal(h.replies.length,0);assert.deepEqual(h.clicks,[ID]);
  const timer=[...h.timers.values()][0];assert.equal(timer.ms,8000);timer.fn();
  assert.equal(h.replies[0].url,null);assert.equal(h.timers.size,0);
});
test('XHR responses and direct media requests are observed without changing the response', async () => {
  const h=setup();const url=media();const xhr=new h.XHR();
  assert.equal(xhr.open(), 'opened');xhr.status=200;xhr.responseType='json';xhr.response={data:{sampleStream:{url}}};xhr.listener();
  h.resolve();assert.equal(h.replies[0].url,url);
  const h2=setup();const xhr2=new h2.XHR();xhr2.open();xhr2.status=200;xhr2.responseURL=url;xhr2.responseType='arraybuffer';xhr2.listener();h2.resolve();assert.equal(h2.replies[0].url,url);
});
test('untrusted URLs, invalid IDs and invalid messages cannot supply a result', async () => {
  const h=setup();await h.fetch({url:media().replace('assets.landr.com','evil.example')});h.resolve();assert.equal(h.replies.length,0);
  h.resolve('bad"]');h.resolve(ID,'bad"]');assert.equal(h.clicks.length,1);
  h.dispatch({source:h.window,origin:'https://evil.example',data:{__sfdl:'cs->page',type:'RESOLVE',reqId:2,id:ID}});
  assert.equal(h.clicks.length,1);
});
test('failed fetch keeps its original rejection', async () => {
  const h=setup();const err=new Error('network');h.fail(err);await assert.rejects(h.window.fetch('/'),e=>e===err);
});
test('SampleFocus embedded JSON resolver still returns the card-specific MP3', () => {
  const h=setup('samplefocus.com');const sample={id:42,slug:'test',name:'Existing',sample_mp3_url:'https://cdn.example/test.mp3'};
  h.document.querySelectorAll=()=>[{textContent:JSON.stringify({samples:[sample]})}];
  h.resolve('42',1,{slug:'test'});assert.equal(h.replies[0].url,sample.sample_mp3_url);assert.equal(h.replies[0].name,'Existing');
});
const SPLICE_ID = '2ec939ce4eedab680dd65df7fe419bed9084f6f4b4c139c00b2ad0bf82fa90c1';
const spliceUrl = (id = SPLICE_ID) => `https://spliceproduction.s3.us-west-1.amazonaws.com/audio_samples/${id}-scrambled/${id}.mp3`;
const spliceAsset = (url = spliceUrl(), kind = 'preview_mp3') => ({asset_type_slug:'sample',uuid:SPLICE_ID,name:'Pack/Drums/kick.wav', files:[{asset_file_type_slug:kind,url}]});
test('Splice reads serialized hydration response and preserves the individual sample identity', () => {
  const h=setup('splice.com');
  h.document.querySelectorAll=()=>[{textContent:JSON.stringify({body:JSON.stringify({data:{assetsSearch:{items:[spliceAsset()]}}})})}];
  h.resolve(SPLICE_ID);
  assert.equal(h.replies[0].url,spliceUrl());assert.equal(h.replies[0].name,'kick.wav');
});
test('Splice handles dynamically fetched sample results', async () => {
  const h=setup('splice.com');await h.fetch({data:{assetsSearch:{items:[spliceAsset()]}}});h.resolve(SPLICE_ID);
  assert.equal(h.replies[0].url,spliceUrl());
});
test('Splice excludes original files, mismatched sample URLs and expired signatures', async () => {
  for (const asset of [spliceAsset(spliceUrl(),'original'),spliceAsset(spliceUrl('a'.repeat(64))),spliceAsset(spliceUrl()+'?X-Amz-Date=20200101T000000Z&X-Amz-Expires=3600')]) {
    const h=setup('splice.com');await h.fetch({items:[asset]});h.resolve(SPLICE_ID);assert.equal(h.replies.length,0);
  }
});
test('Noiiz reads the current Vue row sample instead of the active global player', () => {
  const h=setup('www.noiiz.com');const row=h.row(1,'');
  row.__vue__={$props:{data:{id:136292,name:'test.wav',sample_type:'loop',lq_url:'https://d7d3471nr939s.cloudfront.net/pack/MP3/test.mp3'}}};
  h.document.querySelector=()=>row;h.resolve('');
  assert.equal(h.replies[0].url,row.__vue__.$props.data.lq_url);assert.equal(h.replies[0].name,'test.wav');
});
test('Noiiz excludes pack demos and untrusted URLs', () => {
  for (const data of [{name:'pack',lq_url:'https://d7d3471nr939s.cloudfront.net/demo.mp3'},{sample_type:'loop',lq_url:'https://evil.example/test.mp3'}]) {
    const h=setup('www.noiiz.com');const row=h.row(1,'');row.__vue__={$props:{data}};h.document.querySelector=()=>row;h.resolve('');assert.equal(h.replies[0].url,null);
  }
});
test('Noiiz ordinary rows use the rendered VNode ID even with duplicate filenames', () => {
  const h=setup('www.noiiz.com');const row=h.row(1,'');
  const items=[{id:1,name:'same.wav',sample_type:'loop',lq_url:'https://d7d3471nr939s.cloudfront.net/a.mp3'}, {id:2,name:'same.wav',sample_type:'loop',lq_url:'https://d7d3471nr939s.cloudfront.net/b.mp3'}];
  row.closest=()=>({__vue__:{$props:{items},_vnode:{children:[{elm:row,key:2}]}}});
  h.document.querySelector=()=>row;h.resolve('');assert.equal(h.replies[0].url,items[1].lq_url);
});
