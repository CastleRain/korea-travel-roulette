import { Roulette, STATES, validateCatalog, makeRecord } from './roulette.js';
import { LocalRecords, RecordService } from './storage.js';
import { connectFirebase } from './firebase.js';
import { firebaseConfig } from '../firebase-config.js';
import { TravelerProfile } from './profile.js';
import { recordPage, FRIENDS } from './record-view.js';

const $ = id=>document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
let catalog, engine, service, selectedIds = [], lastState, lastMapKey, lastResult = null;
let firebaseState = 'unconfigured', localAvailable = false, listGeneration = 0, toastTimer;
let currentView = [0,0,640,650], enterHeld = false;
const profile = new TravelerProfile();
const selectedCandidates = new Set();
let candidateRecords = [], savedRecordIds = new Set(), savingSelection = false;
let savedRecords=[], recordTab='candidates', personFilter='', pageNumber=1, settling=false, settleTimer;
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
function mapView(bounds, padding=25) {
  if (!bounds) currentView=[0,0,640,650];
  else {
    let [x1,y1,x2,y2] = bounds;
    const width=Math.max(65,x2-x1)+padding*2, height=Math.max(65,y2-y1)+padding*2;
    currentView=[(x1+x2-width)/2,(y1+y2-height)/2,width,height];
  }
  applyView();
}
function applyView() {
  const svg=$('korea-map'), scale=currentView[2]/640;
  svg.setAttribute('viewBox',currentView.join(' '));
  svg.style.setProperty('--map-label-size',`${11*scale}px`);
  svg.style.setProperty('--map-label-outline',`${3*scale}px`);
  svg.querySelectorAll('.map-pin').forEach(pin=>pin.setAttribute('r',4*scale));
}
function setupMap() {
  const svg=$('korea-map');
  for (const p of catalog.provinces) {
    const path=svgNode('path',{d:p.path,class:'province-path',id:`map-${p.id}`});
    const title=svgNode('title',{}); title.textContent=p.name;path.append(title);svg.append(path);
  }
  const districts=svgNode('g',{id:'selected-district'});svg.append(districts);
  const labels=svgNode('g',{id:'province-labels'});
  for (const p of catalog.provinces) {
    let [x,y]=p.labelPoint;
    // Readability offsets only; boundary polygons retain their actual positions.
    const offsets={'서울특별시':[-13,-4],'인천광역시':[-15,7],'세종특별자치시':[-16,-9],'대전광역시':[13,8]};
    if (offsets[p.name]) { x+=offsets[p.name][0];y+=offsets[p.name][1]; }
    const label=svgNode('text',{x,y,'text-anchor':'middle',class:'map-label',id:`label-${p.id}`});
    label.textContent=shortNames[p.name]||p.shortName;labels.append(label);
  }
  svg.append(labels);
  $('map-title').textContent='대한민국 행정구역 지도 · 아직 선택된 지역 없음';
}
function updateMap() {
  const province=engine.province, destination=engine.destination;
  const key=`${province?.id||''}/${destination?.id||''}`;
  if (key===lastMapKey) return;
  lastMapKey=key;
  for (const p of catalog.provinces) {
    $(`map-${p.id}`).classList.toggle('selected',p.id===province?.id);
    $(`label-${p.id}`).classList.toggle('selected',p.id===province?.id);
  }
  const group=$('selected-district');group.replaceChildren();
  if (destination) {
    const path=svgNode('path',{d:destination.path,class:'district-path'});
    const title=svgNode('title',{});title.textContent=destination.name;path.append(title);group.append(path);
    const [x,y]=destination.labelPoint;
    group.append(svgNode('circle',{cx:x,cy:y,r:4,class:'map-pin'}));
    $('map-badge').textContent=destination.name;
    $('map-caption').textContent=province.singleStage ? province.name : `${province.name} ${destination.name}`;
    $('map-title').textContent=`선택한 여행지: ${$('map-caption').textContent}`;
    mapView(destination.bounds,26);
  } else if (province) {
    $('map-badge').textContent=province.name;
    $('map-caption').textContent=`${province.name} 안에서 목적지를 고르고 있어요.`;
    $('map-title').textContent=`선택한 시·도: ${province.name}`;
    mapView(province.bounds,35);
  } else {
    $('map-badge').textContent='전국 지도';$('map-caption').textContent='어디든 여행의 시작이 될 수 있어요.';
    $('map-title').textContent='대한민국 행정구역 지도 · 아직 선택된 지역 없음';mapView();
  }
}

