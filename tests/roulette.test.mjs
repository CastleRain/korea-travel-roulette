import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Roulette,STATES,uniformIndex,validateCatalog,makeRecord} from '../src/roulette.js';
import {RecordService} from '../src/storage.js';
const data=validateCatalog(JSON.parse(await readFile(new URL('../public/data/regions.json',import.meta.url))));

function harness(provinces=data.provinces,pick=()=>0){
  const timers=new Map();let next=0;const completed=[];
  const roulette=new Roulette(provinces,{pick,schedule:callback=>{timers.set(++next,callback);return next;},cancel:id=>timers.delete(id),completed:r=>completed.push(r)});
  return {roulette,timers,completed,tick(){const [id,cb]=timers.entries().next().value;timers.delete(id);cb();}};
}

test('pinned full catalog has 16 provinces / 230 final destinations with unique IDs',()=>{
  assert.equal(data.version,'2026-10-01');assert.equal(data.provinces.length,16);
  assert.equal(data.provinces.flatMap(p=>p.destinations).length,230);
  const ids=data.provinces.flatMap(p=>p.destinations.map(d=>d.id));assert.equal(new Set(ids).size,ids.length);
  for(const p of data.provinces) for(const d of p.destinations){
    assert.equal(d.provinceId,p.id);assert.ok(d.bounds.every(Number.isFinite));
    assert.ok(d.bounds[0]>=0&&d.bounds[2]<=640&&d.bounds[1]>=0&&d.bounds[3]<=650,`${p.name} ${d.name} outside map`);
  }
});
test('Sejong completes without nonexistent second-level candidates',()=>{
  const p=data.provinces.find(p=>p.name==='세종특별자치시');const h=harness([p]);
  h.roulette.start();h.roulette.stop();
  assert.equal(h.roulette.state,STATES.COMPLETE);assert.equal(h.completed.length,1);assert.equal(h.timers.size,0);
  assert.equal(h.roulette.rerollDistrict(),false);h.roulette.stop();assert.equal(h.completed.length,1);
});
test('Jeju has only its two administrative cities',()=>{
  const p=data.provinces.find(p=>p.name==='제주특별자치도');assert.deepEqual(p.destinations.map(d=>d.name),['서귀포시','제주시']);
});
test('general districts are merged into a city; islands and updated regions are included',()=>{
  const names=data.provinces.flatMap(p=>p.destinations.map(d=>d.name));
  assert.ok(names.includes('수원시'));assert.ok(!names.includes('수원시장안구'));
  for (const name of ['울릉군','옹진군','강화군','화성시','군위군','영종구','제물포구','검단구','서해구']) assert.ok(names.includes(name),name);
  assert.equal(data.provinces.find(p=>p.destinations.some(d=>d.name==='군위군')).name,'대구광역시');
  assert.ok(data.provinces.some(p=>p.name==='전남광주통합특별시'));
});
test('every province can complete; final result equals displayed candidate and parent matches',()=>{
  for(const p of data.provinces){const h=harness([p],length=>length-1);h.roulette.start();h.roulette.stop();
    if(!p.singleStage){assert.equal(h.roulette.state,STATES.TRANSITION);h.tick();const displayed=h.roulette.current;h.roulette.stop();assert.equal(h.roulette.destination,displayed);}
    assert.equal(h.completed.length,1);assert.equal(h.completed[0].destination.provinceId,p.id);assert.equal(h.timers.size,0);
  }
});
test('stop before start and stop during transition are ignored',()=>{
  const h=harness();assert.equal(h.roulette.stop(),false);h.roulette.start();h.roulette.stop();
  for(let i=0;i<20;i++)assert.equal(h.roulette.stop(),false);
  assert.equal(h.completed.length,0);assert.equal(h.timers.size,1);
});
test('restart cancels timers, and stale callbacks cannot mutate new run',()=>{
  const h=harness();h.roulette.start();const stale=[...h.timers.values()][0];
  h.roulette.reset();assert.equal(h.timers.size,0);h.roulette.start();const current=h.roulette.current;stale();
  assert.equal(h.roulette.current,current);assert.equal(h.timers.size,1);
  h.roulette.stop();const staleTransition=[...h.timers.values()][0];h.roulette.reset();staleTransition();assert.equal(h.roulette.state,STATES.READY);assert.equal(h.timers.size,0);
});
test('100 restarts never leave multiple spin timers',()=>{
  const h=harness();for(let i=0;i<100;i++){h.roulette.start();h.tick();assert.equal(h.timers.size,1);h.roulette.reset();assert.equal(h.timers.size,0);}
});
test('scope is enforced and empty scope is rejected',()=>{
  const h=harness();assert.throws(()=>h.roulette.start([]),/一| 하나/);
  h.roulette.start([data.provinces.at(-1).id]);assert.equal(h.roulette.current.id,data.provinces.at(-1).id);
});
test('district reroll retains province and produces exactly one additional completed result',()=>{
  const h=harness();h.roulette.start();h.roulette.stop();h.tick();h.roulette.stop();const p=h.roulette.province;
  assert.equal(h.roulette.rerollDistrict(),true);assert.equal(h.roulette.province,p);h.roulette.stop();assert.equal(h.completed.length,2);
});
test('rejection sampling discards biased tail',()=>{
  let count=0;const source={getRandomValues(a){a[0]=count++===0?0xffffffff:8;}};
  assert.equal(uniformIndex(3,source),2);assert.equal(count,2);assert.throws(()=>uniformIndex(0),RangeError);
});
test('invalid and mismatched catalogs cannot start',()=>{
  assert.throws(()=>validateCatalog({}),/지역/);
  const copy=structuredClone(data);copy.provinces[0].destinations[0].provinceId='bad';assert.throws(()=>validateCatalog(copy),/하위/);
});
test('record contains stable id and complete names; rejects wrong province',()=>{
  const p=data.provinces[0],d=p.destinations[0];const r=makeRecord(p,d,data.version,{id:'fixed',now:new Date('2026-11-10T01:00:00Z')});
  assert.equal(r.id,'fixed');assert.equal(r.fullName,`${p.name} ${d.name}`);assert.equal(r.drawnAt,'2026-11-10T01:00:00.000Z');
  assert.throws(()=>makeRecord(p,data.provinces[1].destinations[0],data.version),/일치/);
});

