// Run ONLY against demo emulator: firebase emulators:exec --only firestore --project demo-travel-roulette "node --test tests/firestore.integration.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
const project='demo-travel-roulette', host=process.env.FIRESTORE_EMULATOR_HOST;
if(!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw Error('Local emulator required');
const base=`http://${host}/v1/projects/${project}/databases/(default)/documents`;
function token(uid) {const now=Math.floor(Date.now()/1000);return [Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({iss:`https://securetoken.google.com/${project}`,aud:project,sub:uid,user_id:uid,iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'anonymous',identities:{}}})).toString('base64url'),''].join('.');}
const id=crypto.randomUUID();
function payload(drawId=id){return {id:drawId,provinceId:'11',provinceName:'서울특별시',destinationId:'11110',destinationName:'종로구',fullName:'서울특별시 종로구',singleStage:false,dataVersion:'2026-10-01',drawnAt:new Date().toISOString()};}
function value(v){return typeof v==='boolean'?{booleanValue:v}:{stringValue:v};}
async function write({uid='alice',owner='alice',drawId=id,data=payload(drawId),auth=true,path=`users/${owner}/draws/${drawId}`}={}){
  return fetch(`${base}:commit`,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token(uid)}`}:{})},body:JSON.stringify({writes:[{update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,value(v)]))},updateTransforms:[{fieldPath:'savedAt',setToServerValue:'REQUEST_TIME'}]}]})});
}
test('unauthenticated writes are denied',async()=>assert.equal((await write({auth:false})).status,403));
test('another user cannot write under someone else',async()=>assert.equal((await write({uid:'bob'})).status,403));
test('extra fields and invalid payloads are denied',async()=>{
  assert.equal((await write({data:{...payload(),admin:true}})).status,403);
  assert.equal((await write({data:{...payload(),provinceName:'x'.repeat(100)}})).status,403);
});
test('owner can write and read persisted draw; others cannot read or overwrite',async()=>{
  const result=await write();assert.equal(result.status,200,await result.text());
  const url=`${base}/users/alice/draws/${id}`;
  const ownerRead=await fetch(url,{headers:{Authorization:`Bearer ${token('alice')}`}});assert.equal(ownerRead.status,200);
  const saved=await ownerRead.json();assert.equal(saved.fields.fullName.stringValue,'서울특별시 종로구');assert.ok(saved.fields.savedAt.timestampValue);
  assert.equal((await fetch(url,{headers:{Authorization:`Bearer ${token('bob')}`}})).status,403);
  assert.equal((await fetch(url)).status,403);assert.equal((await write()).status,403);
});
test('owner can query own last 100 records, not unbounded collection',async()=>{
  async function query(owner,limit){return fetch(`${base}/users/${owner}:runQuery`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token('alice')}`},body:JSON.stringify({structuredQuery:{from:[{collectionId:'draws'}],orderBy:[{field:{fieldPath:'drawnAt'},direction:'DESCENDING'}],...(limit?{limit}:{})}})});}
  assert.equal((await query('alice',100)).status,200);assert.equal((await query('alice')).status,403);assert.equal((await query('bob',100)).status,403);
});
test('owner can save display name; a matching name never grants another user access',async()=>{
  const drawId=crypto.randomUUID(),data={...payload(drawId),travelerName:'주말여행자'};
  const result=await write({drawId,data});assert.equal(result.status,200,await result.text());
  const url=`${base}/users/alice/draws/${drawId}`;
  const saved=await (await fetch(url,{headers:{Authorization:`Bearer ${token('alice')}`}})).json();
  assert.equal(saved.fields.travelerName.stringValue,'주말여행자');
  assert.equal((await fetch(url,{headers:{Authorization:`Bearer ${token('bob')}`}})).status,403);
  assert.equal((await write({uid:'bob',drawId:crypto.randomUUID(),data:{...payload(),travelerName:'주말여행자'}})).status,403);
});
test('empty, whitespace-only, overlength or incorrectly typed display names are denied',async()=>{
  for(const travelerName of ['', '   ', '가'.repeat(21), true]) {
    const drawId=crypto.randomUUID();assert.equal((await write({drawId,data:{...payload(drawId),travelerName}})).status,403);
  }
});

