import { validateCatalog } from './roulette.js';
import { LocalRecords, RecordService } from './storage.js';
import { connectFirebase } from './firebase.js';
import { firebaseConfig } from '../firebase-config.js';
import { currentRoom, historyFor, drawPool } from './group.js';
import { setupRound } from './round-ui.js';
import { recordPage, FRIENDS } from './record-view.js';

const $ = id=>document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
const room = currentRoom();
let catalog, round, service, selectedIds = [], name = '', pageNumber = 1;
let savedRecords = [], sharedRecords = new Map(), firebaseState = 'connecting', unsubscribe;
let localAvailable = false, listGeneration = 0, toastTimer, enterHeld = false;
// Jeju is shown in a labeled inset southeast of the mainland.
const jejuOffset = [220,-87];
const homeBounds = [98,4,440,486];
let excludeIslands=false, deleting=false;
let currentView, cloud, manualView=false, candidatePoints=[], pawnPoints=[];
function mapPoint(province, destination) {
  const [x,y]=destination.labelPoint;
  return province.id==='50' ? [x+jejuOffset[0],y+jejuOffset[1]] : [x,y];
}
function fitMap() {
  if(manualView)return;
  const [left,top,right,bottom]=homeBounds;
  const points=[...candidatePoints,...pawnPoints];
  const x=Math.min(left,...points.map(p=>p[0]-24)),y=Math.min(top,...points.map(p=>p[1]-33));
  const r=Math.max(right,...points.map(p=>p[0]+24)),b=Math.max(bottom,...points.map(p=>p[1]+22));
  currentView=[x,y,r-x,b-y];applyView();
}
const colors = ['#973d55','#21637a','#977022','#3c7055'];
const shortNames = {'서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종','경기도':'경기','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남','전북특별자치도':'전북','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주','전남광주통합특별시':'전남광주'};
const dateFormat = new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});

function toast(message) {
  $('toast').textContent=message; $('toast').hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500);
}
function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className=className;
  if (text !== undefined) result.textContent=text;
  return result;
}
function icon(name) {
  const element=node('i',`bi bi-${name}`);element.setAttribute('aria-hidden','true');return element;
}
function svgNode(tag, attributes) {
  const result=document.createElementNS(ns,tag);
  for (const [name,value] of Object.entries(attributes)) result.setAttribute(name,String(value));
  return result;
}
function applyView() {
  const svg=$('korea-map');
  svg.setAttribute('viewBox',currentView.join(' '));
  const scale=svg.getScreenCTM()?.a;
  if(scale>0) svg.style.setProperty('--map-label-size',`${12/scale}px`);
}

