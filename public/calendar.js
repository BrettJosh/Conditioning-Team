(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={events:[],extras:[],youtube:{},bridgeVersion:0,start:null,loaded:false,busy:false,loading:null,error:'',from:null,previousText:'',brands:null,brandRecords:null,editing:null,
 history:{videos:[],channel:null,loaded:false,loading:null,error:'',view:'brands',q:'',deals:{},dealsError:'',showHidden:false,saving:{}}}; // every upload on the channel, for the sponsor history
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

/* Release rhythm: two videos a month, on the 2nd and 4th Friday, two weeks apart, in step with the plan
 * (13 & 27 Nov, 11 Dec 2026…). A month counts its planned videos: with two or more it shows no slots; with one, that video
 * fills the nearer Friday and the other stays open, so the pair stays roughly two weeks apart (26 Dec covers the 25th).
 * Slots are only drawn, never saved: giving one a title, or dragging it to another day, adds it to the sheet. */
const SLOT_FRIDAYS=[2,4],SLOT_LABEL='2nd and 4th Friday';
const dayNum=d=>Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))/86400000;
const pad2=n=>String(n).padStart(2,'0');
function releaseFridays(y,m){const first=new Date(Date.UTC(y,m,1)).getUTCDay(),firstFri=1+(5-first+7)%7;return SLOT_FRIDAYS.map(n=>y+'-'+pad2(m+1)+'-'+pad2(firstFri+(n-1)*7));}
function openSlots(from,to){
 if(to>LAST_YEAR+'-12-31')to=LAST_YEAR+'-12-31';
 const out=[],live=state.events.map(shownOn);
 for(let y=+from.slice(0,4),m=+from.slice(5,7)-1;y+'-'+pad2(m+1)<=to.slice(0,7);m===11?(m=0,y++):m++){
  const month=y+'-'+pad2(m+1),open=releaseFridays(y,m);
  live.filter(d=>d.startsWith(month)).sort().forEach(d=>{ // each planned video fills the nearest open Friday
   if(!open.length)return;let best=0;open.forEach((f,i)=>{if(Math.abs(dayNum(f)-dayNum(d))<Math.abs(dayNum(open[best])-dayNum(d)))best=i;});open.splice(best,1);
  });
  open.forEach(f=>{if(f>=from&&f<=to)out.push(f);});
 }
 return out;
}

async function api(payload){
 const board=window.StudioBoard?.getState();if(!board||board.mode!=='notion')throw Error('Connect your Notion workspace first to use the shared calendar.');
 const resp=await fetch('/.netlify/functions/calendar',{method:'POST',headers:{'content-type':'application/json','x-board-key':board.code},body:JSON.stringify(payload)});
 const text=await resp.text();let data;try{data=JSON.parse(text)}catch{throw Error(resp.status===502||resp.status===504?'The calendar took too long to answer. Press Refresh.':'Calendar server returned an unexpected response.')}
 if(!resp.ok||!data.ok)throw Error(data.error||'Calendar request failed.');return data;
}
function apply(data){learned=null;state.events=data.events||[];state.youtube=data.youtube||{};state.extras=data.youtube?.extras||[];state.bridgeVersion=Number(data.bridgeVersion)||0;state.loaded=true;state.error='';render();window.Studio.emit('data',{source:'calendar'});
 if(!state.brands)loadBrands().then(b=>{if(b&&b.length){render();window.Studio.emit('data',{source:'calendar'})}})}
