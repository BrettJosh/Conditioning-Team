(() => {
'use strict';
const $=id=>document.getElementById(id);
const B=()=>window.StudioBoard;
const key='studio-weekly-focus-cache-v1';
const stage={owner:'Daisy',archive:false,week:currentWeek(),showAll:false,expanded:{},loading:false,loadSeq:0};
function currentWeek(){return monday(new Date());}
function monday(d){const x=new Date(d);x.setHours(12,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');}
function shiftWeek(days){const parts=stage.week.split('-').map(Number);const d=new Date(parts[0],parts[1]-1,parts[2],12);d.setDate(d.getDate()+days);return monday(d);}
function labelWeek(){const p=stage.week.split('-').map(Number);const a=new Date(p[0],p[1]-1,p[2],12),b=new Date(a);b.setDate(b.getDate()+6);const fmt=d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});return fmt(a)+' – '+fmt(b);}
function until(){const parts=stage.week.split('-').map(Number),d=new Date(parts[0],parts[1]-1,parts[2],12);d.setDate(d.getDate()+7);return monday(d);}
function isArchive(){return stage.archive;}
function currentOwner(){return stage.owner;}
function selectedWeek(){return stage.week;}
function filterTasks(tasks){
return tasks.filter(t=>{
 const isArchived=['onhold','background'].includes(t.status);
 if(stage.archive!==isArchived)return false;
 const owner=String(t.owner||'').toLowerCase().trim();
 if(owner && owner!==stage.owner.toLowerCase())return false;
 if(!owner && stage.owner==='Josh')return false;
 if(stage.archive||stage.showAll)return true;
 if(!t.due)return true;
 // Keep unfinished earlier-week tasks visible in the Overdue lane.
 if(t.due<stage.week)return ['todo','doing','waiting'].includes(t.status);
 return t.due<until();
});}
function cacheKey(){return stage.owner+'|'+stage.week;}
function readCache(){try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {};}}
function fromCache(){const saved=readCache()[cacheKey()];return saved||{goals:['','',''],notes:''};}
function applyPlan(plan){for(let i=0;i<3;i++)$('weeklyGoal'+(i+1)).value=plan.goals?.[i]||'';$('weeklyNotes').value=plan.notes||'';}
function inputs(){return{goals:[1,2,3].map(i=>$('weeklyGoal'+i).value.trim()),notes:$('weeklyNotes').value.trim()};}
function saveCache(plan){const c=readCache();c[cacheKey()]=plan;try{localStorage.setItem(key,JSON.stringify(c));}catch{}}
function updateView(){
 $('planningTitle').textContent=stage.archive?'Archives':stage.owner+'’s three main outcomes';
 $('weeklyHeading').innerHTML=stage.archive?'ON HOLD <span class="scribble">& BACKGROUND</span>':'MISSION <span class="scribble">THIS WEEK</span>';
 $('weeklyPlanning').hidden=stage.archive;
 $('weekLabel').textContent=labelWeek();
 $('showAllActive').checked=stage.showAll;
 $('boardScopeHint').textContent=stage.archive?'Archived tasks':stage.showAll?'Showing all active tasks':'This week, unscheduled tasks and carried-forward overdue tasks';
 $('archiveHelp').hidden=!stage.archive;
 B()?.renderBoard();
}
async function loadPlan(){
 const seq=++stage.loadSeq,board=B();if(!board)return;
 applyPlan(fromCache());$('planSaveStatus').textContent=board.getState().mode==='notion'?'Loading shared plan…':'Local demo • not shared';
 if(board.getState().mode!=='notion'||stage.archive)return;
 try{const data=await board.api('planLoad',{owner:stage.owner,week:stage.week});if(seq!==stage.loadSeq)return;applyPlan(data.plan);saveCache(data.plan);$('planSaveStatus').textContent='Saved in Notion';}
 catch(e){if(seq===stage.loadSeq)$('planSaveStatus').textContent='Could not sync plan: '+e.message;}
}
async function savePlan(e){
 e.preventDefault();const plan=inputs(),board=B();if(!board)return;
 $('weeklySaveBtn').disabled=true;$('planSaveStatus').textContent='Saving…';
 try{
  if(board.getState().mode==='notion')await board.api('planSave',{owner:stage.owner,week:stage.week,plan});
  saveCache(plan);$('planSaveStatus').textContent=board.getState().mode==='notion'?'Saved to Notion ✓':'Saved on this browser only';board.toast('Weekly focus saved.');
 }catch(err){$('planSaveStatus').textContent='Not saved: '+err.message;}
 finally{$('weeklySaveBtn').disabled=false;}
}
function handleTab(tab){
 if(tab==='production')return;
 stage.archive=tab==='archive';stage.owner=tab==='josh'?'Josh':'Daisy';stage.expanded={};
 updateView();if(!stage.archive)loadPlan();
}
function toggleExpanded(status){stage.expanded[status]=!stage.expanded[status];B().renderBoard();}
function onSynced(){loadPlan();updateView();}
function boot(){
 document.querySelectorAll('[data-view-tab]').forEach(button=>button.addEventListener('click',()=>handleTab(button.dataset.viewTab)));
 $('weekPrev').addEventListener('click',()=>{stage.week=shiftWeek(-7);updateView();loadPlan();});
 $('weekNext').addEventListener('click',()=>{stage.week=shiftWeek(7);updateView();loadPlan();});
 $('weekCurrent').addEventListener('click',()=>{stage.week=currentWeek();updateView();loadPlan();});
 $('showAllActive').addEventListener('change',e=>{stage.showAll=e.target.checked;stage.expanded={};updateView();});
 $('weeklyPlanForm').addEventListener('submit',savePlan);
 updateView();loadPlan();
}
window.StudioWeekly={filterTasks,isArchive,selectedWeek,isExpanded:status=>!!stage.expanded[status],toggleExpanded,currentOwner,onSynced};
boot();
})();