function setupMapNavigation(svg) {
  let gesture=null, suppressClick=false;
  function move(x,y,width,height) {
    manualView=true;
    // Keep part of the mapped territory reachable at every zoom level.
    currentView=[Math.max(12-width*.8,Math.min(590-width*.2,x)),
      Math.max(12-height*.8,Math.min(485-height*.2,y)),width,height];
    applyView();
  }
  svg.addEventListener('pointerdown',event=>{
    if(!event.isPrimary || event.button!==0)return;
    suppressClick=false;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,view:[...currentView],scale:svg.getScreenCTM().a,drag:false};
  });
  svg.addEventListener('pointermove',event=>{
    if(!gesture || event.pointerId!==gesture.id)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!gesture.drag && Math.hypot(dx,dy)<5)return;
    if(!gesture.drag){
      gesture.drag=true;svg.setPointerCapture(event.pointerId);svg.classList.add('panning');
    }
    const [x,y,w,h]=gesture.view;
    move(x-dx/gesture.scale,y-dy/gesture.scale,w,h);
  });
  function end(event){
    if(!gesture || event.pointerId!==gesture.id)return;
    suppressClick=gesture.drag;
    gesture=null;svg.classList.remove('panning');
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(type,end);
  svg.addEventListener('pointerleave',event=>{if(gesture && !gesture.drag)end(event);});
  svg.addEventListener('click',event=>{
    if(suppressClick && event.detail){event.stopImmediatePropagation();event.preventDefault();suppressClick=false;}
  },true);
  svg.addEventListener('keydown',event=>{
    if(event.target!==svg)return;
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(!delta)return;
    event.preventDefault();
    const [x,y,w,h]=currentView;
    move(x+delta[0]*w*.12,y+delta[1]*h*.12,w,h);
  });
  new ResizeObserver(()=>{if(currentView)applyView();}).observe(svg);
}
function setupMap() {
  const svg=$('korea-map');
  for (const p of catalog.provinces) {
    const path=svgNode('path',{d:p.path,class:'province-path',id:`map-${p.id}`});
    if(p.id==='50'){
      svg.append(svgNode('rect',{x:352,y:389,width:76,height:97,rx:7,class:'jeju-frame'}));
      path.setAttribute('transform',`translate(${jejuOffset.join(' ')})`);
    }
    const title=svgNode('title',{}); title.textContent=p.name;path.append(title);svg.append(path);
  }
  const districts=svgNode('g',{id:'selected-district'});svg.append(districts);
  const labels=svgNode('g',{id:'province-labels'});
  for (const p of catalog.provinces) {
    let [x,y]=mapPoint(p,p);
    // Readability offsets only; boundary polygons retain their actual positions.
    const offsets={'서울특별시':[-13,-4],'인천광역시':[-15,7],'세종특별자치시':[-16,-9],'대전광역시':[13,8]};
    if (offsets[p.name]) { x+=offsets[p.name][0];y+=offsets[p.name][1]; }
    const label=svgNode('text',{x,y,'text-anchor':'middle',class:'map-label',id:`label-${p.id}`});
    label.textContent=p.id==='50'?'제주 (별도 표시)':shortNames[p.name]||p.shortName;labels.append(label);
  }
  svg.append(labels);svg.append(districts);fitMap();setupMapNavigation(svg);
  $('map-title').textContent='대한민국 행정구역 지도 · 아직 선택된 지역 없음';
}
function preview(options, interactive=false, selected=-1) {
  const shapes=$('selected-district'), markers=svgNode('g',{});
  const picks=$('province-picks');
  picks.replaceChildren();picks.hidden=true;
  for (const province of catalog.provinces) {
    const region=$('map-'+province.id);
    const indices=interactive ? options.flatMap((o,i)=>o.province.id===province.id?[i]:[]) : [];
    region.classList.toggle('has-candidate',indices.length>0);
    region.onclick=indices.length ? ()=>{
      if(indices.length===1) {round.select(indices[0]);return;}
      picks.replaceChildren(...indices.map(i=>{
        const choice=node('button','btn btn-sm btn-outline-secondary',`${i+1} · ${options[i].destination.name}`);
        choice.onclick=()=>round.select(i);return choice;
      }));
      picks.hidden=false;picks.firstElementChild.focus({preventScroll:true});
    } : null;
  }
  shapes.replaceChildren();
  candidatePoints=[];
  options.forEach(({province,destination},i)=>{
    const active=i===selected;
    const path=svgNode('path',{d:destination.path,class:'route-preview'+(active?' picked':'')});
    if(province.id==='50')path.setAttribute('transform',`translate(${jejuOffset.join(' ')})`);
    shapes.append(path);
    if(!interactive)return;
    path.onclick=()=>round.select(i);
    path.style.cursor='pointer';
    const [x,y]=mapPoint(province,destination);
    let px=x;
    while(candidatePoints.some(([a,b])=>Math.abs(px-a)<31 && Math.abs(y-b)<30))px+=32;
    candidatePoints.push([px,y],[x,y]);
    const button=svgNode('g',{class:'map-option'+(active?' picked':''),role:'button',tabindex:0,
      'aria-label':`후보 ${i+1} · ${province.name} ${destination.name}`,'aria-pressed':active});
    const label=svgNode('text',{x:px,y:y+4,'text-anchor':'middle'});label.textContent=i+1;
    button.append(svgNode('line',{x1:x,y1:y,x2:px,y2:y}),svgNode('circle',{cx:px,cy:y,r:22,class:'touch-target'}),svgNode('circle',{cx:px,cy:y,r:15}),label);
    button.onclick=()=>round.select(i);
    button.onkeydown=event=>{
      if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();round.select(i);shapes.querySelectorAll('[role="button"]')[i].focus();}
    };
    markers.append(button);
  });
  shapes.append(markers);
  $('map-confirm').hidden=!interactive;
  $('map-confirm').disabled=selected<0;
  $('map-confirm').textContent=!interactive || selected<0?'지도에서 후보 선택':options[selected].destination.name+' 최종 확정';
  $('map-badge').textContent=options.length?`후보 ${options.length}곳`:'여행 지도';
  fitMap();
}