class MemoryLocal { records=new Map();async put(r){this.records.set(r.id,structuredClone(r));}async all(){return [...this.records.values()];} }
const record=()=>makeRecord(data.provinces[0],data.provinces[0].destinations[0],data.version);
test('unconfigured cloud retains pending records, never falsely marks synced',async()=>{
  const local=new MemoryLocal(),store=new RecordService(local);await store.save(record());assert.equal((await store.list())[0].syncState,'pending');
});
test('cloud failure remains pending and can be retried with identical id',async()=>{
  const local=new MemoryLocal(),store=new RecordService(local);const r=record();await store.save(r);
  store.remote={save:async()=>{throw Object.assign(new Error('Offline'),{code:'unavailable'});}};await store.sync();
  assert.equal((await store.list())[0].syncState,'pending');const sent=[];store.remote={save:async r=>sent.push(r)};await store.sync();
  assert.equal((await store.list())[0].syncState,'synced');assert.equal(sent[0].id,r.id);assert.ok(!('syncState'in sent[0]));
});
test('only successful server acknowledgement changes saved state',async()=>{
  let release;const local=new MemoryLocal(),store=new RecordService(local);store.remote={save:()=>new Promise(resolve=>release=resolve)};
  const task=store.save(record());await new Promise(resolve=>setImmediate(resolve));assert.equal((await store.list())[0].syncState,'pending');release();await task;assert.equal((await store.list())[0].syncState,'synced');
});
test('concurrent retries do not duplicate writes',async()=>{
  let release,count=0;const local=new MemoryLocal(),store=new RecordService(local);const r=record();await store.save(r);
  store.remote={save:()=>{count++;return new Promise(resolve=>release=resolve);}};
  const first=store.sync();await new Promise(resolve=>setImmediate(resolve));const second=store.sync();await second;release();await first;assert.equal(count,1);
});
test('connecting merges remote history and sends local outbox without erasing either',async()=>{
  const local=new MemoryLocal(),store=new RecordService(local),a=record(),b=record();await store.save(a);let saved;
  await store.connect({list:async()=>[b],save:async r=>saved=r});assert.equal((await store.list()).length,2);assert.equal(saved.id,a.id);assert.ok((await store.list()).every(r=>r.syncState==='synced'));
});
test('blocked browser storage still retains current-session result for export',async()=>{
  const messages=[];const store=new RecordService({all:async()=>{throw Error();},put:async()=>{throw Error();}},{notify:m=>messages.push(m)});
  await store.save(record());assert.equal((await store.list()).length,1);assert.ok(messages.some(Boolean));
});
