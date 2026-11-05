(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stages=['Research/Planning','Scripting','Filming','Editing','Published'];
const owners=['Josh','Tristan','Daisy','Rachit','Thumbnail designer','Unassigned'];
const thumbs=['Not started','Concepts','Revising','Approved'];
const s={projects:[],loaded:false,loading:null,error:'',selected:null,filter:'all',search:'',saving:false};
const FILTER_SLUG={stale:'needs-update',blocked:'blocked'};
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const stale=p=>!p.lastConfirmed||((Date.now()-new Date(p.lastConfirmed+'T12:00:00').getTime())/86400000)>7;
const date=v=>v?new Date(v+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'No date';
function notice(text,error=false){const el=$('productionNotice');el.textContent=text;el.hidden=!text;el.classList.toggle('error',error);}
async function api(action,payload={}){
  const board=window.StudioBoard?.getState(),code=board&&board.mode==='notion'?board.code:'';
  if(!code)throw new Error('Connect your workspace in the top-right corner first.');
  const res=await fetch('/.netlify/functions/production',{method:'POST',headers:{'content-type':'application/json','x-board-key':code},body:JSON.stringify({action,...payload}),cache:'no-store'});
  let data;try{data=await res.json();}catch{throw new Error('Netlify production function unavailable.');}
  if(!res.ok)throw new Error(data.error||'Notion request failed.');
  return data;
}
function progress(stage){
  const n=stages.indexOf(stage);
  return '<div class="production-progress">'+stages.slice(0,4).map((_,i)=>'<span class="'+(i<n?'done':i===n?'now':'')+'"></span>').join('')+'</div>';
}
function card(p){
  const flag=p.blocker?'Blocked':stale(p)?'Needs update':'Confirmed';
  return '<button type="button" class="production-card" data-video="'+esc(p.id)+'">'+
  '<div class="production-top"><span class="production-stage">'+esc(p.stage)+'</span><span class="production-flag '+(p.blocker?'blocked':stale(p)?'stale':'fresh')+'">'+flag+'</span></div>'+
  '<strong>'+esc(p.title)+'</strong>'+progress(p.stage)+
  '<div class="production-pair"><div><small>WITH</small><b>'+esc(p.currentlyWith||'Not set')+'</b></div><div><small>NEXT UP</small><b>'+esc(p.nextDeliverable||'Not set')+'</b></div></div>'+
  '<div class="production-foot"><span class="'+(p.nextDue&&p.nextDue<today()?'late-date':'')+'">◷ '+esc(date(p.nextDue))+'</span><span>Thumbnail: '+esc(p.thumbnailStatus||'Not set')+'</span><span>↗</span></div></button>';
}
function render(){
  const all=s.projects;
  $('productionTotal').textContent=all.length;
  $('productionNeeds').textContent=all.filter(stale).length;
  $('productionBlocked').textContent=all.filter(p=>p.blocker).length;
  const list=all.filter(p=>(s.filter==='all'||(s.filter==='stale'&&stale(p))||(s.filter==='blocked'&&p.blocker))&&
    (!s.search||[p.title,p.stage,p.currentlyWith,p.nextDeliverable,p.blocker].join(' ').toLowerCase().includes(s.search.toLowerCase())))
    .sort((a,b)=>Number(Boolean(b.blocker))-Number(Boolean(a.blocker))||Number(stale(b))-Number(stale(a))||
      (a.nextDue||'9999').localeCompare(b.nextDue||'9999'));
  $('productionResults').textContent=list.length+' active '+(list.length===1?'video':'videos')+' · most attention needed first';
  $('productionGrid').innerHTML=list.length?list.map(card).join(''):'<div class="production-empty">No videos match this view.</div>';
  document.querySelectorAll('[data-production-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.productionFilter===s.filter)));
}
function refresh(){
  if(s.loading)return s.loading;
  s.loading=(async()=>{
    $('productionRefresh').disabled=true;notice('Loading your Video Projects from Notion…');
    try{const data=await api('list');s.projects=data.projects||[];s.loaded=true;s.error='';render();notice(data.limited?'Showing first 500 active projects.':'');}
    catch(e){s.error=e.message;notice('Production not connected: '+e.message,true);}
    finally{$('productionRefresh').disabled=false;window.Studio.emit('data',{source:'production'});}
  })().finally(()=>{s.loading=null;});
  return s.loading;
}
const ensureLoaded=()=>s.loaded?Promise.resolve():refresh();

function openProject(id){
  const p=s.projects.find(x=>x.id===id);if(!p)return;
  s.selected=id;
  $('productionDrawerTitle').textContent=p.title;
  $('productionStage').value=p.stage;
  $('productionOwner').value=p.currentlyWith||'';
  $('productionNext').value=p.nextDeliverable||'';
  $('productionDue').value=p.nextDue||'';
  $('productionBlocker').value=p.blocker||'';
  $('productionThumbnail').value=p.thumbnailStatus||'';
  $('productionConfirmed').textContent=p.lastConfirmed?'Last confirmed '+date(p.lastConfirmed):'Never confirmed — saving marks it current.';
  const l=$('productionNotionLink');l.href=/^https:\/\//.test(p.url)?p.url:'#';
  $('productionDrawer').hidden=false;document.body.style.overflow='hidden';
  window.Studio.setItem('production',['video',id]);
}
function closeProject(){if($('productionDrawer').hidden)return;$('productionDrawer').hidden=true;s.selected=null;document.body.style.overflow='';window.Studio.setItem('production',null);}
async function save(e){
  e.preventDefault();if(s.saving||!s.selected)return;
  const patch={
    stage:$('productionStage').value,currentlyWith:$('productionOwner').value,
    nextDeliverable:$('productionNext').value.trim(),nextDue:$('productionDue').value,
    blocker:$('productionBlocker').value.trim(),thumbnailStatus:$('productionThumbnail').value
  };
  if(patch.stage==='Published'&&!confirm('Publish this video? It will leave the active view but remain in Notion.'))return;
  s.saving=true;$('productionSave').disabled=true;
  try{
    const result=await api('update',{id:s.selected,patch});
    s.projects=s.projects.filter(p=>p.id!==s.selected);
    if(result.project?.stage!=='Published')s.projects.push(result.project);
    closeProject();render();notice('');window.Studio.emit('data',{source:'production'});
  }catch(err){notice('Could not save: '+err.message,true);}
  finally{s.saving=false;$('productionSave').disabled=false;}
}
function setFilter(filter){
  s.filter=filter;render();
  if(window.Studio.current()==='production'&&!s.selected)window.Studio.setItem('production',FILTER_SLUG[filter]?[FILTER_SLUG[filter]]:null);
}
function show(tab){
  if(tab==='production')window.Studio.ready.then(ensureLoaded);
}
function boot(){
  $('productionStage').innerHTML=stages.map(n=>'<option>'+esc(n)+'</option>').join('');
  $('productionOwner').innerHTML='<option value="">Not set</option>'+owners.map(n=>'<option>'+esc(n)+'</option>').join('');
  $('productionThumbnail').innerHTML='<option value="">Not set</option>'+thumbs.map(n=>'<option>'+esc(n)+'</option>').join('');
  window.Studio.on('tab',({tab})=>show(tab));
  window.Studio.on('connection',()=>{s.loaded=false;s.projects=[];if(window.Studio.current()==='production')refresh();});
  document.querySelectorAll('[data-production-filter]').forEach(b=>b.addEventListener('click',()=>setFilter(b.dataset.productionFilter)));
  $('productionSearch').addEventListener('input',e=>{s.search=e.target.value.trim();render();});
  $('productionRefresh').addEventListener('click',refresh);
  $('productionGrid').addEventListener('click',e=>{const card=e.target.closest('[data-video]');if(card)openProject(card.dataset.video);});
  $('productionClose').addEventListener('click',closeProject);
  $('productionDrawer').addEventListener('click',e=>{if(e.target.hasAttribute('data-close-production'))closeProject();});
  $('productionForm').addEventListener('submit',save);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('productionDrawer').hidden)closeProject();});
  window.Studio.register('production',{
    async open(item){
      const slug=Object.entries(FILTER_SLUG).find(([,v])=>v===item[0]);
      if(slug){setFilter(slug[0]);return;}
      if(item[0]!=='video'||!item[1])return;
      await ensureLoaded();
      if(!s.projects.some(p=>p.id===item[1])){window.StudioBoard?.toast('That video isn’t in the active list — it may be published or deleted in Notion.');return;}
      openProject(item[1]);
    },
    close:closeProject
  });
}
window.StudioProduction={ensureLoaded,refresh,projects:()=>s.projects,loaded:()=>s.loaded,error:()=>s.error,isStale:stale,open:openProject};
boot();
})();
