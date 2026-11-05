(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={events:[],extras:[],youtube:{},bridgeVersion:0,start:null,loaded:false,busy:false,loading:null,error:'',from:null,previousText:'',brands:null,editing:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Months are counted from January 2026 (0) so the quarter view can run on into later years; one sheet tab per year. */
const FIRST_YEAR=2026,LAST_YEAR=2030,MAX_START=(LAST_YEAR-FIRST_YEAR)*12+9;
const yearOf=abs=>FIRST_YEAR+Math.floor(abs/12),monthOf=abs=>abs%12;
const iso=(abs,d)=>yearOf(abs)+'-'+String(monthOf(abs)+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
const absOf=date=>(Number(date.slice(0,4))-FIRST_YEAR)*12+Number(date.slice(5,7))-1;
const currentQuarterStart=()=>{const a=absOf(new Date().toLocaleDateString('en-CA'));return Math.min(MAX_START,Math.max(0,a-a%3))};
const todayIso=()=>new Date().toLocaleDateString('en-CA');
const compact=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(n)||0);
const fmtDay=d=>new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
const dur=s=>{s=Number(s)||0;const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')};
const SPONSOR_STATUSES=['In progress','Invoiced','Paid'];
const notice=(text,error=false)=>{const el=$('calendarNotice');el.hidden=!text;el.textContent=text;el.classList.toggle('error',error)};

/* published = a matching long-form video is live on the channel; otherwise yellow until the day passes, then orange */
const shownOn=e=>stateOf(e)==='published'&&e.yt?.date&&e.yt.date>=FIRST_YEAR+'-01-01'?e.yt.date:e.date;
function stateOf(e){if(e.yt&&e.yt.live!=='upcoming')return'published';return e.date<todayIso()?'overdue':'scheduled'}
const STATE_LABEL={published:'Published',scheduled:'Upcoming',overdue:'Not live yet'};
const statusClass=s=>'sp-'+String(s||'none').toLowerCase().replace(/\s+/g,'-');

async function api(payload){
 const board=window.StudioBoard?.getState();if(!board||board.mode!=='notion')throw Error('Connect your Notion workspace first to use the shared calendar.');
 const resp=await fetch('/.netlify/functions/calendar',{method:'POST',headers:{'content-type':'application/json','x-board-key':board.code},body:JSON.stringify(payload)});
 const text=await resp.text();let data;try{data=JSON.parse(text)}catch{throw Error(resp.status===502||resp.status===504?'The calendar took too long to answer. Press Refresh.':'Calendar server returned an unexpected response.')}
 if(!resp.ok||!data.ok)throw Error(data.error||'Calendar request failed.');return data;
}
function apply(data){state.events=data.events||[];state.youtube=data.youtube||{};state.extras=data.youtube?.extras||[];state.bridgeVersion=Number(data.bridgeVersion)||0;state.loaded=true;state.error='';render();window.Studio.emit('data',{source:'calendar'});
 if(!state.brands)loadBrands().then(b=>{if(b&&b.length){render();window.Studio.emit('data',{source:'calendar'})}})}
/* fresh=true asks YouTube for new numbers (the Refresh button); Today's quiet load reuses the server's 10-minute cache. */
function refresh(fresh=true){
 if(state.loading)return state.loading;
 if(state.busy)return Promise.resolve();
 state.loading=(async()=>{
  $('calendarRefresh').disabled=true;notice('Loading the content plan from Google Sheets…');
  try{const r=await api({action:'list',fresh:Boolean(fresh)});apply(r);notice(state.bridgeVersion<3?'Sponsor details, YouTube links and planning into 2027 need the updated Apps Script: paste the new Code.gs into Studio bridge and deploy a new version.':'');$('calendarSetupHelp').hidden=true;}
  catch(e){state.error=e.message;notice(e.message,true);const needsSetup=/not configured|calendar readme|apps script url|connection is not configured/i.test(e.message);$('calendarSetupHelp').hidden=!needsSetup;if(!state.loaded){$('calendarGrid').innerHTML='<div class="calendar-empty">Your content plan is still safely stored in Google Sheets. Connect the calendar integration to view and edit it here.</div>';}window.Studio.emit('data',{source:'calendar'});}
  finally{$('calendarRefresh').disabled=false}
 })().finally(()=>{state.loading=null;});
 return state.loading;
}
const ensureLoaded=()=>state.loaded?Promise.resolve():refresh(false);

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
 $('calendarAgenda').innerHTML='<div class="cal-agenda-head"><h3>'+(state.start===currentQuarterStart()?'This quarter':esc($('calendarRange').textContent))+'</h3><span>'+rows.length+' video'+(rows.length===1?'':'s')+' · click a row to open it</span></div><div class="cal-agenda-wrap"><table class="cal-agenda"><thead><tr><th>Date</th><th>Video</th><th>Status</th><th class="num">Views</th><th>Sponsor</th><th>Deal</th></tr></thead><tbody>'+
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
 if(state.start==null)state.start=currentQuarterStart();
 const start=state.start,end=start+3,inRange=d=>{const a=absOf(d);return a>=start&&a<end};
 const list=state.events.filter(e=>inRange(shownOn(e))),extras=state.extras.filter(v=>v.date>=FIRST_YEAR+'-01-01'&&inRange(v.date));
 const months=Array.from({length:3},(_,i)=>new Date(yearOf(start+i),monthOf(start+i),1).toLocaleDateString('en-GB',{month:'long'}));
 $('calendarRange').textContent=months.join(' · ')+' '+yearOf(start);
 $('calendarPrevious').disabled=start<=0;$('calendarNext').disabled=start>=MAX_START;
 $('calendarThisQuarter').hidden=start===currentQuarterStart();
 renderSummary(list);
 $('calendarGrid').innerHTML=months.map((name,k)=>{
  const month=start+k,yr=yearOf(month),mo=monthOf(month),days=new Date(yr,mo+1,0).getDate(),offset=(new Date(yr,mo,1).getDay()+6)%7;
  const heads=['M','T','W','T','F','S','S'].map(x=>'<span>'+x+'</span>').join('');
  const blank=Array.from({length:offset},()=>'<span class="calendar-empty-day"></span>').join('');
  const cells=Array.from({length:days},(_,i)=>{
    const day=i+1,date=iso(month,day),items=state.events.filter(x=>shownOn(x)===date),ext=extras.filter(v=>v.date===date),today=date===todayIso(),taken=items.length||state.events.some(x=>x.date===date);
    return '<div class="calendar-day'+(today?' calendar-today':'')+'" data-calendar-date="'+date+'"><span class="calendar-day-number">'+day+'</span>'+
      items.map(chip).join('')+ext.map(extraChip).join('')+
      (!taken?'<button class="calendar-empty-add" type="button" data-add-date="'+date+'" aria-label="Schedule a video on '+date+'">＋</button>':'')+'</div>';
   }).join('');
  return '<section class="calendar-month"><h3>'+name+' <small>'+yr+'</small></h3><div class="calendar-weekdays">'+heads+'</div><div class="calendar-days">'+blank+cells+'</div></section>';
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
  (y.date!==e.date&&y.date>=FIRST_YEAR+'-01-01'?'<button type="button" class="quiet-btn cal-move-live" data-move-from="'+esc(e.date)+'" data-move-to="'+esc(y.date)+'">Move this entry to '+esc(fmtDay(y.date))+' in the sheet</button>':'');
}
const LINK_DAYS=14;
const daysApart=(a,b)=>Math.abs(Math.round((new Date(a+'T12:00:00')-new Date(b+'T12:00:00'))/86400000));
/* Manual pairing when titles share nothing: an unmatched plan entry ↔ an unplanned upload within 14 days. */
function renderLinkOptions(existing,extra){
 const box=$('calendarLink');let html='';
 if(existing&&!existing.yt&&state.youtube.configured){
  const c=state.extras.filter(v=>daysApart(v.date,existing.date)<=LINK_DAYS).sort((a,b)=>daysApart(a.date,existing.date)-daysApart(b.date,existing.date));
  if(c.length)html='<p class="cal-link-q">Did this go out as one of these?</p>'+c.map(v=>'<button type="button" class="cal-link-opt" data-link-entry="'+esc(existing.date)+'" data-link-video="'+esc(v.id)+'"><span><strong>'+esc(v.title)+'</strong><small>'+esc(fmtDay(v.date))+' · '+compact(v.views)+' views</small></span><b>This is it ↗</b></button>').join('');
 }
 if(extra){
  const c=state.events.filter(e=>!e.yt&&daysApart(e.date,extra.date)<=LINK_DAYS).sort((a,b)=>daysApart(a.date,extra.date)-daysApart(b.date,extra.date));
  if(c.length)html='<p class="cal-link-q">Is this one of your planned videos?</p>'+c.map(e=>'<button type="button" class="cal-link-opt" data-link-entry="'+esc(e.date)+'" data-link-video="'+esc(extra.id)+'"><span><strong>'+esc(shortTitle(e,sponsorOf(e)?.name))+'</strong><small>Planned '+esc(fmtDay(e.date))+' · '+esc(STATE_LABEL[stateOf(e)])+'</small></span><b>Link it ↗</b></button>').join('')+'<p class="cal-link-q small">Otherwise, fill in the form below to add it to the plan as a new entry.</p>';
 }
 box.innerHTML=html;box.hidden=!html;
}
async function linkVideo(entryDate,videoId){
 const item=state.events.find(x=>x.date===entryDate),v=state.extras.find(x=>x.id===videoId);
 if(!item||!v)return;
 if(state.bridgeVersion<2){notice('Linking needs the updated Apps Script: paste the new Code.gs into Studio bridge and deploy a new version.',true);return}
 await save({action:'save',from:item.date,previousText:item.text,date:item.date,text:item.text,metrics:{...metricsOf(item),youtubeUrl:v.url}});
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
 renderYt(existing);renderLinkOptions(existing,extra);
 $('calendarDelete').hidden=!existing;$('calendarOverlay').hidden=false;document.body.style.overflow='hidden';$('calendarText').focus();
 window.Studio.setItem('calendar',existing?[existing.date]:null);
 if(existing&&isUntitled(existing))$('calendarText').select();
 const brands=await loadBrands();
 $('calendarSponsorOptions').innerHTML=brands.map(b=>'<option value="'+esc(b)+'"></option>').join('');
 if(existing&&!existing.sponsor&&state.editing===existing){const s=suggestSponsor(existing.text,brands);if(s){$('calendarSponsor').value=s;$('calendarSponsorStatus').value=$('calendarSponsorStatus').value||'In progress';$('calendarSponsorHint').textContent='Suggested from the title — clear it if that\'s wrong.';}}
}
function closeEditor(){if($('calendarOverlay').hidden)return;$('calendarOverlay').hidden=true;document.body.style.overflow='';state.editing=null;window.Studio.setItem('calendar',null)}
function show(tab){
 if(tab==='calendar')window.Studio.ready.then(()=>state.loaded?null:refresh());
}
/* Open a slot by its planned date (links and Today). The grid jumps to that quarter behind the drawer. */
async function openDate(date){
 if(!/^\d{4}-\d\d-\d\d$/.test(String(date||'')))return;
 await ensureLoaded();if(!state.loaded)return;
 const a=absOf(date);if(a>=0&&a<=MAX_START+2){state.start=Math.min(MAX_START,a-a%3);render();}
 if(!state.events.some(e=>e.date===date)){window.StudioBoard?.toast('Nothing is planned on '+fmtDay(date)+' any more — it may have been moved.');return;}
 await showEditor(date);
}
async function save(payload){
 if(state.busy)return;
 if(payload.date&&payload.date>=(FIRST_YEAR+1)+'-01-01'&&state.bridgeVersion<3){notice('Planning '+payload.date.slice(0,4)+' needs the updated Apps Script: paste the new Code.gs into Studio bridge and deploy a new version.',true);return}state.busy=true;$('calendarSave').disabled=true;$('calendarDelete').disabled=true;
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
 window.Studio.on('tab',({tab})=>show(tab));
 window.Studio.on('connection',()=>{state.loaded=false;state.events=[];state.extras=[];state.brands=null;if(window.Studio.current()==='calendar')refresh();});
 $('calendarRefresh').addEventListener('click',()=>refresh(true));
 $('calendarPrevious').addEventListener('click',()=>{state.start=Math.max(0,state.start-3);render()});
 $('calendarNext').addEventListener('click',()=>{state.start=Math.min(MAX_START,state.start+3);render()});
 $('calendarThisQuarter').addEventListener('click',()=>{state.start=currentQuarterStart();render()});
 $('calendarNew').addEventListener('click',()=>showEditor());
 const onPick=e=>{const edit=e.target.closest('[data-edit-date]'),add=e.target.closest('[data-add-date]'),ext=e.target.closest('[data-extra]');
  const spon=e.target.closest('[data-sponsor-date]');
  if(spon){showEditor(spon.dataset.sponsorDate).then(()=>{$('calendarSponsorStatus').scrollIntoView({block:'center'});$('calendarSponsorStatus').focus()});return}
  if(edit)showEditor(edit.dataset.editDate);else if(ext){const v=state.extras.find(x=>x.id===ext.dataset.extra);if(v)showEditor(null,v);}else if(add)showEditor(add.dataset.addDate)};
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
  const ln=e.target.closest('[data-link-entry]');if(ln){ln.disabled=true;await linkVideo(ln.dataset.linkEntry,ln.dataset.linkVideo);ln.disabled=false;return}
  const mv=e.target.closest('[data-move-from]');if(!mv)return;mv.disabled=true;
  try{const item=state.events.find(x=>x.date===mv.dataset.moveFrom);if(item&&!item.youtubeUrl&&item.yt)item.youtubeUrl=item.yt.url;await onMove(mv.dataset.moveFrom,mv.dataset.moveTo);closeEditor()}catch(err){notice(err.message,true);mv.disabled=false}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('calendarOverlay').hidden)closeEditor()});
 window.Studio.register('calendar',{open:item=>openDate(item[0]),close:closeEditor});
}
window.StudioCalendar={ensureLoaded,refresh,loaded:()=>state.loaded,error:()=>state.error,events:()=>state.events,stateOf,shownOn,sponsorOf,shortTitle,isUntitled,youtube:()=>state.youtube,open:openDate};
boot();
})();