test('two anonymous devices share a room selection, with immutable scoped writes',async()=>{
  const room='a'.repeat(32), name='지태근', drawId=crypto.randomUUID();
  const path=`tripRooms/${room}/travelers/${name}/draws/${drawId}`;
  const data={...payload(drawId),roomId:room,travelerName:name,ownerUid:'alice'};
  assert.equal((await write({path,data,auth:false})).status,403);
  assert.equal((await write({path,data:{...data,travelerName:'장성우'}})).status,403);
  assert.equal((await write({path,data:{...data,roomId:'b'.repeat(32)}})).status,403);
  assert.equal((await write({path,data})).status,200);
  assert.equal((await fetch(base+'/'+path,{headers:{Authorization:'Bearer '+token('bob')}})).status,200);
  assert.equal((await fetch(base+'/'+path)).status,403);
  assert.equal((await write({uid:'bob',path,data})).status,403);
});

test('only one final selection can win for a friend, including concurrent requests', async()=>{
  const room='b'.repeat(32), name='장성우', prefix=`tripRooms/${room}/travelers/${name}/draws/`;
  const draw=(uid='alice')=>({...payload(crypto.randomUUID()),roomId:room,travelerName:name,ownerUid:uid});
  const responses=await Promise.all(['alice','bob'].map(uid=>write({uid,path:prefix+'final',data:draw(uid)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,403]);
  const another=draw();
  assert.equal((await write({path:prefix+another.id,data:another})).status,403);
});

test('only the creator can delete a new final and then draw again',async()=>{
  const room='c'.repeat(32), name='이주열', path=`tripRooms/${room}/travelers/${name}/draws/final`;
  const data={...payload(crypto.randomUUID()),roomId:room,travelerName:name,ownerUid:'alice'};
  const remove=uid=>fetch(base+'/'+path,{method:'DELETE',headers:{Authorization:'Bearer '+token(uid)}});
  assert.equal((await write({path,data})).status,200);
  assert.equal((await remove('bob')).status,403);
  assert.equal((await remove('alice')).status,200);
  assert.equal((await write({path,data:{...data,id:crypto.randomUUID()}})).status,200);
});

test('four friends vote once, ties require a runoff among leaders and a winner ends voting',async()=>{
  const friends=['지태근','장성우','이주열','성석근'], room=crypto.randomUUID().replaceAll('-','');
  const ids=friends.map(()=>crypto.randomUUID()), epoch=ids.join('_');
  const all=['A','B','C','D'];
  async function ballot(n,voter,votes,uid=voter) {
    const fields={n:{integerValue:n},voter:value(friends[voter]),refs:{arrayValue:{values:friends.map(()=>value('final'))}},
      votes:{mapValue:{fields:Object.fromEntries(votes.map((v,i)=>[friends[i],value(v)]))}}};
    return (await fetch(base+'/tripRooms/'+room+'/polls/'+epoch+'/rounds/'+n,{method:'PATCH',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token('u'+uid)},body:JSON.stringify({fields})})).status;
  }
  for(const [i,name] of friends.entries()){
    assert.equal(await ballot(1,0,['A']),403);
    const data={...payload(ids[i]),roomId:room,travelerName:name,ownerUid:'u'+i,destinationId:all[i]};
    assert.equal((await write({uid:'u'+i,path:`tripRooms/${room}/travelers/${name}/draws/final`,data})).status,200);
  }
  assert.equal(await ballot(1,0,['A'],1),403);
  assert.equal(await ballot(1,0,['A']),200);
  assert.equal(await ballot(1,0,['B']),403);
  assert.equal(await ballot(2,0,['A']),403);
  assert.equal(await ballot(1,1,['A','A']),200);
  assert.equal(await ballot(1,2,['A','A','B']),200);
  assert.equal(await ballot(1,3,['A','A','B','B']),200);
  assert.equal(await ballot(2,0,['C']),403);
  for(let i=0;i<4;i++)assert.equal(await ballot(2,i,Array(i+1).fill('B')),200);
  assert.equal(await ballot(3,0,['B']),403);
});
