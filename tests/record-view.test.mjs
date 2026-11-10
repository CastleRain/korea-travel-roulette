import test from 'node:test';
import assert from 'node:assert/strict';
import {recordPage,FRIENDS} from '../src/record-view.js';
const records=Array.from({length:17},(_,i)=>({id:i,travelerName:FRIENDS[i%4]}));
test('pagination includes all records once and clamps after the last page shrinks',()=>{
  assert.deepEqual([1,2,3].flatMap(p=>recordPage(records,'',p).items.map(r=>r.id)),records.map(r=>r.id));
  assert.equal(recordPage(records.slice(0,2),'',3).page,1);
  assert.equal(recordPage([], '', 1).pages,1);
});
test('friend filters do not mix identities or hide legacy records from the legacy filter',()=>{
  for(const person of FRIENDS) assert.ok(recordPage(records,person).items.every(r=>r.travelerName===person));
  assert.equal(recordPage([...records,{id:99},{id:100,travelerName:'이전 이름'}],'__legacy').total,2);
  assert.equal(recordPage(records,'없는 이름').total,0);
});