function finalRecord() {
  return visibleRecords().find(r=>r.roomId===room);
}
function visibleRecords(friend=name) {
  const local=savedRecords.filter(r=>!r.roomId || r.syncState!=='synced');
  return historyFor(local, sharedRecords.get(friend) || [], friend, room);
}
function renderPins() {
  if (!catalog || !$('province-labels')) return;
  let layer = $('friend-pins');
  if (!layer) {layer=svgNode('g',{id:'friend-pins'});$('korea-map').append(layer);}
  layer.replaceChildren();
  $('pawn-legend').replaceChildren();
  const placed=[];pawnPoints=[];
  for (const [index,friend] of FRIENDS.entries()) {
    const record=visibleRecords(friend).find(r=>r.roomId===room);
    const province=catalog.provinces.find(p=>p.id===record?.provinceId);
    const destination=province?.destinations.find(d=>d.id===record.destinationId);
    const chip=node('span','pawn-key');
    chip.style.setProperty('--pawn',colors[index]);
    chip.append(node('b','', '♟'),document.createTextNode(friend+' · '+(destination?.name||'미정')));
    $('pawn-legend').append(chip);
    if (!destination) continue;
    const [x,y]=mapPoint(province,destination);
    let px=x;
    while(placed.some(([a,b])=>Math.abs(a-px)<26 && Math.abs(b-y)<32)) px+=28;
    placed.push([px,y]);pawnPoints.push([px,y]);
    const group=svgNode('g',{'aria-label':friend+' '+record.fullName});
    const title=svgNode('title',{});title.textContent=friend+' · '+record.fullName;
    group.append(title,svgNode('line',{x1:x,y1:y,x2:px,y2:y-7,stroke:colors[index],'stroke-width':2}));
    const pawn=svgNode('g',{transform:`translate(${px} ${y-6})`,fill:colors[index],stroke:'white','stroke-width':1.6});
    pawn.append(svgNode('path',{d:'M-10 0 Q-12 -3 -7 -5 Q-3 -11 -3 -15 L3 -15 Q3 -11 7 -5 Q12 -3 10 0Z'}),svgNode('circle',{cx:0,cy:-19,r:6}));
    group.append(pawn);layer.append(group);
  }
  fitMap();
  $('map-title').textContent='대한민국 여행 지도. 친구별 여행지는 지도 아래 범례에 표시됩니다.';
}
function canRemove(record) {
  return cloud && (!record.ownerUid || record.ownerUid===cloud.uid);
}
async function clearRecords(records) {
  if(deleting || !records.length)return;
  const person=name;
  const shared=records.some(r=>r.roomId);
  if(!window.confirm(`${person} 님의 여행 기록 ${records.length}개를 삭제할까요?`+
    (shared?' 이 방의 마지막 확정 기록을 지우면 지도 말도 사라지고 다시 뽑을 수 있어요.':'')))return;
  deleting=true;renderRecords();
  let count=0;
  try{
    for(const record of records){
      await service.remove(record);
      if(record.roomId)sharedRecords.set(person,(sharedRecords.get(person)||[]).filter(r=>r.id!==record.id));
      count++;
    }
    toast(`${count}개 기록을 삭제했어요.`);
  }catch{toast(`${count}개 삭제됨 · 연결과 삭제 권한을 확인하고 다시 시도해주세요.`);}
  finally{deleting=false;await refreshHistory();}
}
function renderRecords() {
  const records=visibleRecords();
  const page=recordPage(records,name,pageNumber);
  pageNumber=page.page;
  $('history-count').textContent=records.length;
  $('history-owner').textContent=name ? name+' 님이 선택한 여행지' : '친구를 선택해주세요';
  $('records-page').textContent=`${page.page} / ${page.pages} · ${records.length}개`;
  $('records-prev').disabled=page.page===1;
  $('records-next').disabled=page.page===page.pages;
  $('export-records').disabled=!records.length;
  const removable=records.filter(canRemove);
  $('clear-history').hidden=removable.length<2;
  $('clear-history').disabled=deleting;
  $('clear-history').onclick=()=>clearRecords(removable);
  const rows=page.items.map(record=>{
    const row=node('article','history-row list-group-item');
    const info=node('div','history-info');
    const meta=node('div','record-metadata');
    meta.append(node('time','',dateFormat.format(new Date(record.drawnAt))),node('span','save-tag',record.syncState==='pending'?'동기화 대기':record.roomId?'공유 지도':'개인 기록'));
    info.append(node('h3','',record.fullName),meta);
    const link=node('a','history-map-link btn btn-light');
    link.href='https://map.naver.com/p/search/'+encodeURIComponent(record.fullName);
    link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',record.fullName+' 지도 검색');link.append(icon('arrow-up-right'));
    row.append(info,link);
    if(canRemove(record)){
      const remove=node('button','btn btn-sm btn-light');remove.append(icon('trash'));
      remove.setAttribute('aria-label',record.fullName+' 기록 삭제');remove.title='기록 삭제';
      remove.disabled=deleting;remove.onclick=()=>clearRecords([record]);row.append(remove);
    }
    return row;
  });
  $('history-list').replaceChildren(...(rows.length?rows:[node('p','empty-state','후보 중 한 곳을 확정하면 여기에 남아요.')]));
  renderPins();round?.finish(finalRecord());
}

