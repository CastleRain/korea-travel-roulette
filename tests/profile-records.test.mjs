import test from 'node:test';
import assert from 'node:assert/strict';
import {TravelerProfile,normalizeTravelerName} from '../src/profile.js';
import {RecordService} from '../src/storage.js';

class MemoryLocal { records=new Map();async put(r){this.records.set(r.id,structuredClone(r));}async all(){return [...this.records.values()];} }
function candidate(name='주말여행자') { return {id:crypto.randomUUID(),travelerName:name,provinceId:'11',provinceName:'서울특별시',destinationId:'11110',destinationName:'종로구',fullName:'서울특별시 종로구',singleStage:false,dataVersion:'2026-10-01',drawnAt:new Date().toISOString()}; }

test('blank, invisible, control-character and overlength names are rejected',()=>{
  for(const name of ['', '   ', '\u200B', '민\u0000수', '가'.repeat(21), null]) assert.throws(()=>normalizeTravelerName(name));
  assert.equal(normalizeTravelerName('  주말   여행자  '),'주말 여행자');
});
test('nickname is remembered on next visit and stays usable when storage is blocked',()=>{
  const storage={value:null,getItem(){return this.value;},setItem(_key,value){this.value=value;}};
  const first=new TravelerProfile(storage);assert.equal(first.load(),'');first.set('민수');
  assert.equal(new TravelerProfile(storage).load(),'민수');
  const blocked=new TravelerProfile({getItem(){throw Error();},setItem(){throw Error();}});
  assert.equal(blocked.load(),'');blocked.set('여행자');assert.equal(blocked.name,'여행자');assert.equal(blocked.persistent,false);
});
test('draft creation and reconnection never upload unselected results',async()=>{
  const local=new MemoryLocal(),store=new RecordService(local);let calls=0;
  await store.connect({list:async()=>[],save:async()=>calls++});
  const a=candidate(),b=candidate();await store.stage(a);await store.stage(b);await store.sync();await store.syncOne((await store.candidates())[0]);
  assert.equal(calls,0);assert.equal((await store.list()).length,0);assert.equal((await store.candidates()).length,2);
  const reopened=new RecordService(local);await reopened.connect({list:async()=>[],save:async()=>calls++});
  assert.equal(calls,0);assert.equal((await reopened.candidates()).length,2);
});
test('only chosen IDs become saved records and duplicate selections never duplicate a record',async()=>{
  const local=new MemoryLocal(),store=new RecordService(local);const a=candidate('가람'),b=candidate('나래');
  await store.stage(a);await store.stage(b);const sent=[];await store.connect({list:async()=>[],save:async r=>sent.push(r)});
  assert.equal(await store.saveSelected([b.id,b.id,'missing']),1);assert.equal(sent.length,1);assert.equal(sent[0].id,b.id);
  assert.equal((await store.list())[0].travelerName,'나래');assert.equal((await store.candidates())[0].id,a.id);
  assert.equal(await store.saveSelected([b.id]),0);assert.equal(sent.length,1);
});
test('saved and unselected lists survive reopening without a schema migration',async()=>{
  const local=new MemoryLocal(),first=new RecordService(local),a=candidate(),b=candidate();
  await first.stage(a);await first.stage(b);await first.saveSelected([a.id]);
  const next=new RecordService(local);assert.equal((await next.list())[0].id,a.id);assert.equal((await next.candidates())[0].id,b.id);
});
test('rename only affects future draws; approved records preserve original name',async()=>{
  const profile=new TravelerProfile({setItem(){}}),store=new RecordService(new MemoryLocal());
  profile.set('처음 이름');const a=candidate(profile.name);await store.stage(a);profile.set('새 이름');
  const b=candidate(profile.name);await store.stage(b);await store.saveSelected([a.id]);
  assert.equal((await store.list())[0].travelerName,'처음 이름');assert.equal((await store.candidates())[0].travelerName,'새 이름');
});
test('legacy saved records are preserved and are never renamed or turned back into candidates',async()=>{
  const local=new MemoryLocal(),store=new RecordService(local),old=candidate();delete old.travelerName;
  await local.put({...old,syncState:'pending'});await store.stage({...old,travelerName:'새 이름'});
  assert.equal((await store.list()).length,1);assert.equal((await store.candidates()).length,0);assert.ok(!('travelerName' in (await store.list())[0]));
});
test('cloud failure keeps only explicitly chosen records in retry outbox',async()=>{
  const store=new RecordService(new MemoryLocal()),a=candidate(),b=candidate();await store.stage(a);await store.stage(b);
  await store.connect({list:async()=>[],save:async()=>{throw Error('offline');}});await store.saveSelected([a.id]);
  assert.equal((await store.list())[0].syncState,'pending');assert.equal((await store.candidates())[0].id,b.id);
  const sent=[];store.remote={save:async r=>sent.push(r)};await store.sync();assert.deepEqual(sent.map(r=>r.id),[a.id]);
});
test('invalid names cannot enter candidate storage',async()=>{
  const store=new RecordService(new MemoryLocal());await assert.rejects(()=>store.stage(candidate('   ')));
  assert.equal((await store.candidates()).length,0);
});
