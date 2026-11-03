(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={events:[],extras:[],youtube:{},bridgeVersion:0,start:9,loaded:false,busy:false,from:null,previousText:'',brands:null,editing:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=(m,d)=>'2026-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
const todayIso=()=>new Date().toLocaleDateString('en-CA');
const compact=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(n)||0);
const fmtDay=d=>new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
const dur=s=>{s=Number(s)||0;const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')};
const SPONSOR_STATUSES=['In progress','Invoiced','Paid'];
const notice=(text,error=false)=>{const el=$('calendarNotice');el.hidden=!text;el.textContent=text;el.classList.toggle('error',error)};

/* published = a matching long-form video is live on the channel; otherwise yellow until the day passes, then orange */
const shownOn=e=>stateOf(e)==='published'&&e.yt?.date&&e.yt.date.startsWith('2026-')?e.yt.date:e.date;
function stateOf(e){if(e.yt&&e.yt.live!=='upcoming')return'published';return e.date<todayIso()?'overdue':'scheduled'}
const STATE_LABEL={published:'Published',scheduled:'Upcoming',overdue:'Not live yet'};
const statusClass=s=>'sp-'+String(s||'none').toLowerCase().replace(/\s+/g,'-');

async function api(payload){
 const board=window.StudioBoard?.getState();if(!board||board.mode!=='notion')throw Error('Connect your Notion workspace first to use the shared calendar.');
 const resp=await fetch('/.netlify/functions/calendar',{method:'POST',headers:{'content-type':'application/json','x-board-key':board.code},body:JSON.stringify(payload)});
 const text=await resp.text();let data;try{data=JSON.parse(text)}catch{throw Error(resp.status===502||resp.status===504?'The calendar took too long to answer. Press Refresh.':'Calendar server returned an unexpected response.')}
 if(!resp.ok||!data.ok)throw Error(data.error||'Calendar request failed.');return data;
}
function apply(data){state.events=data.events||[];state.youtube=data.youtube||{};state.extras=data.youtube?.extras||[];state.bridgeVersion=Number(data.bridgeVersion)||0;state.loaded=true;render();
 if(!state.brands)loadBrands().then(b=>{if(b&&b.length)render()})}
async function refresh(){
 if(state.busy)return;state.busy=true;$('calendarRefresh').disabled=true;notice('Loading the content plan from Google Sheets…');
 try{const r=await api({action:'list',fresh:true});apply(r);notice(state.bridgeVersion<2?'Sponsor details and YouTube links need the updated Apps Script: paste the new Code.gs into Studio bridge and deploy a new version.':'');$('calendarSetupHelp').hidden=true;}
 catch(e){notice(e.message,true);const needsSetup=/not configured|calendar readme|apps script url|connection is not configured/i.test(e.message);$('calendarSetupHelp').hidden=!needsSetup;if(!state.loaded){$('calendarGrid').innerHTML='<div class="calendar-empty">Your content plan is still safely stored in Google Sheets. Connect the calendar integration to view and edit it here.</div>';}}
 finally{state.busy=false;$('calendarRefresh').disabled=false}
}

/* ---------- rendering ---------- */
/* Short display title: drop the "Publish video -" habit, and the "(Sponsor)" bit when the sponsor tag shows it anyway. */
function shortTitle(item,sponsorName){
 let t=String(item.text||'').replace(/^\s*publish(ed)?\s*(video)?\s*[-–—:]?\s*/i,'').trim();
 if(sponsorName)t=t.replace(/\s*\([^)]*\)\s*$/,'').trim();
 if(!t||/^video$/i.test(t))t='Untitled video';
 return t.charAt(0).toUpperCase()+t.slice(1);
}
const sponsorOf=item=>item.sponsor?{name:item.sponsor,status:item.sponsorStatus||'',saved:true}:(()=>{const n=suggestSponsor(item.text,state.brands||[]);return n?{name:n,status:'',saved:false}:null})();
function tooltip(item){
 const st=stateOf(item),y=item.yt,sp=sponsorOf(item),lines=[item.text,STATE_LABEL[st]+(y?' · '+compact(y.views)+' views':'')];
 if(shownOn(item)!==item.date)lines.push('Planned '+fmtDay(item.date)+', went out '+fmtDay(shownOn(item)));
 if(sp)lines.push('Sponsor: '+sp.name+' — '+(sp.saved?(sp.status||'status not set'):'suggested, click to confirm'));
 return lines.join('\n');
}
/* Grid card: two-line title + one meta line. The sponsor is a slim tag right under it, coloured by deal status. */
const isUntitled=item=>shortTitle(item,'x')==='Untitled video';
function chip(item){
 const st=stateOf(item),y=item.yt,sp=sponsorOf(item);
 const meta=st==='published'?'✓ '+(y?compact(y.views):'Live'):st==='overdue'?'! Not live':'◷ Soon';
 return '<button class="calendar-event cal-'+st+'" type="button" draggable="true" data-edit-date="'+item.date+'" title="'+esc(tooltip(item))+'">'+(isUntitled(item)?'<span class="cal-ev-title cal-untitled">+ Add title</span>':'<span class="cal-ev-title">'+esc(shortTitle(item,sp&&sp.name))+'</span>')+'<span class="cal-ev-meta">'+meta+(shownOn(item)!==item.date?' <span class="cal-ev-moved">↪</span>':'')+'</span></button>'+sponsorTag(item,sp);
}
function sponsorTag(item,sp){
 if(!sp)return'';
 const label=sp.saved?(sp.status||'No status'):'Suggested — click to confirm';
 return '<button class="cal-sponsor '+(sp.saved?statusClass(sp.status):'sp-suggested')+'" type="button" data-sponsor-date="'+item.date+'" title="'+esc('Sponsor: '+sp.name+' — '+label)+'" aria-label="'+esc('Sponsor '+sp.name+', '+label)+'"><span class="cal-sponsor-name">◆ '+esc(sp.name)+(sp.saved?'':' ?')+'</span></button>';
}
function extraChip(v){return '<button class="calendar-event cal-extra" type="button" data-extra="'+esc(v.id)+'" title="'+esc(v.title+'\nOn YouTube but not in the plan · '+compact(v.views)+' views — click to add it')+'"><span class="cal-ev-title">'+esc(v.title)+'</span><span class="cal-ev-meta">✓ '+compact(v.views)+' · unplanned</span></button>'}

/* The readable version: one row per video in the quarter. */
const pillFor=st=>'<span class="cal-pill cal-'+st+'">'+(st==='published'?'✓ Published':st==='overdue'?'! Not live yet':st==='extra'?'✓ Live, not planned':'◷ Upcoming')+'</span>';
function renderAgenda(list,extras){
 const rows=[...list.map(e=>({kind:'plan',e,date:shownOn(e)})),...extras.map(v=>({kind:'extra',v,date:v.date}))].sort((a,b)=>a.date.localeCompare(b.date));
 if(!rows.length){$('calendarAgenda').innerHTML='';return}
 const dayLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
 $('calendarAgenda').innerHTML='<div class="cal-agenda-head"><h3>This quarter</h3><span>'+rows.length+' video'+(rows.length===1?'':'s')+' · click a row to open it</span></div><div class="cal-agenda-wrap"><table class="cal-agenda"><thead><tr><th>Date</th><th>Video</th><th>Status</th><th class="num">Views</th><th>Sponsor</th><th>Deal</th></tr></thead><tbody>'+
  rows.map(r=>{
   if(r.kind==='extra'){const v=r.v;return '<tr data-extra="'+esc(v.id)+'" tabindex="0"><td class="cal-a-date">'+esc(dayLabel(v.date))+'</td><td><strong>'+esc(v.title)+'</strong><small>On YouTube, not in the plan</small></td><td>'+pillFor('extra')+'</td><td class="num">'+compact(v.views)+'</td><td class="muted">—</td><td></td></tr>'}
   const e=r.e,st=stateOf(e),sp=sponsorOf(e),y=e.yt,moved=r.date!==e.date;
   const sub=[y&&y.title&&y.title.toLowerCase()!==String(e.text).toLowerCase()?'YouTube: '+y.title:'',moved?'Planned '+fmtDay(e.date):''].filter(Boolean).join(' · ');
   const deal=sp?(sp.saved?'<span class="cal-deal '+statusClass(sp.status)+'">'+esc(sp.status||'No status')+'</span>':'<span class="cal-deal sp-suggested">Confirm?</span>'):'';
   return '<tr data-edit-date="'+e.date+'" tabindex="0"><td class="cal-a-date">'+esc(dayLabel(r.date))+'</td><td>'+(isUntitled(e)?'<strong class="cal-untitled">+ Add title</strong>':'<strong>'+esc(shortTitle(e,sp&&sp.name))+'</strong>')+(sub?'<small>'+esc(sub)+'</small>':'')+'</td><td>'+pillFor(st)+'</td><td class="num">'+(y?compact(y.views):'<span class="muted">—</span>')+'</td><td>'+(sp?'<span class="cal-a-sponsor'+(sp.saved?'':' suggested')+'" data-sponsor-date="'+e.date+'">◆ '+esc(sp.name)+'</span>':'<span class="muted">—</span>')+'</td><td>'+deal+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}
function renderSummary(list){
 const pub=list.filter(e=>stateOf(e)==='published'),up=list.filter(e=>stateOf(e)==='scheduled'),late=list.filter(e=>stateOf(e)==='overdue');
 const views=pub.reduce((n,e)=>n+(e.yt?.views||0),0),sp=list.filter(e=>e.sponsor);
 const by=s=>sp.filter(e=>e.sponsorStatus===s).length;
 const pills=[
  '<span class="cal-sum">'+list.length+' planned</span>',
  '<span class="cal-sum cal-published">✓ '+pub.length+' published'+(views?' · '+compact(views)+' views':'')+'</span>',
  '<span class="cal-sum cal-scheduled">◷ '+up.length+' upcoming</span>',
  late.length?'<span class="cal-sum cal-overdue">! '+late.length+' not live yet</span>':'',
  sp.length?'<span class="cal-sum cal-sponsored">◆ '+sp.length+' sponsored'+(by('Paid')||by('Invoiced')||by('In progress')?' — '+[by('Paid')&&by('Paid')+' paid',by('Invoiced')&&by('Invoiced')+' invoiced',by('In progress')&&by('In progress')+' in progress'].filter(Boolean).join(', '):'')+'</span>':''
 ].join('');
 const y=state.youtube||{};
 const ytLine=!y.configured?'<span class="cal-yt-note">Connect YouTube to mark videos published automatically — see the README (“YouTube on the calendar”).</span>'
  :y.error?'<span class="cal-yt-note error">YouTube: '+esc(y.error)+'</span>'
  :'<span class="cal-yt-note">YouTube: '+esc(y.channel?.title||'')+' · '+compact(y.channel?.subscribers)+' subscribers · updated on Refresh</span>';
 const key='<span class="cal-key"><b>Key</b><i class="k-scheduled"></i>Upcoming<i class="k-overdue"></i>Not live yet<i class="k-published"></i>Published<span class="cal-key-sep"></span><b>◆ Sponsor deal</b><i class="k-in-progress"></i>In progress<i class="k-invoiced"></i>Invoiced<i class="k-paid"></i>Paid<i class="k-suggested"></i>Suggested</span>';
 $('calendarSummary').innerHTML='<div class="cal-sum-row">'+pills+'</div>'+key+ytLine;
}
function render(){
 const start=state.start,end=Math.min(12,start+3),inRange=d=>{const m=Number(d.slice(5,7))-1;return m>=start&&m<end};
 const list=state.events.filter(e=>inRange(shownOn(e))),extras=state.extras.filter(v=>v.date.startsWith('2026-')&&inRange(v.date));
 const months=Array.from({length:end-start},(_,i)=>new Date(2026,start+i,1).toLocaleDateString('en-GB',{month:'long'}));
 $('calendarRange').textContent=months.join(' · ')+' 2026';
 $('calendarPrevious').disabled=start===0;$('calendarNext').disabled=start>=9;
 renderSummary(list);
 $('calendarGrid').innerHTML=months.map((name,k)=>{
  const month=start+k,days=new Date(2026,month+1,0).getDate(),offset=(new Date(2026,month,1).getDay()+6)%7;
  const heads=['M','T','W','T','F','S','S'].map(x=>'<span>'+x+'</span>').join('');
  const blank=Array.from({length:offset},()=>'<span class="calendar-empty-day"></span>').join('');
  const cells=Array.from({length:days},(_,i)=>{
    const day=i+1,date=iso(month,day),items=state.events.filter(x=>shownOn(x)===date),ext=extras.filter(v=>v.date===date),today=date===todayIso(),taken=items.length||state.events.some(x=>x.date===date);
    return '<div class="calendar-day'+(today?' calendar-today':'')+'" data-calendar-date="'+date+'"><span class="calendar-day-number">'+day+'</span>'+
      items.map(chip).join('')+ext.map(extraChip).join('')+
      (!taken?'<button class="calendar-empty-add" type="button" data-add-date="'+date+'" aria-label="Schedule a video on '+date+'">＋</button>':'')+'</div>';
   }).join('');
  return '<section class="calendar-month"><h3>'+name+' <small>2026</small></h3><div class="calendar-weekdays">'+heads+'</div><div class="calendar-days">'+blank+cells+'</div></section>';
 }).join('');
 renderAgenda(list,extras);
}

/* ---------- editor ---------- */
async function loadBrands(){
 if(state.brands)return state.brands;
 const fromTab=window.StudioSponsorships?.brandNames?.();if(fromTab&&fromTab.length)return(state.brands=fromTab);
 try{const board=window.StudioBoard?.getState();const r=await fetch('/.netlify/functions/sponsorships',{method:'POST',headers:{'content-type':'application/json','x-board-key':board.code},body:JSON.stringify({action:'sponsorList'})});const d=await r.json();
  if(r.ok&&d.ok){const rank=s=>/signed/i.test(s)?0:/their reply|josh|conversation/i.test(s)?1:2;state.brands=d.brands.slice().sort((a,b)=>rank(a.status)-rank(b.status)||a.name.localeCompare(b.name)).map(b=>b.name);}}
 catch{}
 return state.brands||[];
}
function suggestSponsor(text,brands){
 const m=String(text||'').match(/\(([^)]+)\)\s*$/);if(!m)return'';const hint=m[1].trim().toLowerCase();if(hint.length<2)return'';
 return brands.find(b=>b.toLowerCase()===hint)||brands.find(b=>b.toLowerCase().includes(hint))||brands.find(b=>{const w=b.toLowerCase().split(/[\s—–-]+/)[0];return w.length>=4&&hint.includes(w)})||'';
}
function renderYt(e){
 const box=$('calendarYt'),y=e&&e.yt;
 if(!y){box.hidden=!e;box.innerHTML=e?'<p class="cal-yt-empty">'+(state.youtube.configured?(stateOf(e)==='overdue'?'No video found on the channel within 3 days of this date. If it went out, paste its link below.':'Not live yet — this turns green automatically once the video is published on the channel.'):'Connect YouTube to see live stats here.')+'</p>':'';return}
 const age=Math.max(0,Math.round((Date.now()-new Date(y.publishedAt).getTime())/86400000));
 box.hidden=false;
 box.innerHTML='<a class="cal-yt-card" href="'+esc(y.url)+'" target="_blank" rel="noopener noreferrer">'+(y.thumb?'<img src="'+esc(y.thumb)+'" alt="" loading="lazy">':'')+'<span><strong>'+esc(y.title)+'</strong><small>Published '+esc(fmtDay(y.date))+' · '+age+' day'+(age===1?'':'s')+' live · '+esc(dur(y.seconds))+'</small></span></a>'+
  '<div class="cal-yt-stats"><span><b>'+compact(y.views)+'</b>views</span><span><b>'+compact(y.likes)+'</b>likes</span><span><b>'+compact(y.comments)+'</b>comments</span><span><b>'+compact(age?y.views/age:y.views)+'</b>views / day</span></div>'+
  '<p class="cal-yt-match">'+(y.matchedBy==='link'?'Linked by the YouTube link below.':y.matchedBy==='date'?'Matched automatically: published on this date.':y.matchedBy==='title'?'Matched by topic: planned for '+esc(fmtDay(e.date))+', went out '+esc(fmtDay(y.date))+'. Wrong video? Paste the right link below.':'Matched automatically: published within 3 days of this date. Wrong video? Paste the right link below.')+'</p>'+
  (y.date!==e.date&&y.date.startsWith('2026-')?'<button type="button" class="quiet-btn cal-move-live" data-move-from="'+esc(e.date)+'" data-move-to="'+esc(y.date)+'">Move this entry to '+esc(fmtDay(y.date))+' in the sheet</button>':'');
}
async function showEditor(date=null,extra=null){
 const existing=date?state.events.find(e=>e.date===date):null;
 state.editing=existing||null;state.from=existing?.date||null;state.previousText=existing?.text||'';
 const st=existing?stateOf(existing):null;
 $('calendarEditorTitle').textContent=existing?(st==='published'?'Published video.':'Edit publishing slot.'):'Schedule a video.';
 $('calendarStateBadge').hidden=!existing;if(existing){$('calendarStateBadge').className='cal-state-badge cal-'+st;$('calendarStateBadge').textContent=STATE_LABEL[st];}
 $('calendarText').value=existing?.text||extra?.title||'';$('calendarDate').value=existing?.date||extra?.date||date||iso(state.start,1);
 $('calendarViews').value=existing?.views??'';$('calendarCtr').value=existing?.ctr??'';$('calendarAvd').value=existing?.avd??'';
 $('calendarSponsor').value=existing?.sponsor||'';$('calendarSponsorStatus').value=existing?.sponsorStatus||'';
 $('calendarYoutube').value=existing?.youtubeUrl||(extra?extra.url:'');
 $('calendarSponsorHint').textContent='';
 renderYt(existing);
 $('calendarDelete').hidden=!existing;$('calendarOverlay').hidden=false;document.body.style.overflow='hidden';$('calendarText').focus();
 if(existing&&isUntitled(existing))$('calendarText').select();
 const brands=await loadBrands();
 $('calendarSponsorOptions').innerHTML=brands.map(b=>'<option value="'+esc(b)+'"></option>').join('');
 if(existing&&!existing.sponsor&&state.editing===existing){const s=suggestSponsor(existing.text,brands);if(s){$('calendarSponsor').value=s;$('calendarSponsorStatus').value=$('calendarSponsorStatus').value||'In progress';$('calendarSponsorHint').textContent='Suggested from the title — clear it if that\'s wrong.';}}
}
function closeEditor(){$('calendarOverlay').hidden=true;document.body.style.overflow='';state.editing=null}
function show(tab){
 const isCalendar=tab==='calendar';
 $('calendarWorkspace').hidden=!isCalendar;
 if(isCalendar){$('weeklyWorkspace').hidden=true;$('productionWorkspace').hidden=true;$('sponsorWorkspace')&&($('sponsorWorkspace').hidden=true);if(!state.loaded)refresh();}
}
async function save(payload){
 if(state.busy)return;state.busy=true;$('calendarSave').disabled=true;$('calendarDelete').disabled=true;
 try{const data=await api(payload);apply(data);closeEditor();notice('Saved to Google Sheets.');}
 catch(e){notice(e.message,true);}
 finally{state.busy=false;$('calendarSave').disabled=false;$('calendarDelete').disabled=false;}
}
const metricsOf=item=>({views:item.views||'',ctr:item.ctr||'',avd:item.avd||'',sponsor:item.sponsor||'',sponsorStatus:item.sponsorStatus||'',youtubeUrl:item.youtubeUrl||''});
async function onMove(from,date){
 const item=state.events.find(x=>x.date===from);if(!item||from===date)return;
 if(state.events.some(x=>x.date===date)){notice('That day already has a plan. Move to an empty date or edit an existing entry.',true);return}
 const data=await api({action:'save',from,previousText:item.text,date,text:item.text,metrics:metricsOf(item)});
 apply(data);notice('Moved to '+date+' in Google Sheets.');
}
function boot(){
 $('calendarSponsorStatus').innerHTML='<option value="">No sponsor status</option>'+SPONSOR_STATUSES.map(s=>'<option>'+s+'</option>').join('');
 document.querySelectorAll('[data-view-tab]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.viewTab)));
 $('calendarRefresh').addEventListener('click',refresh);
 $('calendarPrevious').addEventListener('click',()=>{state.start=Math.max(0,state.start-3);render()});
 $('calendarNext').addEventListener('click',()=>{state.start=Math.min(9,state.start+3);render()});
 $('calendarNew').addEventListener('click',()=>showEditor());
 const onPick=e=>{const edit=e.target.closest('[data-edit-date]'),add=e.target.closest('[data-add-date]'),ext=e.target.closest('[data-extra]');
  const spon=e.target.closest('[data-sponsor-date]');
  if(spon){showEditor(spon.dataset.sponsorDate).then(()=>{$('calendarSponsorStatus').scrollIntoView({block:'center'});$('calendarSponsorStatus').focus()});return}
  if(edit)showEditor(edit.dataset.editDate);else if(ext){const v=state.extras.find(x=>x.id===ext.dataset.extra);if(v&&state.events.some(x=>x.date===v.date)){window.open(v.url,'_blank','noopener');}else if(v)showEditor(null,v);}else if(add)showEditor(add.dataset.addDate)};
 $('calendarGrid').addEventListener('click',onPick);$('calendarAgenda').addEventListener('click',onPick);
 $('calendarAgenda').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('tr'))onPick(e)});
 $('calendarGrid').addEventListener('dragstart',e=>{const el=e.target.closest('[data-edit-date]');if(el){e.dataTransfer.setData('text/plain',el.dataset.editDate);e.dataTransfer.effectAllowed='move';}});
 $('calendarGrid').addEventListener('dragover',e=>{if(e.target.closest('[data-calendar-date]'))e.preventDefault()});
 $('calendarGrid').addEventListener('drop',async e=>{const day=e.target.closest('[data-calendar-date]');if(!day)return;e.preventDefault();const from=e.dataTransfer.getData('text/plain');if(!from)return;try{await onMove(from,day.dataset.calendarDate)}catch(err){notice(err.message,true)}});
 $('calendarForm').addEventListener('submit',e=>{e.preventDefault();
  const sponsor=$('calendarSponsor').value.trim();
  save({action:'save',from:state.from,previousText:state.previousText,date:$('calendarDate').value,text:$('calendarText').value.trim(),
   metrics:{views:$('calendarViews').value,ctr:$('calendarCtr').value,avd:$('calendarAvd').value,sponsor,sponsorStatus:sponsor?$('calendarSponsorStatus').value:'',youtubeUrl:$('calendarYoutube').value.trim()}})});
 $('calendarDelete').addEventListener('click',()=>{if(state.from&&confirm('Remove this publishing slot from the source spreadsheet?'))save({action:'remove',from:state.from,previousText:state.previousText})});
 $('calendarOverlay').addEventListener('click',async e=>{if(e.target.closest('[data-calendar-close]')){closeEditor();return}
  const mv=e.target.closest('[data-move-from]');if(!mv)return;mv.disabled=true;
  try{const item=state.events.find(x=>x.date===mv.dataset.moveFrom);if(item&&!item.youtubeUrl&&item.yt)item.youtubeUrl=item.yt.url;await onMove(mv.dataset.moveFrom,mv.dataset.moveTo);closeEditor()}catch(err){notice(err.message,true);mv.disabled=false}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('calendarOverlay').hidden)closeEditor()});
 const previous=sessionStorage.getItem('studio-active-tab');show(previous==='calendar'?'calendar':'weekly');if(previous==='calendar'){$('weeklyWorkspace').hidden=true;$('productionWorkspace').hidden=true;}
}
boot();
})();
