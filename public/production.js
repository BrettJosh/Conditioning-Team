(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stages=['Research/Planning','Scripting','Filming','Editing','Published'];
const owners=['Josh','Tristan','Daisy','Rachit','Thumbnail designer','Unassigned'];
const thumbs=['Not started','Concepts','Revising','Approved'];
const s={projects:[],loaded:false,loading:false,selected:null,filter:'all',search:'',saving:false};
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const stale=p=>!p.lastConfirmed||((Date.now()-new Date(p.lastConfirmed+'T12:00:00').getTime())/86400000)>7;
const date=v=>v?new Date(v+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'No date';
function notice(text,error=false){const el=$('productionNotice');el.textContent=text;el.hidden=!text;el.classList.toggle('error',error);}
async function api(action,payload={}){
  let code;try{code=sessionStorage.getItem('josh-brett-studio-access-code');}catch{}
  if(!code)throw new Error('Connect your Notion workspace in the top-right corner first.');
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
async function refresh(){
  if(s.loading)return;s.loading=true;$('productionRefresh').disabled=true;
  notice('Loading your Video Projects from Notion…');
  try{const data=await api('list');s.projects=data.projects||[];s.loaded=true;render();notice(data.limited?'Showing first 500 active projects.':'');}
  catch(e){notice('Production not connected: '+e.message,true);}
  finally{s.loading=false;$('productionRefresh').disabled=false;}
}