function setupProfile() {
  function choose(friend) {
    name=friend;pageNumber=1;
    $('profile-dialog').close();
    $('profile-name').textContent=friend;
    $('profile-cancel').hidden=false;
    $('active-traveler').textContent=friend+' 님의 차례';
    for(const b of $('traveler-choices').children) {
      b.classList.toggle('active',b.textContent===friend);
      b.setAttribute('aria-pressed',String(b.textContent===friend));
    }
    round?.reset(true);renderRecords();
  }
  for(const friend of FRIENDS) for(const id of ['traveler-choices','profile-choices']) {
    const button=node('button','btn btn-outline-secondary',friend);
    button.type='button';button.onclick=()=>choose(friend);$(id).append(button);
  }
  $('profile-open').setAttribute('aria-label','친구 선택');
  $('profile-open').onclick=()=>$('profile-dialog').showModal();
  $('profile-dialog').addEventListener('cancel',e=>{if(!name)e.preventDefault();});
  $('profile-dialog').showModal();
}
async function refreshHistory(message) {
  if(message) toast(message);
  const generation=++listGeneration;
  const records=await service.list();
  if(generation!==listGeneration)return;
  savedRecords=records;
  const pending=records.filter(r=>r.syncState==='pending').length;
  $('storage-status').textContent=pending?`${pending}개 동기화 대기`:firebaseState==='connected'?'클라우드 연결됨':'클라우드 연결 확인 중';
  $('storage-explanation').textContent=!localAvailable||service.localFailed?'브라우저 저장이 제한되어 있습니다. 기록을 내려받아 보관하세요.':'같은 초대 링크에서 확정한 여행지를 함께 봅니다.';
  $('sync-records').hidden=firebaseState==='connected'&&!pending;
  $('sync-records').disabled=firebaseState==='connecting';
  renderRecords();
}
function withTimeout(promise,ms=20000) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Firebase 응답 시간이 초과되었습니다.')),ms);})]).finally(()=>clearTimeout(timer));
}
let connectionTask;
async function initializeCloud() {
  if(!firebaseConfig || connectionTask) return connectionTask;
  firebaseState='connecting';refreshHistory();
  connectionTask=(async()=>{
    try {
      const remote=await withTimeout(connectFirebase(firebaseConfig));
      await withTimeout(service.connect(remote));
      cloud=remote;unsubscribe?.();
      unsubscribe=remote.watch(room, FRIENDS, (friend,records)=>{
        sharedRecords.set(friend,records);renderRecords();
        if(sharedRecords.size===FRIENDS.length && firebaseState!=='error') $('map-caption').textContent='친구들의 선택을 실시간으로 표시 중';
      },()=>{firebaseState='error';$('map-caption').textContent='공유 지도 연결 실패 · 다시 저장을 눌러주세요';refreshHistory();});
      firebaseState='connected';
    } catch(error) {
      firebaseState='error';$('map-caption').textContent='공유 지도 연결 실패';
      toast(`Firebase 연결을 확인해주세요. ${error.code||error.message}`);
    } finally { connectionTask=null;refreshHistory(); }
  })();
  return connectionTask;
}