/* fresh=true asks YouTube for new numbers (the Refresh button); Today's quiet load reuses the server's 10-minute cache. */
function refresh(fresh=true){
 if(state.loading)return state.loading;
 if(state.busy)return Promise.resolve();
 state.loading=(async()=>{
  $('calendarRefresh').disabled=true;notice('Loading the content plan from Google Sheets…');
  try{const r=await api({action:'list',fresh:Boolean(fresh)});apply(r);notice(state.bridgeVersion<3?'Sponsor details, YouTube links and planning into 2027 need the updated Apps Script: paste the new Code.gs into Studio bridge and deploy a new version.':'');$('calendarSetupHelp').hidden=true;
   if(window.Studio.current()==='calendar'&&(fresh||!state.history.loaded))loadHistory(fresh);}
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
/* The sponsor shown on an entry: saved in the sheet; else suggested from "(Brand)" in the title; else from the link at the top of the
 * YouTube description once the video is live (matched to a brand in the Sponsorship tracker when it can be). */
function sponsorOf(item){
 if(item.sponsor)return{name:item.sponsor,status:item.sponsorStatus||'',saved:true};
 const fromTitle=suggestSponsor(item.text,state.brands||[]);
 if(fromTitle)return{name:fromTitle,status:'',saved:false,source:'title'};
 const d=linkSponsor(item.yt&&item.yt.sponsor);
 return d&&d.name?{name:d.name,status:'',saved:false,source:'description',line:d.line,url:d.url,domain:d.domain,brand:d.brand}:null;
}
const lineText=l=>String(l||'').replace(/https?:\/\/\S+|www\.\S+/g,'').replace(/\s+/g,' ').replace(/[\s:;,-]+$/,'').trim();
const suggestedLabel=sp=>sp.source==='description'?'From the video description, click to confirm':'Suggested, click to confirm';
function tooltip(item){
 const st=stateOf(item),y=item.yt,sp=sponsorOf(item),lines=[item.text,STATE_LABEL[st]+(y?' · '+compact(y.views)+' views':'')];
 if(shownOn(item)!==item.date)lines.push('Planned '+fmtDay(item.date)+', went out '+fmtDay(shownOn(item)));
 if(sp)lines.push('Sponsor: '+sp.name+', '+(sp.saved?(sp.status||'status not set'):sp.source==='description'?'suggested from the description, click to confirm':'suggested from the title, click to confirm'));
 if(sp&&sp.line)lines.push('Description: '+sp.line);
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
 const label=sp.saved?(sp.status||'No status'):suggestedLabel(sp);
 return '<button class="cal-sponsor '+(sp.saved?statusClass(sp.status):'sp-suggested')+'" type="button" data-sponsor-date="'+item.date+'" title="'+esc('Sponsor: '+sp.name+', '+label)+'" aria-label="'+esc('Sponsor '+sp.name+', '+label)+'"><span class="cal-sponsor-name">◆ '+esc(sp.name)+(sp.saved?'':' ?')+'</span></button>';
}
function slotChip(date){return '<button class="calendar-event cal-slot" type="button" draggable="true" data-slot-date="'+date+'" title="Release slot: two videos a month, on the '+SLOT_LABEL+'. Click to plan a video here, or drag it to another day."><span class="cal-ev-title cal-untitled">+ Add title</span><span class="cal-ev-meta">◌ Slot</span></button>'}
function extraChip(v){return '<button class="calendar-event cal-extra" type="button" data-extra="'+esc(v.id)+'" title="'+esc(v.title+'\nOn YouTube but not in the plan · '+compact(v.views)+' views. Click to add it.')+'"><span class="cal-ev-title">'+esc(v.title)+'</span><span class="cal-ev-meta">✓ '+compact(v.views)+' · unplanned</span></button>'}

/* The readable version: one row per video in the quarter. */
const pillFor=st=>'<span class="cal-pill cal-'+st+'">'+(st==='published'?'✓ Published':st==='overdue'?'! Not live yet':st==='extra'?'✓ Live, not planned':st==='slot'?'◌ Open slot':'◷ Upcoming')+'</span>';
function renderAgenda(list,extras,slots=[]){
 const rows=[...list.map(e=>({kind:'plan',e,date:shownOn(e)})),...extras.map(v=>({kind:'extra',v,date:v.date})),...slots.map(d=>({kind:'slot',date:d}))].sort((a,b)=>a.date.localeCompare(b.date));
 if(!rows.length){$('calendarAgenda').innerHTML='';return}
 const dayLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
 $('calendarAgenda').innerHTML='<div class="cal-agenda-head"><h3>'+(state.start===currentQuarterStart()?'This quarter':esc($('calendarRange').textContent))+'</h3><span>'+rows.length+' video'+(rows.length===1?'':'s')+' · click a row to open it</span></div><div class="cal-agenda-wrap"><table class="cal-agenda"><thead><tr><th>Date</th><th>Video</th><th>Status</th><th class="num">Views</th><th>Sponsor</th><th>Deal</th></tr></thead><tbody>'+
  rows.map(r=>{
   if(r.kind==='slot')return '<tr class="cal-a-slot" data-slot-date="'+r.date+'" tabindex="0"><td class="cal-a-date">'+esc(dayLabel(r.date))+'</td><td><strong class="cal-untitled">+ Add title</strong><small>Release slot, '+SLOT_LABEL+'</small></td><td>'+pillFor('slot')+'</td><td class="num"><span class="muted">–</span></td><td><span class="muted">–</span></td><td></td></tr>';
   if(r.kind==='extra'){const v=r.v,d=linkSponsor(v.sponsor);return '<tr data-extra="'+esc(v.id)+'" tabindex="0"><td class="cal-a-date">'+esc(dayLabel(v.date))+'</td><td><strong>'+esc(v.title)+'</strong><small>On YouTube, not in the plan</small></td><td>'+pillFor('extra')+'</td><td class="num">'+compact(v.views)+'</td><td>'+(d&&d.name?'<span class="cal-a-sponsor suggested" title="'+esc('From the video description: '+d.line)+'">◆ '+esc(d.name)+'</span>':'<span class="muted">–</span>')+'</td><td>'+(d&&d.name?'<span class="cal-deal sp-suggested">Add to plan</span>':'')+'</td></tr>'}
   const e=r.e,st=stateOf(e),sp=sponsorOf(e),y=e.yt,moved=r.date!==e.date;
   const sub=[y&&y.title&&y.title.toLowerCase()!==String(e.text).toLowerCase()?'YouTube: '+y.title:'',moved?'Planned '+fmtDay(e.date):''].filter(Boolean).join(' · ');
   const deal=sp?(sp.saved?'<span class="cal-deal '+statusClass(sp.status)+'">'+esc(sp.status||'No status')+'</span>':'<span class="cal-deal sp-suggested">Confirm?</span>'):'';
   return '<tr data-edit-date="'+e.date+'" tabindex="0"><td class="cal-a-date">'+esc(dayLabel(r.date))+'</td><td>'+(isUntitled(e)?'<strong class="cal-untitled">+ Add title</strong>':'<strong>'+esc(shortTitle(e,sp&&sp.name))+'</strong>')+(sub?'<small>'+esc(sub)+'</small>':'')+'</td><td>'+pillFor(st)+'</td><td class="num">'+(y?compact(y.views):'<span class="muted">–</span>')+'</td><td>'+(sp?'<span class="cal-a-sponsor'+(sp.saved?'':' suggested')+'" data-sponsor-date="'+e.date+'" title="'+esc(sp.saved?'Sponsor: '+sp.name:suggestedLabel(sp)+(sp.line?'. '+sp.line:''))+'">◆ '+esc(sp.name)+'</span>':'<span class="muted">–</span>')+'</td><td>'+deal+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}
function renderSummary(list,slots=[]){
 const pub=list.filter(e=>stateOf(e)==='published'),up=list.filter(e=>stateOf(e)==='scheduled'),late=list.filter(e=>stateOf(e)==='overdue');
 const views=pub.reduce((n,e)=>n+(e.yt?.views||0),0),sp=list.filter(e=>e.sponsor),sug=list.filter(e=>!e.sponsor&&sponsorOf(e));
 const by=s=>sp.filter(e=>e.sponsorStatus===s).length;
 const pills=[
  '<span class="cal-sum">'+list.length+' planned</span>',
  '<span class="cal-sum cal-published">✓ '+pub.length+' published'+(views?' · '+compact(views)+' views':'')+'</span>',
  '<span class="cal-sum cal-scheduled">◷ '+up.length+' upcoming</span>',
  late.length?'<span class="cal-sum cal-overdue">! '+late.length+' not live yet</span>':'',
  slots.length?'<span class="cal-sum cal-slot">◌ '+slots.length+' open release slot'+(slots.length===1?'':'s')+'</span>':'',
  sp.length?'<span class="cal-sum cal-sponsored">◆ '+sp.length+' sponsored'+(by('Paid')||by('Invoiced')||by('In progress')?': '+[by('Paid')&&by('Paid')+' paid',by('Invoiced')&&by('Invoiced')+' invoiced',by('In progress')&&by('In progress')+' in progress'].filter(Boolean).join(', '):'')+'</span>':'',
  sug.length?'<span class="cal-sum cal-suggested" title="Sponsors read from video titles and the top of YouTube descriptions. Click a dashed sponsor card to confirm it.">◆ '+sug.length+' suggested sponsor'+(sug.length===1?'':'s')+' to confirm</span>':''
 ].join('');
 const y=state.youtube||{};
 const ytLine=!y.configured?'<span class="cal-yt-note">Connect YouTube to mark videos published automatically. See the README (“YouTube on the calendar”).</span>'
  :y.error?'<span class="cal-yt-note error">YouTube: '+esc(y.error)+'</span>'
  :'<span class="cal-yt-note">YouTube: '+esc(y.channel?.title||'')+' · '+compact(y.channel?.subscribers)+' subscribers · updated on Refresh</span>';
 const key='<span class="cal-key"><b>Key</b><i class="k-scheduled"></i>Upcoming<i class="k-overdue"></i>Not live yet<i class="k-published"></i>Published<i class="k-slot"></i>Release slot<span class="cal-key-sep"></span><b>◆ Sponsor deal</b><i class="k-in-progress"></i>In progress<i class="k-invoiced"></i>Invoiced<i class="k-paid"></i>Paid<i class="k-suggested"></i>Suggested</span>';
 $('calendarSummary').innerHTML='<div class="cal-sum-row">'+pills+'</div>'+key+ytLine;
}
function render(){
 if(state.start==null)state.start=currentQuarterStart();
 const start=state.start,end=start+3,inRange=d=>{const a=absOf(d);return a>=start&&a<end};
 const list=state.events.filter(e=>inRange(shownOn(e))),extras=state.extras.filter(v=>v.date>=FIRST_YEAR+'-01-01'&&inRange(v.date));
 const slots=openSlots(todayIso(),iso(end-1,new Date(yearOf(end-1),monthOf(end-1)+1,0).getDate())).filter(inRange),slotSet=new Set(slots);
 const months=Array.from({length:3},(_,i)=>new Date(yearOf(start+i),monthOf(start+i),1).toLocaleDateString('en-GB',{month:'long'}));
 $('calendarRange').textContent=months.join(' · ')+' '+yearOf(start);
 $('calendarPrevious').disabled=start<=0;$('calendarNext').disabled=start>=MAX_START;
 $('calendarThisQuarter').hidden=start===currentQuarterStart();
 renderSummary(list,slots);
 $('calendarGrid').innerHTML=months.map((name,k)=>{
  const month=start+k,yr=yearOf(month),mo=monthOf(month),days=new Date(yr,mo+1,0).getDate(),offset=(new Date(yr,mo,1).getDay()+6)%7;
  const heads=['M','T','W','T','F','S','S'].map(x=>'<span>'+x+'</span>').join('');
  const blank=Array.from({length:offset},()=>'<span class="calendar-empty-day"></span>').join('');
  const cells=Array.from({length:days},(_,i)=>{
    const day=i+1,date=iso(month,day),items=state.events.filter(x=>shownOn(x)===date),ext=extras.filter(v=>v.date===date),today=date===todayIso(),taken=items.length||state.events.some(x=>x.date===date);
    return '<div class="calendar-day'+(today?' calendar-today':'')+'" data-calendar-date="'+date+'"><span class="calendar-day-number">'+day+'</span>'+
      items.map(chip).join('')+ext.map(extraChip).join('')+
      (!taken&&slotSet.has(date)?slotChip(date):!taken?'<button class="calendar-empty-add" type="button" data-add-date="'+date+'" aria-label="Schedule a video on '+date+'">＋</button>':'')+'</div>';
   }).join('');
  return '<section class="calendar-month"><h3>'+name+' <small>'+yr+'</small></h3><div class="calendar-weekdays">'+heads+'</div><div class="calendar-days">'+blank+cells+'</div></section>';
 }).join('');
 renderAgenda(list,extras,slots);
 renderHistory();
}

/* ---------- sponsor history: every sponsor on the channel and the video it was on ----------
 * Calendar entries with a sponsor (saved, or suggested) come first; every other long-form upload is read from the link at the top of
 * its description. Pre-2026 videos aren't in the sheet, so those rows are read-only. */
function loadHistory(fresh=false){
 const h=state.history;
 if(h.loading)return h.loading;
 h.loading=(async()=>{
  try{const r=await api({action:'sponsorHistory',fresh:Boolean(fresh)});h.videos=r.videos||[];h.channel=r.channel||null;h.deals=r.deals||{};h.dealsError=r.dealsError||'';h.loaded=true;h.error='';}
  catch(e){h.error=e.message||String(e);}
  finally{h.loading=null;renderHistory();}
 })();
 renderHistory();
 return h.loading;
}
const brandByName=name=>{const n=squash(String(name).replace(/\s*\(.*$/,''));return n?(state.brandRecords||[]).find(b=>squash(String(b.name).replace(/\s*\(.*$/,''))===n)||null:null};
function historyRows(){
 const rows=[],seen=new Set();
 for(const e of state.events){
  const sp=sponsorOf(e);if(!sp)continue;
  const y=e.yt;if(y)seen.add(y.id);
  rows.push({key:y?y.id:'plan:'+e.date,name:sp.name,brand:sp.brand||brandByName(sp.name),saved:sp.saved,source:sp.saved?'calendar':sp.source,status:sp.saved?(sp.status||'No status'):'',
   date:shownOn(e),title:y?y.title:shortTitle(e,sp.name),views:y?y.views:null,url:y?y.url:(e.youtubeUrl||''),state:stateOf(e),editDate:e.date,extra:'',line:sp.line||(y&&y.sponsor&&y.sponsor.line)||'',domain:sp.domain||''});
 }
 for(const v of state.history.videos){
  if(seen.has(v.id)||!v.sponsor)continue;
  const d=linkSponsor(v.sponsor),inPlan=state.events.find(e=>e.yt&&e.yt.id===v.id);
  const editDate=inPlan?inPlan.date:'',extra=!inPlan&&v.date>=FIRST_YEAR+'-01-01'?v.id:'',videoDeal=!editDate&&!extra?(state.history.deals[v.id]||''):'';
  rows.push({key:v.id,id:v.id,name:d.name,brand:d.brand,saved:false,source:'description',status:'',date:v.date,title:v.title,views:v.views,url:v.url,state:'published',
   editDate,extra,line:d.line,domain:d.domain,videoDeal,hidden:videoDeal==='Not a sponsor'});
 }
 rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 return rows;
}
const groupKey=r=>r.brand?'brand:'+r.brand.id:r.name?'name:'+squash(r.name):'unknown';
/* Videos from before the 2026 plan: the status is kept in the sponsorship sheet's Studio meta tab, keyed by video id. */
const VIDEO_DEALS=['In progress','Invoiced','Paid','Not a sponsor'];
function videoDealSelect(r){
 const h=state.history,v=r.videoDeal,busy=Boolean(h.saving[r.id]);
 return '<select class="cal-deal cal-deal-select '+(v?statusClass(v):'sp-suggested')+'" data-video-deal="'+esc(r.id)+'" aria-label="'+esc('Deal status for '+r.title)+'"'+(busy||h.dealsError?' disabled':'')+' title="'+esc(h.dealsError||'Before the 2026 plan. Saved in the Sponsorship sheet.')+'">'+
  '<option value="">From description</option>'+VIDEO_DEALS.map(s=>'<option'+(s===v?' selected':'')+'>'+s+'</option>').join('')+'</select>';
}
async function saveVideoDeal(id,status){
 const h=state.history,before=h.deals[id]||'';
 if(status)h.deals[id]=status;else delete h.deals[id];
 h.saving[id]=true;renderHistory();
 try{const r=await api({action:'videoDeals',set:{[id]:status}});h.deals=r.deals||h.deals;notice(status==='Not a sponsor'?'Marked as not a sponsor. It\'s hidden from the sponsor history.':'Saved to the Sponsorship sheet.');}
 catch(e){if(before)h.deals[id]=before;else delete h.deals[id];notice(e.message||String(e),true);}
 finally{delete h.saving[id];renderHistory();}
}
function dealCell(r){
 if(r.id&&!r.editDate&&!r.extra)return videoDealSelect(r);
 if(r.saved)return '<span class="cal-deal '+statusClass(r.status==='No status'?'':r.status)+'">'+esc(r.status)+'</span>';
 if(r.editDate)return '<button type="button" class="cal-deal sp-suggested cal-deal-btn" data-edit-date="'+esc(r.editDate)+'">Confirm?</button>';
 if(r.extra)return '<button type="button" class="cal-deal sp-suggested cal-deal-btn" data-extra="'+esc(r.extra)+'">Add to plan</button>';
 return '';
}
const videoCell=r=>'<td class="cal-history-video"><strong>'+(r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.title)+' ↗</a>':esc(r.title))+'</strong>'+(r.line?'<small title="'+esc(r.line)+'">'+esc(r.line.replace(/https?:\/\/\S+|www\.\S+/g,'').replace(/\s+/g,' ').trim()||r.domain)+'</small>':'')+'</td>';
const statePill=r=>r.state==='published'?'':r.state==='overdue'?pillFor('overdue'):pillFor('scheduled');
function renderHistory(){
 const h=state.history,body=$('calendarHistoryBody'),meta=$('calendarHistoryMeta');if(!body)return;
 $('calendarHistory').hidden=!state.loaded&&!state.error;
 if(!state.loaded){body.innerHTML='';meta.textContent='';return}
 const q=h.q.trim().toLowerCase();
 const every=historyRows(),hiddenN=every.filter(r=>r.hidden).length,all=h.showHidden?every:every.filter(r=>!r.hidden),rows=q?all.filter(r=>[r.name,r.title,r.line,r.domain].some(x=>String(x||'').toLowerCase().includes(q))):all;
 const named=all.filter(r=>r.name&&!r.hidden),brandsN=new Set(named.map(groupKey)).size,confirmN=all.filter(r=>r.name&&!r.saved&&(r.editDate||r.extra)).length;
 const oldest=h.videos.length?h.videos[h.videos.length-1].date:'';
 meta.innerHTML=(h.loaded||named.length?brandsN+' brand'+(brandsN===1?'':'s')+' across '+named.length+' sponsored video'+(named.length===1?'':'s')+(confirmN?' · '+confirmN+' to confirm':''):'')+
  (hiddenN?' · <button type="button" class="cal-history-hidden" data-history-hidden>'+hiddenN+' marked not a sponsor, '+(h.showHidden?'hide':'show')+'</button>':'')+
  (h.loaded&&h.dealsError?'<span class="cal-history-note error">'+esc(h.dealsError)+'</span>':'')+
  (h.loading?'<span class="cal-history-note">Reading sponsor links from every video on the channel…</span>':h.error?'<span class="cal-history-note error">'+esc(h.error)+'</span>':h.loaded?'<span class="cal-history-note">Confirmed ones come from the calendar; the rest are read from the top line of each video\'s description'+(oldest?', back to '+esc(fmtDay(oldest))+' '+esc(oldest.slice(0,4)):'')+'. Press Refresh to re-read.</span>':'');
 document.querySelectorAll('[data-history-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.historyView===h.view)));
 if(!rows.length){body.innerHTML='<div class="calendar-empty cal-history-empty">'+(h.loading?'Loading…':q?'Nothing matches "'+esc(h.q)+'".':named.length?'':'No sponsors found yet. Add a sponsor to a calendar entry, or put the sponsor\'s link in the top line of a video description.')+'</div>';return}
 const dayLabel=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'–';
 if(h.view==='videos'){
  body.innerHTML='<div class="cal-agenda-wrap"><table class="cal-agenda cal-history-table"><thead><tr><th>Published</th><th class="cal-history-video">Video</th><th>Sponsor</th><th>Deal</th><th class="num">Views</th></tr></thead><tbody>'+
   rows.map(r=>'<tr><td class="cal-a-date">'+esc(dayLabel(r.date))+(statePill(r)?'<small>'+statePill(r)+'</small>':'')+'</td>'+videoCell(r)+'<td>'+(r.name?'<span class="cal-a-sponsor'+(r.saved?'':' suggested')+'">◆ '+esc(r.name)+'</span>'+(r.brand?'<small><a href="#sponsorships/brands/'+esc(r.brand.id)+'">Tracker ↗</a></small>':''):'<span class="muted">Link to '+esc(r.domain||'?')+'</span>')+'</td><td>'+dealCell(r)+'</td><td class="num">'+(r.views==null?'<span class="muted">–</span>':compact(r.views))+'</td></tr>').join('')+'</tbody></table></div>';
  return;
 }
 const groups=new Map();
 rows.forEach(r=>{const k=groupKey(r);if(!groups.has(k))groups.set(k,{key:k,name:r.brand?r.brand.name:r.name,brand:r.brand,rows:[]});groups.get(k).rows.push(r)});
 const list=[...groups.values()].sort((a,b)=>(a.key==='unknown')-(b.key==='unknown')||String(b.rows[0].date).localeCompare(String(a.rows[0].date)));
 body.innerHTML=list.map(g=>{
  const views=g.rows.reduce((n,r)=>n+(r.views||0),0),saved=g.rows.filter(r=>r.saved||(r.videoDeal&&!r.hidden)).length,unknown=g.key==='unknown';
  const head='<div class="cal-history-brand"><span class="cal-history-name">'+(unknown?'<span class="muted">Link not read</span>':'◆ '+esc(g.name))+'</span><span class="cal-history-stats">'+g.rows.length+' video'+(g.rows.length===1?'':'s')+(views?' · '+compact(views)+' views':'')+(saved?' · '+saved+' confirmed':'')+'</span>'+
   (g.brand?'<a class="cal-history-link" href="#sponsorships/brands/'+esc(g.brand.id)+'">Tracker: '+esc(g.brand.status||'no status')+' ↗</a>':unknown?'<span class="cal-history-link muted">A shortened link the brand couldn\'t be read from. Open the video to check.</span>':'<span class="cal-history-link muted">Not in the Sponsorship tracker</span>')+'</div>';
  return '<section class="cal-history-group">'+head+'<div class="cal-agenda-wrap"><table class="cal-agenda cal-history-table"><tbody>'+
   g.rows.map(r=>'<tr><td class="cal-a-date">'+esc(dayLabel(r.date))+(statePill(r)?'<small>'+statePill(r)+'</small>':'')+'</td>'+videoCell(r)+'<td>'+dealCell(r)+'</td><td class="num">'+(r.views==null?'<span class="muted">–</span>':compact(r.views))+'</td></tr>').join('')+'</tbody></table></div></section>';
 }).join('');
}
async function openSponsors(){
 await ensureLoaded();if(!state.loaded)return;
 if(!state.history.loaded)loadHistory(false);
 render();
 const el=$('calendarHistory');if(el){el.hidden=false;el.scrollIntoView({behavior:'smooth',block:'start'})}
}

/* ---------- editor ---------- */
/* Brands from the Sponsorship tracker: names for the drawer's picker, full rows (id, status, contact emails) for matching description links. */
const rankBrand=s=>/signed/i.test(s)?0:/their reply|josh|conversation/i.test(s)?1:2;
function setBrands(records){state.brandRecords=(records||[]).slice().sort((a,b)=>rankBrand(a.status)-rankBrand(b.status)||String(a.name).localeCompare(String(b.name)));state.brands=state.brandRecords.map(b=>b.name).filter(Boolean);return state.brands}
async function loadBrands(){
 if(state.brands)return state.brands;
 const fromTab=window.StudioSponsorships?.brands?.();if(fromTab&&fromTab.length)return setBrands(fromTab);
 try{const board=window.StudioBoard?.getState();const r=await fetch('/.netlify/functions/sponsorships',{method:'POST',headers:{'content-type':'application/json','x-board-key':board.code},body:JSON.stringify({action:'sponsorList'})});const d=await r.json();
  if(r.ok&&d.ok)setBrands(d.brands);}
 catch{}
 return state.brands||[];
}
function suggestSponsor(text,brands){
 const m=String(text||'').match(/\(([^)]+)\)\s*$/);if(!m)return'';const hint=m[1].trim().toLowerCase();if(hint.length<2)return'';
 return brands.find(b=>b.toLowerCase()===hint)||brands.find(b=>b.toLowerCase().includes(hint))||brands.find(b=>{const w=b.toLowerCase().split(/[\s—–-]+/)[0];return w.length>=4&&hint.includes(w)})||'';
}
/* ---------- sponsor from the link at the top of a YouTube description ---------- */
const squash=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const rootOf=host=>{const p=String(host||'').toLowerCase().split('.').filter(Boolean);if(p.length<2)return p[0]||'';return p.length>2&&/^(co|com|org|net|ac|gov|edu)$/.test(p[p.length-2])?p[p.length-3]:p[p.length-2]};
const emailDomains=contact=>(String(contact||'').match(/@([a-z0-9.-]+\.[a-z]{2,})/gi)||[]).map(m=>m.slice(1).toLowerCase().replace(/^www\./,''));
const hasWord=(text,word)=>{const t=' '+String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,' ')+' ',w=' '+String(word||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ';return w.trim().length>=3&&t.includes(w)};
/* Which tracker brand a description link belongs to: named in the line, the brand's email domain, the domain itself, or the server's guess. */
function brandForLink(sp){
 if(!sp)return null;
 const recs=state.brandRecords||[],hosts=[sp.finalDomain,sp.domain].filter(Boolean),roots=hosts.map(rootOf).filter(r=>r.length>=3);
 const firstWord=b=>String(b.name||'').toLowerCase().replace(/\s*\(.*$/,'').split(/[\s—–-]+/)[0]||'';
 return recs.find(b=>hasWord(sp.line,String(b.name).replace(/\s*\(.*$/,'')))
  ||recs.find(b=>emailDomains(b.contact).some(d=>hosts.some(h=>h===d||h.endsWith('.'+d)||d.endsWith('.'+h))))
  ||recs.find(b=>roots.some(r=>{const n=squash(String(b.name).replace(/\s*\(.*$/,'')),w=firstWord(b);return n&&(n===r||r.startsWith(n)&&n.length>=4||n.startsWith(r)&&r.length>=5||w.length>=4&&r.startsWith(w))}))
  ||(sp.guess?recs.find(b=>squash(String(b.name).replace(/\s*\(.*$/,''))===squash(sp.guess)||hasWord(b.name,sp.guess)):null)
  ||null;
}
/* Links Josh has already confirmed: once an entry with a given description link has a saved sponsor, every other video with the same
 * link (or, for a plain brand link, the same domain) is suggested that sponsor. This is how app links like onelink.to/... get their name. */
let learned=null;
const normUrl=u=>String(u||'').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/[/#?]+$/,'');
function learnedLinks(){
 if(learned)return learned;
 learned=new Map();
 for(const e of state.events){
  const s=e.yt&&e.yt.sponsor;if(!e.sponsor||!s)continue;
  const u=normUrl(s.url);if(u&&!learned.has('u:'+u))learned.set('u:'+u,e.sponsor);
  const host=s.finalDomain||s.domain;if(host&&!s.shortened&&!learned.has('d:'+host))learned.set('d:'+host,e.sponsor);
 }
 return learned;
}
/* { name, brand, line, url, domain } for a video's description link, or null when there is none. name may be '' (a shortened link that couldn't be read). */
function linkSponsor(sp){
 if(!sp)return null;
 let brand=brandForLink(sp),name=brand?String(brand.name).replace(/\s*\(verify[^)]*\)\s*$/i,''):'';
 if(!name){const L=learnedLinks();name=L.get('u:'+normUrl(sp.url))||L.get('d:'+(sp.finalDomain||sp.domain))||'';if(name)brand=brandByName(name);}
 if(!name)name=sp.guess||'';
 return{name,brand:brand||null,line:sp.line||'',url:sp.url||'',domain:sp.finalDomain||sp.domain||''};
}
/* The link at the top of the description, shown under the stats so the sponsor suggestion is easy to check. */
function descLine(y){
 const sp=y&&y.sponsor;if(!sp||!sp.url)return'';
 const shown=String(sp.line||'').replace(/https?:\/\/\S+|www\.\S+/g,'').replace(/\s+/g,' ').trim();
 return '<p class="cal-yt-desc"><b>Description, line '+(sp.lineNo||1)+':</b> '+(shown?esc(shown)+' ':'')+'<a href="'+esc(sp.url)+'" target="_blank" rel="noopener noreferrer">'+esc((sp.finalDomain||sp.domain||'link')+(sp.finalDomain&&sp.finalDomain!==sp.domain?' (via '+sp.domain+')':''))+' ↗</a></p>';
}
function renderYt(e,{unplanned=false}={}){
 const box=$('calendarYt'),y=e&&e.yt;
 if(!y){box.hidden=!e;box.innerHTML=e?'<p class="cal-yt-empty">'+(state.youtube.configured?(stateOf(e)==='overdue'?'No video found on the channel within 3 days of this date. If it went out, paste its link below.':'Not live yet. This turns green automatically once the video is published on the channel.'):'Connect YouTube to see live stats here.')+'</p>':'';return}
 const age=Math.max(0,Math.round((Date.now()-new Date(y.publishedAt).getTime())/86400000));
 box.hidden=false;
 box.innerHTML='<a class="cal-yt-card" href="'+esc(y.url)+'" target="_blank" rel="noopener noreferrer">'+(y.thumb?'<img src="'+esc(y.thumb)+'" alt="" loading="lazy">':'')+'<span><strong>'+esc(y.title)+'</strong><small>Published '+esc(fmtDay(y.date))+' · '+age+' day'+(age===1?'':'s')+' live · '+esc(dur(y.seconds))+'</small></span></a>'+
  '<div class="cal-yt-stats"><span><b>'+compact(y.views)+'</b>views</span><span><b>'+compact(y.likes)+'</b>likes</span><span><b>'+compact(y.comments)+'</b>comments</span><span><b>'+compact(age?y.views/age:y.views)+'</b>views / day</span></div>'+
  descLine(y)+
  (unplanned?'<p class="cal-yt-match">On YouTube but not in the plan. Save below to add it.</p>':'<p class="cal-yt-match">'+(y.matchedBy==='link'?'Linked by the YouTube link below.':y.matchedBy==='date'?'Matched automatically: published on this date.':y.matchedBy==='title'?'Matched by topic: planned for '+esc(fmtDay(e.date))+', went out '+esc(fmtDay(y.date))+'. Wrong video? Paste the right link below.':'Matched automatically: published within 3 days of this date. Wrong video? Paste the right link below.')+'</p>'+
  (y.date!==e.date&&y.date>=FIRST_YEAR+'-01-01'?'<button type="button" class="quiet-btn cal-move-live" data-move-from="'+esc(e.date)+'" data-move-to="'+esc(y.date)+'">Move this entry to '+esc(fmtDay(y.date))+' in the sheet</button>':''));
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
 renderYt(existing||(extra?{yt:extra,date:extra.date}:null),{unplanned:Boolean(extra&&!existing)});renderLinkOptions(existing,extra);
 $('calendarDelete').hidden=!existing;$('calendarOverlay').hidden=false;document.body.style.overflow='hidden';$('calendarText').focus();
 window.Studio.setItem('calendar',existing?[existing.date]:null);
 if(existing&&isUntitled(existing))$('calendarText').select();
 const brands=await loadBrands();
 $('calendarSponsorOptions').innerHTML=brands.map(b=>'<option value="'+esc(b)+'"></option>').join('');
 if(state.editing!==existing||(!existing&&extra&&$('calendarYoutube').value!==extra.url))return; // the drawer moved on while brands loaded
 if(existing&&!existing.sponsor){
  const sp=sponsorOf(existing),link=linkSponsor(existing.yt&&existing.yt.sponsor);
  if(sp){$('calendarSponsor').value=sp.name;$('calendarSponsorStatus').value=$('calendarSponsorStatus').value||'In progress';
   $('calendarSponsorHint').textContent=sp.source==='description'?'Suggested from the top of the YouTube description: "'+(lineText(sp.line)||sp.domain)+'". Clear it if that\'s wrong, and set the deal status.':'Suggested from the title. Clear it if that\'s wrong.';}
  else if(link&&link.url)$('calendarSponsorHint').textContent='The description starts with a link to '+link.domain+' but the brand couldn\'t be read from it. Type the sponsor if this video has one.';
 }else if(!existing&&extra){
  const link=linkSponsor(extra.sponsor);
  if(link&&link.name){$('calendarSponsor').value=link.name;$('calendarSponsorStatus').value='In progress';$('calendarSponsorHint').textContent='Suggested from the top of the YouTube description: "'+(lineText(link.line)||link.domain)+'". Clear it if that\'s wrong, and set the deal status.';}
 }
}
function closeEditor(){if($('calendarOverlay').hidden)return;$('calendarOverlay').hidden=true;document.body.style.overflow='';state.editing=null;window.Studio.setItem('calendar',null)}
function show(tab){
 if(tab==='calendar')window.Studio.ready.then(()=>state.loaded?(state.history.loaded?null:loadHistory(false)):refresh());
}
/* Open a slot by its planned date (links and Today). The grid jumps to that quarter behind the drawer. */
async function openDate(date){
 if(!/^\d{4}-\d\d-\d\d$/.test(String(date||'')))return;
 await ensureLoaded();if(!state.loaded)return;
 const a=absOf(date);if(a>=0&&a<=MAX_START+2){state.start=Math.min(MAX_START,a-a%3);render();}
 if(!state.events.some(e=>e.date===date)){window.StudioBoard?.toast('Nothing is planned on '+fmtDay(date)+' any more. It may have been moved.');return;}
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
const EMPTY_METRICS={views:'',ctr:'',avd:'',sponsor:'',sponsorStatus:'',youtubeUrl:''};
async function placeSlot(slot,date){
 if(slot===date)return;
 if(state.events.some(x=>x.date===date)){notice('That day already has a plan. Drop the slot on an empty day, or edit the video that\'s there.',true);return}
 await save({action:'save',from:null,previousText:'',date,text:'Publish video',metrics:{...EMPTY_METRICS}});
 if(state.events.some(x=>x.date===date))notice('Release slot moved to '+fmtDay(date)+'. It\'s in the sheet now as an untitled video. Click it to add the title.');
}
/* Open the "Schedule a video" drawer for an open slot (from a link or the Overview). */
async function openSlot(date){
 await ensureLoaded();if(!state.loaded)return;
 const a=absOf(date);if(a>=0)state.start=Math.min(MAX_START,a-a%3);render();
 if(state.events.some(e=>e.date===date)){await showEditor(date);return}
 await showEditor(date);$('calendarEditorTitle').textContent='Plan this release slot.';
}
async function onMove(from,date){
 const item=state.events.find(x=>x.date===from);if(!item||from===date)return;
 if(state.events.some(x=>x.date===date)){notice('That day already has a plan. Move to an empty date or edit an existing entry.',true);return}
 const data=await api({action:'save',from,previousText:item.text,date,text:item.text,metrics:metricsOf(item)});
 apply(data);notice('Moved to '+date+' in Google Sheets.');
}
function boot(){
 $('calendarSponsorStatus').innerHTML='<option value="">No sponsor status</option>'+SPONSOR_STATUSES.map(s=>'<option>'+s+'</option>').join('');
 window.Studio.on('tab',({tab})=>show(tab));
 window.Studio.on('connection',()=>{state.loaded=false;state.events=[];state.extras=[];state.brands=null;state.brandRecords=null;learned=null;Object.assign(state.history,{videos:[],channel:null,loaded:false,error:'',deals:{},dealsError:''});if(window.Studio.current()==='calendar')refresh();});
 $('calendarHistory').addEventListener('click',e=>{const v=e.target.closest('[data-history-view]');if(v){state.history.view=v.dataset.historyView;renderHistory();}
  if(e.target.closest('[data-history-hidden]')){state.history.showHidden=!state.history.showHidden;renderHistory();}});
 $('calendarHistoryBody').addEventListener('change',e=>{const sel=e.target.closest('[data-video-deal]');if(sel)saveVideoDeal(sel.dataset.videoDeal,sel.value);});
 $('calendarHistorySearch').addEventListener('input',e=>{state.history.q=e.target.value;renderHistory();});
 $('calendarRefresh').addEventListener('click',()=>refresh(true));
 $('calendarPrevious').addEventListener('click',()=>{state.start=Math.max(0,state.start-3);render()});
 $('calendarNext').addEventListener('click',()=>{state.start=Math.min(MAX_START,state.start+3);render()});
 $('calendarThisQuarter').addEventListener('click',()=>{state.start=currentQuarterStart();render()});
 $('calendarNew').addEventListener('click',()=>showEditor());
 const onPick=e=>{const edit=e.target.closest('[data-edit-date]'),add=e.target.closest('[data-add-date]'),ext=e.target.closest('[data-extra]');
  const spon=e.target.closest('[data-sponsor-date]');
  if(spon){showEditor(spon.dataset.sponsorDate).then(()=>{$('calendarSponsorStatus').scrollIntoView({block:'center'});$('calendarSponsorStatus').focus()});return}
  const slot=e.target.closest('[data-slot-date]');
  if(slot){showEditor(slot.dataset.slotDate).then(()=>{$('calendarEditorTitle').textContent='Plan this release slot.'});return}
  if(edit)showEditor(edit.dataset.editDate);else if(ext){const v=state.extras.find(x=>x.id===ext.dataset.extra);if(v)showEditor(null,v);}else if(add)showEditor(add.dataset.addDate)};
 $('calendarGrid').addEventListener('click',onPick);$('calendarAgenda').addEventListener('click',onPick);$('calendarHistoryBody').addEventListener('click',onPick);
 $('calendarAgenda').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('tr'))onPick(e)});
 $('calendarGrid').addEventListener('dragstart',e=>{const el=e.target.closest('[data-edit-date],[data-slot-date]');if(el){e.dataTransfer.setData('text/plain',el.dataset.editDate||'slot:'+el.dataset.slotDate);e.dataTransfer.effectAllowed='move';}});
 $('calendarGrid').addEventListener('dragover',e=>{if(e.target.closest('[data-calendar-date]'))e.preventDefault()});
 $('calendarGrid').addEventListener('drop',async e=>{const day=e.target.closest('[data-calendar-date]');if(!day)return;e.preventDefault();const from=e.dataTransfer.getData('text/plain');if(!from)return;try{if(from.startsWith('slot:'))await placeSlot(from.slice(5),day.dataset.calendarDate);else await onMove(from,day.dataset.calendarDate)}catch(err){notice(err.message,true)}});
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
 window.Studio.register('calendar',{open:item=>item[0]==='sponsors'?openSponsors():openDate(item[0]),close:closeEditor}); // #calendar/sponsors · #calendar/2026-11-13
}
window.StudioCalendar={ensureLoaded,refresh,openSlots,openSlot,openSponsors,loaded:()=>state.loaded,error:()=>state.error,events:()=>state.events,stateOf,shownOn,sponsorOf,linkSponsor,shortTitle,isUntitled,youtube:()=>state.youtube,open:openDate};
boot();
})();
