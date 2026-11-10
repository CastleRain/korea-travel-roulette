import { FRIENDS } from './record-view.js';

export function tally(options,votes) {
  const counts=new Map(options.map(id=>[id,0]));
  let total=0;
  for(const friend of FRIENDS) {
    const choice=votes[friend];
    if(counts.has(choice)){counts.set(choice,counts.get(choice)+1);total++;}
  }
  const high=Math.max(...counts.values());
  return {total,counts,leaders:options.filter(id=>counts.get(id)===high)};
}

export function setupPoll(room) {
  const el=id=>document.getElementById(id);
  let api,member,records,epoch='',sequence=1,eligible=[],votes={},stop;
  let loading=true, failed=false, pending=false, sendError=false, generation=0;
  function watch() {
    stop?.();
    const token=++generation;
    loading=true;failed=false;pending=false;sendError=false;votes={};render();
    stop=api.watchVote(room,epoch,sequence,data=>{
      if(token!==generation)return;
      votes=data?.votes || {};loading=false;
      const {total,leaders}=tally(eligible,votes);
      if(total===4 && leaders.length>1){eligible=leaders;sequence++;watch();return;}
      render();
    },()=>{if(token===generation){failed=true;render();}});
  }
  function render() {
    if(!epoch)return;
    const {total,leaders,counts}=tally(eligible,votes);
    const result=total===4 && leaders.length===1;
    const own=records.find(r=>r.travelerName===member);
    const allowed=own && (!own.ownerUid || own.ownerUid===api.uid);
    const label=id=>records.find(r=>r.destinationId===id).fullName;
    el('poll-title').textContent=result?'우리의 최종 여행지':sequence===1?'최종 여행지 투표':`공동 1위 재투표 · ${sequence}차`;
    el('poll-status').textContent=failed?'투표를 불러오지 못했습니다.':loading?'투표를 불러오는 중…':sendError?'투표를 보내지 못했습니다. 연결 후 다시 시도해주세요.':result?
      `${label(leaders[0])} · 4표 중 ${counts.get(leaders[0])}표`:
      `${total}/4명 참여 · ${votes[member]?'내 투표 완료':allowed?'갈 곳을 눌러 한 표를 보내세요.':'여행지를 확정한 브라우저에서 투표하세요.'}`;
    const group=el('poll-choices');group.replaceChildren();
    if(failed){const retry=document.createElement('button');retry.className='btn btn-light';retry.textContent='다시 연결';retry.onclick=watch;group.append(retry);return;}
    for(const id of eligible){
      const button=document.createElement('button');
      button.className='btn '+(votes[member]===id?'btn-primary':'btn-outline-secondary');
      button.textContent=label(id)+(result?` · ${counts.get(id)}표`:votes[member]===id?' · 내 선택':'');
      button.disabled=loading||pending||result||!allowed||!!votes[member];
      button.onclick=async()=>{
        if(button.disabled)return;
        const token=generation;
        pending=true;sendError=false;render();
        try{await api.castVote(room,epoch,sequence,records,member,id);}
        catch{if(token===generation)sendError=true;}
        finally{if(token===generation){pending=false;render();}}
      };
      group.append(button);
    }
  }
  return {update(remote,roster,name){
    const key=remote && roster.every(Boolean)?roster.map(r=>r.id).join('_'):'';
    member=name;records=roster;
    if(key===epoch && api===remote){render();return;}
    stop?.();stop=null;generation++;epoch=key;api=remote;
    el('poll').hidden=!epoch;
    if(!epoch)return;
    sequence=1;eligible=[...new Set(roster.map(r=>r.destinationId))];watch();
  }};
}
