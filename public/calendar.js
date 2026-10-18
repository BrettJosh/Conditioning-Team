(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={events:[],start:9,loaded:false,busy:false,from:null,previousText:''};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=(m,d)=>'2026-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
const notice=(text,error=false)=>{const el=$('calendarNotice');el.hidden=!text;el.textContent=text;el.classList.toggle('error',error)};
async function api(payload){
 const board=window.StudioBoard?.getState();if(!board||board.mode!=='notion')throw Error('Connect your Notion workspace first to use the shared calendar.');
 const resp=await fetch('/.netlify/functions/calendar',{method:'POST',headers:{'content-type':'application/json','x-board-key':board.code},body:JSON.stringify(payload)});
 const text=await resp.text();let data;try{data=JSON.parse(text)}catch{throw Error('Calendar server returned an unexpected response.')}
 if(!resp.ok||!data.ok)throw Error(data.error||'Calendar request failed.');return data;
}
async function refresh(){
 if(state.busy)return;state.busy=true;$('calendarRefresh').disabled=true;notice('Loading the content plan from Google Sheets…');
 try{const r=await api({action:'list'});state.events=r.events||[];state.loaded=true;notice('');render();}
 catch(e){notice(e.message,true);if(!state.loaded){$('calendarGrid').innerHTML='<div class="calendar-empty">Connect Google Sheets to see your real publishing plan. Follow the calendar setup instructions in GitHub.</div>';}}
 finally{state.busy=false;$('calendarRefresh').disabled=false}
}
function render(){
 const start=state.start,end=Math.min(12,start+3),dates=state.events.filter(e=>{const m=Number(e.date.slice(5,7))-1;return m>=start&&m<end;});
 const months=Array.from({length:end-start},(_,i)=>new Date(2026,start+i,1).toLocaleDateString('en-GB',{month:'long'}));
 $('calendarRange').textContent=months.join(' · ')+' 2026';
 $('calendarPrevious').disabled=start===0;$('calendarNext').disabled=start>=9;
 $('calendarSummary').textContent=dates.length+' scheduled '+(dates.length===1?'entry':'entries')+' in this period';
 $('calendarGrid').innerHTML=months.map((name,k)=>{
  const month=start+k,days=new Date(2026,month+1,0).getDate(),offset=(new Date(2026,month,1).getDay()+6)%7;
  const heads=['M','T','W','T','F','S','S'].map(x=>'<span>'+x+'</span>').join('');
  const blank=Array.from({length:offset},()=>'<span class="calendar-empty-day"></span>').join('');
  const cells=Array.from({length:days},(_,i)=>{
    const day=i+1,date=iso(month,day),items=state.events.filter(x=>x.date===date),today=date===new Date().toLocaleDateString('en-CA');
    return '<div class="calendar-day'+(today?' calendar-today':'')+'" data-calendar-date="'+date+'"><span class="calendar-day-number">'+day+'</span>'+
      items.map(item=>'<button class="calendar-event" type="button" draggable="true" data-edit-date="'+date+'" title="Drag to reschedule or click to edit">'+esc(item.text)+'</button>').join('')+
      (!items.length?'<button class="calendar-empty-add" type="button" data-add-date="'+date+'" aria-label="Schedule a video on '+date+'">＋</button>':'')+'</div>';
   }).join('');
  return '<section class="calendar-month"><h3>'+name+' <small>2026</small></h3><div class="calendar-weekdays">'+heads+'</div><div class="calendar-days">'+blank+cells+'</div></section>';
 }).join('');
}
function showEditor(date=null){
 const existing=state.events.find(e=>e.date===date);state.from=existing?.date||null;state.previousText=existing?.text||'';
 $('calendarEditorTitle').textContent=existing?'Edit publishing slot.':'Schedule a video.';
 $('calendarText').value=existing?.text||'';$('calendarDate').value=date||iso(state.start,1);
 $('calendarViews').value=existing?.views??'';$('calendarCtr').value=existing?.ctr??'';$('calendarAvd').value=existing?.avd??'';
 $('calendarDelete').hidden=!existing;$('calendarOverlay').hidden=false;document.body.style.overflow='hidden';$('calendarText').focus();
}
function closeEditor(){$('calendarOverlay').hidden=true;document.body.style.overflow='';}
function show(tab){
 const isCalendar=tab==='calendar';
 $('calendarWorkspace').hidden=!isCalendar;
 if(isCalendar){$('weeklyWorkspace').hidden=true;$('productionWorkspace').hidden=true;if(!state.loaded)refresh();}
}
async function apply(payload){
 if(state.busy)return;state.busy=true;$('calendarSave').disabled=true;$('calendarDelete').disabled=true;
 try{const data=await api(payload);state.events=data.events||[];state.loaded=true;closeEditor();notice('Saved to Google Sheets.');render();}
 catch(e){notice(e.message,true);}
 finally{state.busy=false;$('calendarSave').disabled=false;$('calendarDelete').disabled=false;}
}
async function onMove(from,date){
 const item=state.events.find(x=>x.date===from);if(!item||from===date)return;
 if(state.events.some(x=>x.date===date)){notice('That day already has a plan. Move to an empty date or edit an existing entry.',true);return}
 const data=await api({action:'save',from,previousText:item.text,date,text:item.text,metrics:{views:item.views||'',ctr:item.ctr||'',avd:item.avd||''}});
 state.events=data.events||[];notice('Moved to '+date+' in Google Sheets.');render();
}
function boot(){
 document.querySelectorAll('[data-view-tab]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.viewTab)));
 $('calendarRefresh').addEventListener('click',refresh);
 $('calendarPrevious').addEventListener('click',()=>{state.start=Math.max(0,state.start-3);render()});
 $('calendarNext').addEventListener('click',()=>{state.start=Math.min(9,state.start+3);render()});
 $('calendarNew').addEventListener('click',()=>showEditor());
 $('calendarGrid').addEventListener('click',e=>{const edit=e.target.closest('[data-edit-date]'),add=e.target.closest('[data-add-date]');if(edit)showEditor(edit.dataset.editDate);else if(add)showEditor(add.dataset.addDate)});
 $('calendarGrid').addEventListener('dragstart',e=>{const el=e.target.closest('[data-edit-date]');if(el){e.dataTransfer.setData('text/plain',el.dataset.editDate);e.dataTransfer.effectAllowed='move';}});
 $('calendarGrid').addEventListener('dragover',e=>{if(e.target.closest('[data-calendar-date]'))e.preventDefault()});
 $('calendarGrid').addEventListener('drop',async e=>{const day=e.target.closest('[data-calendar-date]');if(!day)return;e.preventDefault();const from=e.dataTransfer.getData('text/plain');if(!from)return;try{await onMove(from,day.dataset.calendarDate)}catch(err){notice(err.message,true)}});
 $('calendarForm').addEventListener('submit',e=>{e.preventDefault();apply({action:'save',from:state.from,previousText:state.previousText,date:$('calendarDate').value,text:$('calendarText').value.trim(),metrics:{views:$('calendarViews').value,ctr:$('calendarCtr').value,avd:$('calendarAvd').value}})});
 $('calendarDelete').addEventListener('click',()=>{if(state.from&&confirm('Remove this publishing slot from the source spreadsheet?'))apply({action:'remove',from:state.from,previousText:state.previousText})});
 $('calendarOverlay').addEventListener('click',e=>{if(e.target.closest('[data-calendar-close]'))closeEditor()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('calendarOverlay').hidden)closeEditor()});
 const previous=sessionStorage.getItem('studio-active-tab');show(previous==='calendar'?'calendar':'weekly');if(previous==='calendar'){$('weeklyWorkspace').hidden=true;$('productionWorkspace').hidden=true;}
}
boot();
})();