import { drawOptions } from './group.js';
import { makeRecord } from './roulette.js';

export function setupRound({catalog, room, traveler, scope, finalRecord, onBusy, save, preview, notify}) {
  const el = id => document.getElementById(id);
  let phase = 'ready', options = [], selected = -1, timer, deadline, id;
  const key = () => 'travel-draft:' + room + ':' + traveler();
  function persist(value) {
    try {
      if (value) sessionStorage.setItem(key(), JSON.stringify(value));
      else sessionStorage.removeItem(key());
    } catch {}
  }
  function render() {
    el('options').classList.remove('arriving');
    const spinning = phase === 'spin', choosing = phase === 'choose';
    const busy = spinning || phase === 'saving';
    onBusy(busy, phase === 'done');
    el('options').dataset.phase=phase;
    el('round-title').textContent=choosing?'내 여행지 선택':phase==='done'?'내가 고른 여행지':'이번 여행 후보';
    el('roulette').classList.toggle('drawing', spinning);
    el('draw-status').textContent = {ready:'준비 완료', spin:'추첨 중', choose:'후보 도착', saving:'저장 중', done:'선택 완료'}[phase];
    el('announcement').textContent = {ready:'후보를 뽑으면 이곳에 펼쳐져요.',spin:'지도에서 여행지를 찾고 있어요.',choose:'지도 번호나 후보 카드를 눌러 한 곳을 골라주세요.',saving:'선택한 여행지를 기록하고 있어요.',done:'이번 여행의 목적지를 확정했어요.'}[phase];
    el('auto-stop').hidden = !spinning;
    el('primary-label').textContent = {ready:'여행 후보 뽑기',spin:'지금 멈추기',choose:'이 여행지로 확정',saving:'기록하는 중…',done:'최종 선택 완료'}[phase];
    el('primary').disabled = phase === 'done' || !traveler() || (choosing && selected < 0) || phase === 'saving';
    if(choosing && selected>=0)el('primary-label').textContent=options[selected].destination.name+' 최종 확정';
    cards();
    preview(phase === 'done' ? [] : options, choosing, selected);
  }
  function cards() {
    const rows = options.length ? options : Array(3).fill(null);
    el('options').replaceChildren(...rows.map((option, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-card' + (selected === i ? ' chosen' : '');
      button.style.setProperty('--slot', i);
      button.disabled = phase !== 'choose';
      button.setAttribute('aria-pressed', String(i === selected));
      const number = document.createElement('small');
      number.textContent = String(i + 1).padStart(2, '0');
      const label = document.createElement('span');
      const region = document.createElement('small');
      region.textContent = option?.province.name || '여행 후보';
      const city = document.createElement('strong');
      city.textContent = option?.destination.name || '아직 미정';
      label.append(region, city);
      button.append(number, label);
      if (i === selected) {
        const check = document.createElement('i');
        check.className = 'bi bi-check-circle-fill';
        button.append(check);
      }
      button.onclick = () => { select(i); el('options').children[i].focus(); };
      return button;
    }));
  }
  function select(i) {
    if (phase !== 'choose' || !options[i]) return;
    selected=i;
    render();
  }
  function finish(record) {
    if (!record) { if (phase === 'done') reset(); return; }
    if (phase === 'done' && id===record.id) return;
    id=record.id;
    clearTimeout(timer);
    persist(null);
    const province=catalog.provinces.find(p=>p.id===record.provinceId);
    const destination=province?.destinations.find(d=>d.id===record.destinationId);
    options=[{province:province || {name:record.provinceName},destination:destination || {name:record.destinationName}}];
    selected=0;
    phase='done';
    render();
  }
  function stop() {
    clearTimeout(timer);
    phase = 'choose';
    id = crypto.randomUUID();
    persist({id, pairs:options.map(o => [o.province.id,o.destination.id])});
    render();
    el('options').classList.add('arriving');
    el('options').children[0].focus();
  }
  async function act() {
    if (!traveler() || phase === 'saving' || phase === 'done') return;
    if (phase === 'spin') return stop();
    if (phase === 'choose') {
      if (selected < 0) return;
      const {province,destination} = options[selected];
      const record = {...makeRecord(province,destination,catalog.version,{id}), travelerName:traveler(), roomId:room};
      phase = 'saving';
      render();
      try {
        const winner=await save(record);
        if(traveler()===record.travelerName) finish(winner);
      } catch {
        if (phase === 'done') return;
        phase = 'choose';
        notify('기록하지 못했습니다. 다시 확정해주세요.');
      }
      render();
      return;
    }
    const pool = scope();
    selected = -1;
    phase = 'spin';
    deadline = Date.now() + 5000;
    function tick() {
      const remaining = deadline - Date.now();
      if (remaining <= 0 && options.length) return stop();
      options = drawOptions(pool);
      cards();
      preview(options);
      el('auto-stop').textContent = Math.max(1,Math.ceil(remaining/1000)) + '초 뒤 자동 정지';
      timer = setTimeout(tick, Math.max(1, Math.min(remaining, 130 + 320 * (1 - remaining/5000) ** 2)));
    }
    render();
    tick();
  }
  function reset(restore = false) {
    clearTimeout(timer);
    phase = 'ready'; selected = -1; options = [];
    if (finalRecord()) {finish(finalRecord());return;}
    if (restore) {
      try {
        const draft = JSON.parse(sessionStorage.getItem(key()));
        if (draft?.id && draft.pairs.length) {
          const pool=scope();
          options = draft.pairs.map(([p,d]) => {
            const province = pool.find(item => item.id === p);
            const destination = province.destinations.find(item => item.id === d);
            if (!destination) throw Error();
            return {province,destination};
          });
          id = draft.id; phase = 'choose';
        }
      } catch { options = []; }
    } else persist(null);
    render();
  }
  el('primary').onclick = act;
  return {act,reset,select,finish};
}
