(() => {
  'use strict';
  const STORAGE_KEY = 'josh-brett-studio-board-demo-v2';
  const SESSION_CODE_KEY = 'josh-brett-studio-access-code';
  const columns = [
    {id:'todo',label:'To do',icon:'◫'},
    {id:'doing',label:'In progress',icon:'↗'},
    {id:'waiting',label:'Waiting',icon:'◷'},
    {id:'done',label:'Done',icon:'✓'}
  ];
  const demoTasks = [
    {id:'demo-01',title:'Create moodboard for the next documentary',status:'todo',project:'Documentaries',priority:'high',due:'2026-10-21',description:'Find 8–10 grounded visual references and three original on-camera ideas.',comments:[]},
    {id:'demo-02',title:'Design a sample customer roadmap',status:'doing',project:'Skinny Fat Escape',priority:'high',due:'2026-10-23',description:'Make the first two weeks of a transformation feel clear and personal.',comments:[]},
    {id:'demo-03',title:'Test the transcript research workflow',status:'todo',project:'AI systems',priority:'normal',due:'2026-10-27',description:'Compare key points and timestamp accuracy against manual research.',comments:[]},
    {id:'demo-04',title:'Confirm sponsorship decision deadline',status:'waiting',project:'Sponsors',priority:'critical',due:'2026-10-19',description:'Agree the last feasible date for incorporating a sponsor.',comments:[]},
    {id:'demo-05',title:'Write the visual-script enhancement brief',status:'todo',project:'Documentaries',priority:'normal',due:'2026-10-26',description:'Propose practical sequences that elevate the documentary.',comments:[]},
    {id:'demo-06',title:'Agree the design direction',status:'done',project:'Skinny Fat Escape',priority:'normal',due:'2026-10-16',description:'A clear, lean customer-facing visual direction.',comments:[{id:'example-1',name:'Demo example',text:'The direction is approved. This is a local sample comment.',date:'2026-10-16T10:00:00Z'}]}
  ];
  const archivedColumns=[{id:'onhold',label:'On hold',icon:'◷'},{id:'background',label:'Background',icon:'◌'}];
  const byId = id => document.getElementById(id);
  const sessionGet = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const sessionSet = (key,value) => { try { sessionStorage.setItem(key,value); } catch {} };
  const sessionRemove = key => { try { sessionStorage.removeItem(key); } catch {} };
  const state = {mode:'demo',code:'',tasks:[],filter:'All',search:'',selected:null,saving:false,loading:false};
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function loadDemo() { try { const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); return Array.isArray(stored) ? stored : structuredClone(demoTasks); } catch { return structuredClone(demoTasks); } }
  function saveDemo() { try {localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));} catch {toast('Browser storage unavailable. Changes may not persist.');} }
  function toast(message) {const el=byId('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3400);}
  function notice(message,error=false) {const el=byId('notice');el.textContent=message;el.classList.toggle('error',error);el.hidden=!message;}
  function updateConnection() {document.body.classList.toggle('local-demo-mode',state.mode!=='notion');byId('connectionText').textContent=state.mode==='notion'?'Notion connected':'Local demo';byId('connectionDot').className='connection-dot'+(state.mode==='notion'?' connected':'');byId('connectionStatus').textContent=state.mode==='notion'?'Connected to Notion. Task and comment changes sync with your existing database.':'Local demo only: changes are saved to this browser, not shared with Daisy.';}
  function projectClass(project) {const p=(project||'').toLowerCase();return p.includes('skinny')||p.includes('product')?'product':p.includes('doc')||p.includes('video')?'doc':p.includes('ai')||p.includes('system')?'ai':p.includes('sponsor')?'sponsor':'';}
  function filteredTasks() {const tasks=state.tasks.filter(task=>(state.filter==='All'||(task.project||'General')===state.filter)&&(!state.search||`${task.title} ${task.project} ${task.description}`.toLowerCase().includes(state.search)));return window.StudioWeekly?window.StudioWeekly.filterTasks(tasks):tasks;}
  function formatDate(value) {if(!value)return '';const date=new Date(value+'T12:00:00');return Number.isNaN(date.getTime())?value:date.toLocaleDateString('en-GB',{day:'numeric',month:'short'});}
  function dueOverdue(v) {if(!v)return false;const today=new Date();const iso=new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);return v<iso;}
  // Overdue is a date-based lane, not a new Notion status. It therefore works
  // with the existing Notion database and persists across selected weeks.
  function selectedWeek(){return window.StudioWeekly?.selectedWeek()||new Date().toISOString().slice(0,10);}
  function overdueTask(task){return ['todo','doing','waiting'].includes(task.status)&&Boolean(task.due)&&task.due<selectedWeek();}
  function priorSunday(){
    const [y,m,d]=selectedWeek().split('-').map(Number),date=new Date(y,m-1,d,12);
    date.setDate(date.getDate()-1);
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  function renderTabs() {
    const projects=['All',...new Set(state.tasks.map(t=>t.project||'General'))].sort((a,b)=>a==='All'?-1:b==='All'?1:a.localeCompare(b));
    if(!projects.includes(state.filter))state.filter='All';
    byId('projectTabs').innerHTML=projects.map(p=>`<button type="button" class="tab" aria-pressed="${p===state.filter}" data-filter="${escapeHtml(p)}">${escapeHtml(p)} <span class="tab-count">${p==='All'?state.tasks.length:state.tasks.filter(t=>(t.project||'General')===p).length}</span></button>`).join('');
  }
  function renderCard(t) {
    const due=t.due?`<span class="task-date ${dueOverdue(t.due)&&t.status!=='done'?'overdue':''}">◷ ${escapeHtml(formatDate(t.due))}</span>`:'';
    const count=(t.comments||[]).length;
    return `<button type="button" class="task-card" data-id="${escapeHtml(t.id)}" draggable="true" aria-label="Edit task: ${escapeHtml(t.title)}"><div class="card-top"><span class="project-pill ${projectClass(t.project)}">${escapeHtml(t.project||'General')}</span><span class="priority-dot ${escapeHtml(t.priority||'normal')}" title="${escapeHtml(t.priority||'Normal')} priority"></span></div><div class="task-title">${escapeHtml(t.title)}</div><div class="task-bottom"><div class="task-meta">${due}<span>${count?'☏ '+count:'↗ Details'}</span></div><span class="task-arrow">↗</span></div></button>`;
  }
  function renderBoard() {
    renderTabs();
    const t=filteredTasks();
    byId('totalCount').textContent=t.length;
    byId('doingCount').textContent=t.filter(x=>x.status==='doing').length;
    byId('waitingCount').textContent=t.filter(x=>x.status==='waiting').length;
    byId('doneCount').textContent=t.filter(x=>x.status==='done').length;
    const inArchive=Boolean(window.StudioWeekly?.isArchive());const visibleCols=inArchive?archivedColumns:columns;
    const carried=inArchive?[]:t.filter(overdueTask).sort((a,b)=>String(a.due).localeCompare(String(b.due)));
    const regular=inArchive?t:t.filter(task=>!overdueTask(task));
    byId('board').classList.toggle('archive-board',inArchive);
    byId('board').innerHTML=visibleCols.map(c=>{
      const items=regular.filter(x=>x.status===c.id);
      const sorted=items.slice().sort((a,b)=>c.id==='done'?String(b.updatedAt||b.due||'').localeCompare(String(a.updatedAt||a.due||'')):String(a.due||'9999').localeCompare(String(b.due||'9999')));
      const expanded=window.StudioWeekly?.isExpanded(c.id);const max=20;const shown=expanded?sorted:sorted.slice(0,max);const left=sorted.length-shown.length;
      const controls=sorted.length>max?`<button class="show-column-more" type="button" data-expand="${c.id}">${expanded?'Show fewer':`Browse ${left} more ${c.id==='done'?'completed ':''}tasks`}</button>`:'';
      return `<section class="kanban-column" aria-label="${c.label} tasks"><div class="column-heading ${c.id}"><div class="column-label"><span class="mini-icon">${c.icon}</span>${c.label}</div><span class="column-count">${items.length}</span></div><div class="column-body" data-status="${c.id}">${shown.map(renderCard).join('')}${!items.length?'<p class="empty-hint">Nothing here (yet).</p>':''}${controls}<button type="button" class="add-column-task" data-new-status="${c.id}">＋ Add task</button></div></section>`;
    }).join('')+(inArchive?'':(()=>{
      const expanded=window.StudioWeekly?.isExpanded('overdue');
      const shown=expanded?carried:carried.slice(0,12);
      const left=carried.length-shown.length;
      return `<section class="overdue-lane" aria-label="Overdue tasks carried into this week">
        <div class="overdue-heading"><div><strong>↶ Overdue / Carry forward</strong><p>Unfinished tasks from earlier weeks stay here until you reschedule or complete them. Drag a task here to carry it forward.</p></div><span class="overdue-count">${carried.length}</span></div>
        <div class="overdue-dropzone" data-status="overdue" aria-label="Drop task to carry into future weeks">
          ${shown.map(renderCard).join('')}${!carried.length?'<p class="overdue-empty">Drop a task here, or leave its earlier due date unchanged to carry it into next week.</p>':''}
          ${carried.length>12?`<button type="button" class="show-column-more overdue-expand" data-expand="overdue">${expanded?'Show fewer':`Show ${left} more overdue tasks`}</button>`:''}
        </div>
      </section>`;
    })());
  }
  function resizeTaskNotes(){
    if(byId('taskOverlay').hidden)return;
    const el=byId('taskDescription');
    el.style.height='auto';
    const maxHeight=Math.max(260,Math.floor(window.innerHeight*.58));
    el.style.height=Math.min(Math.max(el.scrollHeight+4,260),maxHeight)+'px';
  }
  function toggleTaskNotes(){
    const drawer=byId('taskOverlay').querySelector('.task-drawer');
    const expanded=drawer.classList.toggle('notes-expanded');
    const button=byId('expandTaskNotes');
    button.setAttribute('aria-expanded',String(expanded));
    button.textContent=expanded?'↙ Standard view':'↗ Expand notes';
    resizeTaskNotes();
    byId('taskDescription').focus();
  }
  function openTask(id=null,status='todo') {
    state.selected=id;
    const task=id?state.tasks.find(t=>t.id===id):null;
    if(id&&!task){toast('Task not found. Try refreshing.');return;}
    byId('taskId').value=id||'';byId('taskTitle').value=task?.title||'';byId('taskStatus').value=task?.status||status;byId('taskProject').value=task?.project||'';byId('taskPriority').value=task?.priority||'normal';byId('taskOwner').value=task?.owner||window.StudioWeekly?.currentOwner()||'Daisy';byId('taskDue').value=task?.due||(!task?window.StudioWeekly?.selectedWeek()||'':'');byId('taskDescription').value=task?.description||'';
    byId('drawerTitle').textContent=task?'Edit task.':'New task.';
    byId('notionPageLink').hidden=!(task?.url&&state.mode==='notion');
    if(task?.url)byId('notionPageLink').href=task.url;
    byId('commentsSection').hidden=!task;
    const carry=byId('taskOverdueBtn');
    carry.hidden=!task||['done','onhold','background'].includes(task.status);
    if(task)carry.textContent=overdueTask(task)?'↗ Bring into this week':'↶ Move to overdue';
    const drawer=byId('taskOverlay').querySelector('.task-drawer');
    drawer.classList.remove('notes-expanded');
    byId('expandTaskNotes').setAttribute('aria-expanded','false');
    byId('expandTaskNotes').textContent='↗ Expand notes';
    byId('taskOverlay').hidden=false; document.body.style.overflow='hidden';
    resizeTaskNotes();
    if(task)loadComments(task);setTimeout(()=>byId('taskTitle').focus(),30);
  }
  function closeTask() {byId('taskOverlay').hidden=true;state.selected=null;document.body.style.overflow='';}
  function renderComments(comments) {
    byId('commentCount').textContent=comments.length;
    byId('commentsList').innerHTML=comments.length?comments.map(c=>`<div class="comment"><div class="comment-by"><strong>${escapeHtml(c.name||'Notion')}</strong><span>${escapeHtml(c.date?new Date(c.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'')}</span></div><p>${escapeHtml(c.text)}</p></div>`).join(''):'<p class="comment-empty">No comments yet. Leave the first note.</p>';
  }
  async function loadComments(task) {
    renderComments(task.comments||[]);
    if(state.mode!=='notion')return;
    byId('commentsList').innerHTML='<p class="comment-empty">Loading comments…</p>';
    try {const data=await api('comments',{id:task.id});if(state.selected===task.id){task.comments=data.comments;renderComments(data.comments);}}
    catch(err){if(state.selected===task.id){byId('commentsList').textContent=`Could not load comments: ${err.message}`;}}
  }
  async function api(action,payload={}) {
    const response=await fetch('/.netlify/functions/notion',{method:'POST',headers:{'content-type':'application/json','x-board-key':state.code},body:JSON.stringify({action,...payload}),cache:'no-store'});
    let data;try{data=await response.json();}catch{throw new Error('Netlify function unavailable. Deploy the complete GitHub project (not just the static files).');}
    if(!response.ok)throw new Error(data.error||`Notion request failed (${response.status}).`);
    return data;
  }
  async function refreshNotion() {
    if(state.mode!=='notion')return;
    byId('refreshBtn').disabled=true;
    try{const result=await api('list');state.tasks=result.tasks;renderBoard();window.StudioWeekly?.onSynced();notice(result.limited?'Notion currently returned a limited number of tasks.': '');}
    catch(err){notice(`Notion sync failed: ${err.message}`,true);toast('Could not refresh.');}
    finally{byId('refreshBtn').disabled=false;}
  }
  async function connectNotion(code) {
    if(!code.trim()){toast('Enter the workspace access code.');return;}
    state.code=code.trim();
    byId('connectForm').querySelector('button').disabled=true;
    try{
      const result=await api('list');state.mode='notion';state.tasks=result.tasks;state.filter='All';sessionSet(SESSION_CODE_KEY,state.code);renderBoard();updateConnection();closeConnection();notice('');window.StudioWeekly?.onSynced();toast('Notion connected. Your board is now shared.');
    }catch(err){state.mode='demo';state.code='';sessionRemove(SESSION_CODE_KEY);updateConnection();byId('connectionStatus').textContent=err.message;toast('Connection failed. Check the setup and access code.');}
    finally{byId('connectForm').querySelector('button').disabled=false;}
  }
  function closeConnection(){byId('connectionOverlay').hidden=true;document.body.style.overflow='';}
  function openConnection(){updateConnection();byId('connectionOverlay').hidden=false;document.body.style.overflow='hidden';}
  function switchDemo(){state.mode='demo';state.code='';sessionRemove(SESSION_CODE_KEY);state.tasks=loadDemo();state.filter='All';renderBoard();updateConnection();closeConnection();toast('Local demo mode. Changes only save in this browser.');}
  async function saveTask(ev){
    ev.preventDefault();if(state.saving)return;
    const id=byId('taskId').value;
    const patch={title:byId('taskTitle').value.trim(),status:byId('taskStatus').value,project:byId('taskProject').value.trim()||'General',priority:byId('taskPriority').value,owner:byId('taskOwner').value,due:byId('taskDue').value,description:byId('taskDescription').value.trim()};
    if(!patch.title){toast('Give the task a name.');return;}
    state.saving=true;byId('saveTaskBtn').disabled=true;
    try{
      if(state.mode==='notion'){
        await api(id?'update':'create',id?{id,patch}:{task:patch});await refreshNotion();toast(id?'Task updated in Notion.':'Task created in Notion.');
      }else{
        if(id){const task=state.tasks.find(t=>t.id===id);Object.assign(task,patch);}else{state.tasks.unshift({id:`demo-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,...patch,comments:[]});}
        saveDemo();renderBoard();toast(id?'Task saved locally.':'Task created locally.');
      }
      closeTask();
    }catch(err){toast(`Could not save: ${err.message}`);}
    finally{state.saving=false;byId('saveTaskBtn').disabled=false;}
  }
  async function changeStatus(id,status){
    const task=state.tasks.find(x=>x.id===id);if(!task)return false;
    const old={status:task.status,due:task.due};
    let patch;
    if(status==='overdue'){
      if(!['todo','doing','waiting'].includes(task.status)||overdueTask(task))return false;
      patch={due:priorSunday()};
    }else{
      patch={status};
      if(overdueTask(task)&&!['done','onhold','background'].includes(status))patch.due=selectedWeek();
      if(task.status===status&&!Object.hasOwn(patch,'due'))return false;
    }
    Object.assign(task,patch);renderBoard();
    try{
      if(state.mode==='notion')await api('update',{id,patch});
      else saveDemo();
      toast(status==='overdue'?'Task carried forward.':status==='done'?'Task completed.':'Task updated.');
      return true;
    }catch(err){
      Object.assign(task,old);renderBoard();toast('Task not changed: '+err.message);
      return false;
    }
  }
  async function toggleTaskOverdue(){
    const task=state.tasks.find(t=>t.id===state.selected);if(!task)return;
    const btn=byId('taskOverdueBtn');btn.disabled=true;
    try{
      const wasCarried=overdueTask(task);
      const changed=await changeStatus(task.id,wasCarried?task.status:'overdue');
      if(changed)closeTask();
    }finally{btn.disabled=false;}
  }
  async function postComment(ev){
    ev.preventDefault();const text=byId('commentText').value.trim();const task=state.tasks.find(t=>t.id===state.selected);if(!text||!task)return;
    const btn=byId('commentForm').querySelector('button');btn.disabled=true;
    try{
      if(state.mode==='notion'){
        await api('addComment',{id:task.id,text});await loadComments(task);toast('Comment added in Notion.');
      }else{
        task.comments=task.comments||[];task.comments.push({id:`c-${Date.now()}`,name:'Studio',text,date:new Date().toISOString()});saveDemo();renderComments(task.comments);renderBoard();toast('Comment saved locally.');
      }
      byId('commentText').value='';
    }catch(err){toast(`Comment failed: ${err.message}`);}finally{btn.disabled=false;}
  }
  function attachEvents(){
    byId('projectTabs').addEventListener('click',e=>{const btn=e.target.closest('[data-filter]');if(!btn)return;state.filter=btn.dataset.filter;renderBoard();});
    byId('searchInput').addEventListener('input',e=>{state.search=e.target.value.trim().toLowerCase();renderBoard();});
    byId('board').addEventListener('click',e=>{const card=e.target.closest('[data-id]');if(card){openTask(card.dataset.id);return;}const expand=e.target.closest('[data-expand]');if(expand){window.StudioWeekly?.toggleExpanded(expand.dataset.expand);return;}const add=e.target.closest('[data-new-status]');if(add)openTask(null,add.dataset.newStatus);});
    byId('board').addEventListener('dragstart',e=>{const card=e.target.closest('[data-id]');if(!card)return;e.dataTransfer.setData('text/plain',card.dataset.id);e.dataTransfer.effectAllowed='move';card.classList.add('dragging');});
    byId('board').addEventListener('dragend',e=>{document.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging'));});
    byId('board').addEventListener('dragover',e=>{const col=e.target.closest('[data-status]');if(col){e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.drag-over').forEach(el=>{if(el!==col)el.classList.remove('drag-over');});col.classList.add('drag-over');}});
    byId('board').addEventListener('drop',e=>{const col=e.target.closest('[data-status]');if(!col)return;e.preventDefault();col.classList.remove('drag-over');const id=e.dataTransfer.getData('text/plain');changeStatus(id,col.dataset.status);});
    byId('newTaskBtn').addEventListener('click',()=>openTask());byId('closeTaskBtn').addEventListener('click',closeTask);
    byId('taskOverlay').addEventListener('click',e=>{if(e.target.hasAttribute('data-close-task'))closeTask();});byId('taskForm').addEventListener('submit',saveTask);byId('expandTaskNotes').addEventListener('click',toggleTaskNotes);byId('taskDescription').addEventListener('input',resizeTaskNotes);byId('taskOverdueBtn').addEventListener('click',toggleTaskOverdue);byId('commentForm').addEventListener('submit',postComment);
    byId('refreshBtn').addEventListener('click',()=>{if(state.mode==='notion')refreshNotion();else toast('Demo data is stored locally. Connect Notion to sync.');});
    byId('connectionBtn').addEventListener('click',openConnection);byId('closeConnectionBtn').addEventListener('click',closeConnection);
    byId('connectionOverlay').addEventListener('click',e=>{if(e.target.hasAttribute('data-close-connection'))closeConnection();});
    byId('connectForm').addEventListener('submit',e=>{e.preventDefault();connectNotion(byId('accessPassword').value);});
    byId('demoModeBtn').addEventListener('click',switchDemo);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!byId('taskOverlay').hidden)closeTask();else if(!byId('connectionOverlay').hidden)closeConnection();}});
  }
  window.StudioBoard={getState:()=>state,renderBoard,toast,api,changeStatus,openTask,saveDemo,refreshNotion,updateConnection};
  async function boot(){state.tasks=loadDemo();attachEvents();renderBoard();updateConnection();
    const saved=sessionGet(SESSION_CODE_KEY);
    if(saved){state.code=saved;try{const result=await api('list');state.mode='notion';state.tasks=result.tasks;renderBoard();updateConnection();window.StudioWeekly?.onSynced();}
      catch{state.code='';sessionRemove(SESSION_CODE_KEY);updateConnection();notice('Notion session expired. Reconnect using the button at the top.',true);}}
  }
  boot();
})();
