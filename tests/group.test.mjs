import test from 'node:test';
import assert from 'node:assert/strict';
import {drawOptions, historyFor} from '../src/group.js';
test('drawing exhausts small scopes without duplicates or retry loops',()=>{
  const p={id:'a', destinations:[{id:'1'},{id:'2'}]};
  assert.deepEqual(drawOptions([p],()=>0).map(o=>o.destination.id),['1','2']);
  assert.deepEqual(drawOptions([p,{id:'b',destinations:[{id:'3'},{id:'4'}]}],()=>0).map(o=>o.destination.id),['1','2','3']);
});
test('history merges live selections and private legacy history only for the active friend and room',()=>{
  const base={id:'1',travelerName:'지태근',drawnAt:'2026-11-11',roomId:'a'};
  const mine=[base,{...base,id:'2',roomId:'b'},{...base,id:'3',travelerName:'장성우'},{...base,id:'4',roomId:undefined}];
  assert.deepEqual(historyFor(mine,[{...base,syncState:'synced'}],'지태근','a').map(r=>r.id),['1','4']);
});