function setupScope() {
  for (const p of catalog.provinces) {
    const label=node('label','scope-option');const input=node('input','form-check-input');input.type='checkbox';input.value=p.id;input.checked=true;
    label.append(input,document.createTextNode(p.name));$('province-options').append(label);
  }
  $('scope-open').addEventListener('click',()=>{
    $('exclude-islands').checked=excludeIslands;
    for(const input of $('province-options').querySelectorAll('input')) input.checked=selectedIds.includes(input.value);
    $('scope-error').textContent='';$('scope-dialog').showModal();
  });
  $('select-all').addEventListener('click',()=>{for(const i of $('province-options').querySelectorAll('input')) i.checked=true;});
  $('select-none').addEventListener('click',()=>{for(const i of $('province-options').querySelectorAll('input')) i.checked=false;});
  $('apply-scope').addEventListener('click',()=>{
    const ids=[...$('province-options').querySelectorAll('input:checked')].map(i=>i.value);
    if(!ids.length){$('scope-error').textContent='추첨할 시·도를 하나 이상 선택해주세요.';return;}
    const exclude=$('exclude-islands').checked;
    if(!drawPool(catalog.provinces,ids,exclude).length){$('scope-error').textContent='섬 제외 후 남는 여행지가 없습니다. 다른 시·도를 추가해주세요.';return;}
    excludeIslands=exclude;
    selectedIds=ids;$('scope-count').textContent=ids.length===catalog.provinces.length?'전체':`${ids.length}개 시·도`;
    if(excludeIslands)$('scope-count').textContent+=' · 섬 제외';
    $('scope-dialog').close();round.reset();toast(`${ids.length}개 시·도로 추첨 범위를 설정했습니다.`);
  });
}