function renderEngine() {
  const state=engine.state;
  const spinning=state===STATES.PROVINCE||state===STATES.DISTRICT;
  $('destination').textContent=engine.current?.name||'어디든 좋아요';
  $('auto-stop').hidden=!spinning;
  if(spinning) $('auto-stop').textContent=`${Math.max(1,Math.ceil((engine.deadline-engine.now())/1000))}초 뒤 자동 정지 · 지금 멈춰도 좋아요`;
  if (state===lastState) return;
  lastState=state;
  const ready=state===STATES.READY, complete=state===STATES.COMPLETE, transition=state===STATES.TRANSITION;
  $('ticket').classList.toggle('is-spinning',spinning);
  $('ticket').classList.toggle('complete',complete);
  $('draw-status').classList.toggle('spinning',spinning);
  $('primary').classList.toggle('stopping',spinning);
  $('primary').disabled=transition||!profile.name;
  $('primary').classList.toggle('next-draw',complete);
  $('profile-open').disabled=spinning||transition;
  $('restart').disabled=ready;
  $('scope-open').disabled=spinning||transition;
  $('result-actions').hidden=!complete;
  $('step-1').className=`step ${ready||state===STATES.PROVINCE?'current':'done'}`;
  $('step-2').className=`step ${state===STATES.DISTRICT?'current':complete?'done':''}`;
  $('step-2').querySelector('b').textContent=complete&&engine.province.singleStage?'하위 추첨 생략':'시·군·구 뽑기';
  $('primary-icon').textContent='';
  $('primary-icon').className=spinning?'bi bi-stop-fill':'bi bi-arrow-right';
  const descriptions={
    ready:['준비 완료','여행지 뽑기','첫 번째 목적지를 기다리는 중','시작 버튼을 누르고, 마음이 가는 순간 멈춰보세요.','시작을 누른 뒤 Enter로 멈춰주세요.'],
    province:['시·도 추첨 중','여기서 멈추기','STEP 01 · 시·도 추첨 중','어느 시·도로 떠나볼까요?','Enter 또는 멈추기 버튼으로 시·도를 확정하세요.'],
    transition:['시·도 확정','다음 추첨 준비 중','STEP 01 · 시·도 확정','잠시 후 시·군·구 추첨이 시작돼요.',`${engine.province?.name} 확정! 키를 떼고 다음 추첨을 기다려주세요.`],
    district:['시·군·구 추첨 중','여기서 멈추기','STEP 02 · 시·군·구 추첨 중',`${engine.province?.name} 안의 ${engine.province?.destinations.length}개 후보`,`${engine.province?.name} 안에서 추첨 중입니다. Enter로 최종 목적지를 정하세요.`],
    complete:['목적지 확정','새로운 여행지 뽑기','당신의 다음 여행지는',engine.province?.singleStage?'세종은 하위 시·군·구 없이 최종 확정해요.':engine.province?.name,`${engine.province?.singleStage?engine.province.name:`${engine.province?.name} ${engine.destination?.name}`} · 목적지가 정해졌어요!`]
  };
  const [status,action,label,sub,announcement]=descriptions[state];
  $('draw-status').textContent=status;$('primary-label').textContent=action;
  $('ticket-label').textContent=label;$('destination-sub').textContent=sub;
  $('announcement').textContent=announcement;
  $('ticket-route').textContent=engine.province?`VIA ${shortNames[engine.province.name]||engine.province.name}`:'FROM 일상';
  $('keyboard-text').textContent=transition?'키를 떼고 잠시 기다려주세요':complete?'새로운 여행 시작':ready?'시작 / 추첨 멈추기':'지금 보이는 지역 확정';
  updateMap();
  updateSaveResult();
  if(transition||complete) animateConfirmation();
  else updateInputLock();
}
function updateInputLock() {
  if(!engine) return;
  const busy=settling||[STATES.PROVINCE,STATES.DISTRICT,STATES.TRANSITION].includes(engine.state);
  $('primary').disabled=settling||engine.state===STATES.TRANSITION||!profile.name;
  $('restart').disabled=settling||engine.state===STATES.READY;
  $('scope-open').disabled=busy;$('profile-open').disabled=busy;
  $('reroll-district').disabled=settling;
  document.querySelectorAll('#traveler-choices button').forEach(b=>b.disabled=busy);
  updateSaveResult();updateSelection();
}
function animateConfirmation() {
  clearTimeout(settleTimer);settling=true;updateInputLock();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets=[$('destination'),document.querySelector('.province-path.selected'),document.querySelector('.map-pin')].filter(Boolean);
  for(const target of targets) {
    target.getAnimations().forEach(a=>a.cancel());
    if(!reduced) target.animate(target===$('destination')?[
      {transform:'translateY(-14px) scale(.96)',opacity:.5},
      {transform:'translateY(3px) scale(1.025)',opacity:1,offset:.65},
      {transform:'translateY(0) scale(1)',opacity:1}
    ]:[{opacity:.35},{opacity:1}],{duration:700,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  settleTimer=setTimeout(()=>{settling=false;updateInputLock();},reduced?0:700);
}
function primaryAction() {
  if (!engine||settling) return;
  if (!profile.name) { openProfile(); return; }
  if (engine.state===STATES.READY||engine.state===STATES.COMPLETE) { lastResult=null;engine.start(selectedIds); }
  else engine.stop();
}

async function completed({province,destination}) {
  const record={...makeRecord(province,destination,catalog.version),travelerName:profile.name};
  lastResult=record;recordTab='candidates';pageNumber=1;selectedCandidates.clear();
  $('search-map').href=`https://map.naver.com/p/search/${encodeURIComponent(record.fullName)}`;
  $('reroll-district').hidden=province.singleStage;
  updateSaveResult();
  // Drawing only creates a local candidate. A separate action approves saving.
  await service.stage(record);
}

function openProfile() {
  $('traveler-name').value=profile.name;
  $('profile-error').textContent='';
  $('profile-cancel').hidden=!profile.name;
  $('profile-dialog').querySelector('button[type="submit"]').firstChild.textContent=profile.name?'이름 변경하기 ':'이 이름으로 시작하기 ';
  if (!$('profile-dialog').open) $('profile-dialog').showModal();
}
function renderProfile() {
  $('profile-name').textContent=profile.name?`${profile.name} 님`:'이름 입력';
  $('profile-open').title=profile.name?`${profile.name} · 이름 변경`:'이름 입력';
  $('profile-open').setAttribute('aria-label',profile.name?'이름 변경':'이름 입력');
  $('active-traveler').textContent=profile.name?`${profile.name} 님의 차례`: '이름을 선택해주세요';
  document.querySelectorAll('#traveler-choices button').forEach(b=>{const chosen=b.dataset.name===profile.name;b.classList.toggle('active',chosen);b.setAttribute('aria-pressed',String(chosen));});
  updateInputLock();
}
function setupProfile() {
  for(const name of FRIENDS) {
    const button=node('button','btn btn-outline-secondary',name);button.type='button';button.dataset.name=name;button.setAttribute('aria-pressed','false');
    button.addEventListener('click',()=>{profile.set(name);renderProfile();});$('traveler-choices').append(button);
    const choice=node('button','btn btn-outline-secondary',name);choice.type='button';choice.addEventListener('click',()=>{profile.set(name);$('profile-dialog').close();renderProfile();});$('profile-choices').append(choice);
  }
  profile.load(); renderProfile();
  $('profile-open').addEventListener('click',openProfile);
  $('profile-dialog').addEventListener('cancel',event=>{if(!profile.name) event.preventDefault();});
  $('profile-form').addEventListener('submit',event=>{
    event.preventDefault();
    try {
      profile.set($('traveler-name').value);
      $('profile-dialog').close(); renderProfile();
      if(!profile.persistent) toast('이름을 이 기기에 기억할 수 없어 이번 방문 동안만 사용합니다.');
    } catch(error) { $('profile-error').textContent=error.message;$('traveler-name').focus(); }
  });
  if(!profile.name) openProfile();
}
function updateSaveResult() {
  const saved = lastResult && savedRecordIds.has(lastResult.id);
  $('save-result').textContent=saved?'기록에 남겼어요':savingSelection?'기록하는 중…':'이 결과 기록하기';
  $('save-result').disabled=settling||!lastResult||saved||savingSelection||!candidateRecords.some(r=>r.id===lastResult.id);
  $('result-traveler').textContent=lastResult?`${lastResult.travelerName} 님의 추첨 결과`:'';
}
function currentRecords() { return recordPage(recordTab==='candidates'?candidateRecords:savedRecords,personFilter,pageNumber); }
function updateSelection() {
  const visible=currentRecords().items;
  const checked=visible.filter(r=>selectedCandidates.has(r.id)).length;
  $('select-candidates').checked=visible.length>0&&checked===visible.length;
  $('select-candidates').indeterminate=checked>0&&checked<visible.length;
  $('select-candidates').disabled=!visible.length||savingSelection;
  $('selection-count').textContent=`${selectedCandidates.size}개 선택`;
  $('save-selected').disabled=settling||!selectedCandidates.size||savingSelection;
  $('save-selected').textContent=savingSelection?'기록하는 중…':`선택한 결과 기록하기${selectedCandidates.size?` (${selectedCandidates.size})`:''}`;
}
function renderRecords() {
  const page=currentRecords();pageNumber=page.page;
  $('candidate-total').textContent=candidateRecords.length;$('log-total').textContent=savedRecords.length;
  $('candidates').hidden=recordTab!=='candidates';$('history').hidden=recordTab!=='history';
  for(const tab of ['candidates','history']) {const b=$(`tab-${tab}`),active=recordTab===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  $('records-page').textContent=`${page.page} / ${page.pages} · ${page.total}개`;
  $('records-prev').disabled=page.page===1;$('records-next').disabled=page.page===page.pages;
  const fragment=document.createDocumentFragment();
  for(const r of page.items) {
    const candidate=recordTab==='candidates';
    const row=node(candidate?'label':'article',`${candidate?'candidate-row list-group-item-action':'history-row'} list-group-item`);
    if(candidate) {const checkbox=node('input','form-check-input');checkbox.type='checkbox';checkbox.dataset.recordId=r.id;checkbox.checked=selectedCandidates.has(r.id);checkbox.setAttribute('aria-label',`${r.travelerName} · ${r.fullName} 기록 선택`);row.append(checkbox);}
    const info=node('div','history-info');info.append(node('h3','',r.fullName));
    const meta=node('div','record-metadata');meta.append(node('span','record-person',r.travelerName||'기존 기록'));
    const time=node('time','',dateFormat.format(new Date(r.drawnAt)));time.dateTime=r.drawnAt;meta.append(time);info.append(meta);
    if(!candidate) {const status=node('span',`save-tag badge ${r.syncState==='synced'?'':'pending'}`);status.append(icon(r.syncState==='synced'?'cloud-check':'clock'),document.createTextNode(r.syncState==='synced'?'저장 완료':'저장 대기'));meta.append(status);}
    row.append(info);
    if(!candidate) {const link=node('a','history-map-link btn btn-light');link.append(icon('arrow-up-right'));link.href=`https://map.naver.com/p/search/${encodeURIComponent(r.fullName)}`;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',`${r.fullName} 지도 검색`);row.append(link);}
    fragment.append(row);
  }
  if(!page.total) {const empty=node('div','empty-state');empty.append(icon(recordTab==='candidates'?'shuffle':'bookmark'),node('h3','',recordTab==='candidates'?'뽑아본 결과가 없어요':'아직 저장한 기록이 없어요'),node('p','',personFilter?'다른 이름이나 모든 사람을 선택해보세요.':'여행지를 뽑고 원하는 결과를 기록하세요.'));fragment.append(empty);}
  $(recordTab==='candidates'?'candidate-list':'history-list').replaceChildren(fragment);
  updateSelection();updateSaveResult();
}
async function saveResults(ids) {
  if(savingSelection||settling) return;
  savingSelection=true;updateSelection();updateSaveResult();
  try {
    const count=await service.saveSelected(ids);
    if(count) {recordTab='history';pageNumber=1;selectedCandidates.clear();}
    toast(count?`${count}개 목적지를 내 여행 기록에 남겼습니다.`:'이미 기록했거나 선택된 결과가 없습니다.');
  } catch { toast('기록을 남기지 못했습니다. 다시 선택해주세요.'); }
  finally {savingSelection=false;await refreshHistory();}
}
async function refreshHistory(message) {
  if(message) toast(message);
  const generation=++listGeneration;
  const [records,candidates]=await Promise.all([service.list(),service.candidates()]);
  if(generation!==listGeneration) return;
  savedRecords=records;candidateRecords=candidates;savedRecordIds=new Set(records.map(r=>r.id));
  const ids=new Set(candidates.map(r=>r.id));for(const id of selectedCandidates) if(!ids.has(id)) selectedCandidates.delete(id);
  $('history-count').textContent=records.length;$('export-records').disabled=!records.length&&!candidates.length;
  const pending=records.filter(r=>r.syncState!=='synced').length;
  const descriptions={unconfigured:'이 기기에 보관 중',connecting:'클라우드 연결 중',connected:pending?`${pending}개 클라우드 저장 대기`:'클라우드 연결됨',error:'연결 실패 · 이 기기에 보관 중'};
  $('storage-status').textContent=descriptions[firebaseState];
  if(!localAvailable||service.localFailed) $('storage-status').textContent+=' · JSON 백업 필요';
  $('storage-explanation').textContent='이름은 표시용입니다. 다른 기기의 기록과 공유되지 않습니다.';
  $('storage-dot').className=`status-dot ${firebaseState==='connected'&&!pending?'':firebaseState==='error'?'error':'warning'}`;
  $('sync-records').hidden=!firebaseConfig||(!pending&&firebaseState==='connected');$('sync-records').disabled=firebaseState==='connecting';
  renderRecords();
}

function withTimeout(promise,ms=20000) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Firebase 응답 시간이 초과되었습니다.')),ms);})]).finally(()=>clearTimeout(timer));
}
let connectionTask;
async function initializeCloud() {
  if(!firebaseConfig || connectionTask) return;
  firebaseState='connecting';refreshHistory();
  connectionTask=(async()=>{
    try {
      const remote=await withTimeout(connectFirebase(firebaseConfig));
      await withTimeout(service.connect(remote));
      firebaseState='connected';
    } catch(error) {
      firebaseState='error';
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
    for(const input of $('province-options').querySelectorAll('input')) input.checked=selectedIds.includes(input.value);
    $('scope-error').textContent='';$('scope-dialog').showModal();
  });
  $('select-all').addEventListener('click',()=>{for(const i of $('province-options').querySelectorAll('input')) i.checked=true;});
  $('select-none').addEventListener('click',()=>{for(const i of $('province-options').querySelectorAll('input')) i.checked=false;});
  $('apply-scope').addEventListener('click',()=>{
    const ids=[...$('province-options').querySelectorAll('input:checked')].map(i=>i.value);
    if(!ids.length){$('scope-error').textContent='추첨할 시·도를 하나 이상 선택해주세요.';return;}
    selectedIds=ids;$('scope-count').textContent=ids.length===catalog.provinces.length?'전체':`${ids.length}개 시·도`;
    $('scope-dialog').close();engine.reset();toast(`${ids.length}개 시·도로 추첨 범위를 설정했습니다.`);
  });
}

function setupControls() {
  $('primary').addEventListener('click',primaryAction);
  $('restart').addEventListener('click',()=>engine.reset());
  $('reroll-district').addEventListener('click',()=>engine.rerollDistrict());
  $('save-result').addEventListener('click',()=>{if(lastResult) saveResults([lastResult.id]);});
  $('save-selected').addEventListener('click',()=>saveResults([...selectedCandidates]));
  $('candidate-list').addEventListener('change',event=>{
    const checkbox=event.target.closest('input[data-record-id]');if(!checkbox) return;
    if(checkbox.checked) selectedCandidates.add(checkbox.dataset.recordId);else selectedCandidates.delete(checkbox.dataset.recordId);
    updateSelection();
  });
  $('select-candidates').addEventListener('change',event=>{
    for(const record of currentRecords().items) {
      if(event.target.checked) selectedCandidates.add(record.id);else selectedCandidates.delete(record.id);
    }
    renderRecords();
  });
  function changeView(tab) {recordTab=tab;pageNumber=1;selectedCandidates.clear();renderRecords();}
  for(const tab of ['candidates','history']) {
    const button=$(`tab-${tab}`);button.addEventListener('click',()=>changeView(tab));
    button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'candidates':event.key==='End'?'history':tab==='history'?'candidates':'history';changeView(next);$(`tab-${next}`).focus();}});
  }
  $('record-person').addEventListener('change',event=>{personFilter=event.target.value;pageNumber=1;selectedCandidates.clear();renderRecords();});
  for(const [id,delta] of [['records-prev',-1],['records-next',1]]) $(id).addEventListener('click',()=>{pageNumber+=delta;selectedCandidates.clear();renderRecords();});
  function showRecords(open,restoreFocus=false) {
    $('records-panel').hidden=!open;
    document.body.classList.toggle('records-collapsed',!open);
    document.body.classList.toggle('show-records',open);
    $('records-toggle').setAttribute('aria-expanded',String(open));
    $('records-toggle-label').textContent=open?'여행 기록 접기':'여행 기록 펼치기';
    for(const [id,active] of [['view-records',open],['view-draw',!open]]) {$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));}
    if(restoreFocus) $('records-toggle').focus();
  }
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
    enterHeld=true;primaryAction();
  });
  document.addEventListener('keyup',event=>{if(event.key==='Enter') enterHeld=false;});
  window.addEventListener('blur',()=>enterHeld=false);
  $('help-open').addEventListener('click',()=>$('help-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('map-reset').addEventListener('click',()=>mapView());
  $('map-zoom-in').addEventListener('click',()=>zoom(.8));
  $('map-zoom-out').addEventListener('click',()=>zoom(1.25));
  function zoom(factor) {
    const [x,y,w,h]=currentView;
    const width=Math.min(900,Math.max(40,w*factor)),height=width*h/w;
    currentView=[x+(w-width)/2,y+(h-height)/2,width,height];
    applyView();
  }
  $('copy-result').addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(lastResult.fullName);toast('목적지를 복사했습니다.'); }
    catch { toast('복사를 사용할 수 없습니다. 결과의 지역명을 선택해서 복사해주세요.'); }
  });
  $('export-records').addEventListener('click',async()=>{
    const [records,candidates]=await Promise.all([service.list(),service.candidates()]);
    const blob=new Blob([JSON.stringify({app:'어디든',exportedAt:new Date().toISOString(),records,candidates},null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);const link=node('a');link.href=url;link.download=`어디든-여행기록-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
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
    engine=new Roulette(catalog.provinces,{changed:renderEngine,completed});
    setupControls();renderEngine();
  } catch(error) {
    $('draw-status').textContent='불러오기 실패';$('primary-label').textContent='새로고침이 필요해요';
    $('announcement').textContent=`지역 데이터를 불러오지 못했습니다. 새로고침해주세요. (${error.message})`;
  }
  initializeCloud();
}
main();