function setupControls() {
  for(const [id,delta] of [['records-prev',-1],['records-next',1]]) $(id).onclick=()=>{pageNumber+=delta;renderRecords();};
  $('invite').onclick=async()=>{
    const url=new URL(location.href);url.hash='';
    try {await navigator.clipboard.writeText(url.href);toast('지도 초대 링크를 복사했어요. 친구에게 보내주세요.');}
    catch {window.prompt('친구에게 보낼 지도 초대 링크',url.href);}
  };
  function showRecords(open,restoreFocus=false) {
    $('records-panel').hidden=!open;
    document.body.classList.toggle('records-collapsed',!open);
    document.body.classList.toggle('show-records',open);
    $('records-toggle').setAttribute('aria-expanded',String(open));
    $('records-toggle-label').textContent=open?'여행 기록 접기':'여행 기록 펼치기';
    for(const [id,active] of [['view-records',open],['view-draw',!open]]) {$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));}
    if(restoreFocus) (matchMedia('(max-width:991px)').matches ? $('view-draw') : $('records-toggle')).focus();
  }
  document.querySelector('.header-nav a[href="#roulette"]').onclick=()=>showRecords(false);
  $('records-toggle').addEventListener('click',()=>showRecords($('records-panel').hidden));
  $('records-close').addEventListener('click',()=>showRecords(false,true));
  $('view-draw').addEventListener('click',()=>showRecords(false));$('view-records').addEventListener('click',()=>showRecords(true));
  document.querySelectorAll('a[href="#records-panel"]').forEach(link=>link.addEventListener('click',()=>showRecords(true)));
  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||event.ctrlKey||event.altKey||event.metaKey) return;
    if(document.querySelector('dialog[open]')) return;
    if(event.target.closest('input,textarea,select,a,button') && event.target.closest('button')!==$('primary')) return;
    event.preventDefault();
    if(event.repeat||enterHeld) return;
    enterHeld=true;round.act();
  });
  document.addEventListener('keyup',event=>{if(event.key==='Enter') enterHeld=false;});
  window.addEventListener('blur',()=>enterHeld=false);
  $('help-open').addEventListener('click',()=>$('help-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('map-confirm').onclick=()=>round.act();
  $('map-reset').addEventListener('click',()=>{manualView=false;fitMap();});
  $('map-zoom-in').addEventListener('click',()=>zoom(.8));
  $('map-zoom-out').addEventListener('click',()=>zoom(1.25));
  function zoom(factor) {
    manualView=true;
    const [x,y,w,h]=currentView;
    const width=Math.min(900,Math.max(40,w*factor)),height=width*h/w;
    currentView=[x+(w-width)/2,y+(h-height)/2,width,height];
    applyView();
  }
  $('export-records').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({traveler:name,records:visibleRecords()},null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);const link=node('a');link.href=url;link.download=`오늘어디갈까-여행기록-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
  });
  $('sync-records').addEventListener('click',async()=>{
    if(firebaseState!=='connected') await initializeCloud();else await service.sync();
  });
  window.addEventListener('online',()=>{if(firebaseConfig) { if(firebaseState==='connected') service.sync();else initializeCloud(); }});
}

async function main() {
  const local=new LocalRecords();
  service=new RecordService(local,{notify:refreshHistory});
  setupProfile();
  try {await local.open();localAvailable=true;} catch {localAvailable=false;}
  await refreshHistory();
  try {
    const response=await fetch(new URL('../data/regions.json',import.meta.url));
    if(!response.ok) throw new Error(`지역 데이터 HTTP ${response.status}`);
    catalog=validateCatalog(await response.json());
    selectedIds=catalog.provinces.map(p=>p.id);
    $('data-version').textContent=`${catalog.version} · ${catalog.provinces.length}개 시·도`;
    setupMap();setupScope();
    round=setupRound({catalog,room,traveler:()=>name,scope:()=>drawPool(catalog.provinces,selectedIds,excludeIslands),finalRecord,preview,notify:toast,
      onBusy(busy,done) {
        $('scope-open').disabled=busy||done;$('profile-open').disabled=busy;
        for(const b of $('traveler-choices').children)b.disabled=busy;
      },
      async save(record) {
        if(!cloud) await initializeCloud();
        if(!cloud) throw Error('offline');
        const winner=await cloud.finalize(record);
        await refreshHistory();
        return winner;
      }
    });
    setupControls();round.reset(true);renderPins();
  } catch(error) {
    $('draw-status').textContent='불러오기 실패';$('primary-label').textContent='새로고침이 필요해요';
    $('announcement').textContent=`지역 데이터를 불러오지 못했습니다. 새로고침해주세요. (${error.message})`;
  }
  initializeCloud();
}
main();
