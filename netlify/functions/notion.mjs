/**
 * Josh Brett Studio Notion bridge. Runs ONLY server-side on Netlify.
 * Set NOTION_TOKEN, NOTION_DATABASE_ID, BOARD_ACCESS_CODE in Netlify environment settings.
 * Notion-Version 2025-09-03 uses the data sources API, not legacy database query.
 */
import { timingSafeEqual } from 'node:crypto';

const NOTION_VERSION = '2025-09-03';
const BASE = 'https://api.notion.com/v1';
const cleanId = s => String(s || '').replaceAll('-', '').trim();
const idIsValid = s => /^[a-f0-9]{32}$/i.test(cleanId(s));
const response = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail = (message,status=400) => response({error:message},status);
const safeText = text => String(text || '').slice(0,1950);
const rt = value => value ? [{type:'text',text:{content:safeText(value)}}] : [];
const plain = items => (items || []).map(x=>x.plain_text ?? x.text?.content ?? '').join('');
const matchName = (value,options) => (options || []).find(x=>x.name.toLowerCase()===value.toLowerCase())?.name;

function keyValid(actual,expected) {
  if (!actual || !expected) return false;
  const a=Buffer.from(actual);const b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
async function notion(path, method='GET',body){
  const result=await fetch(BASE+path,{method,headers:{'authorization':`Bearer ${process.env.NOTION_TOKEN}`,'Notion-Version':NOTION_VERSION,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await result.json();}catch{throw Object.assign(new Error('Notion returned an unreadable response.'),{status:502});}
  if(!result.ok){const explanation=data.message||'Unknown Notion error.';throw Object.assign(new Error(`Notion: ${explanation}`),{status:result.status===429?429:400});}
  return data;
}
async function getSource(){
  let id=process.env.NOTION_DATA_SOURCE_ID;
  if(!id){
    const db=process.env.NOTION_DATABASE_ID;
    if(!idIsValid(db))throw Object.assign(new Error('Set NOTION_DATABASE_ID to your Notion task database ID in Netlify environment variables.'),{status:503});
    const data=await notion(`/databases/${cleanId(db)}`);
    id=data.data_sources?.[0]?.id;
  }
  if(!idIsValid(id))throw Object.assign(new Error('No Notion data source found. Check your database ID and share the database with the integration.'),{status:503});
  const source=await notion(`/data_sources/${cleanId(id)}`);
  return source;
}
function findProperty(source,type,names,allowFallback=false){
  const all=Object.entries(source.properties||{});
  const normal=x=>x.toLowerCase().replace(/[ _-]/g,'');
  for(const name of names){const found=all.find(([key,p])=>p.type===type&&normal(key)===normal(name));if(found)return found;}
  return allowFallback ? (all.find(([,p])=>p.type===type) || null) : null;
}
function fieldMap(source){
  const title=findProperty(source,'title',['Name','Task','Title'],true);
  const status=findProperty(source,'status',['Status','Stage'],true)||findProperty(source,'select',['Status','Stage']);
  const project=findProperty(source,'select',['Project','Area','Category'])||findProperty(source,'multi_select',['Project','Area','Category']);
  const priority=findProperty(source,'select',['Priority']);
  const due=findProperty(source,'date',['Due','Due date','Deadline']);
  const desc=findProperty(source,'rich_text',['Description','Notes','Details']);
  const owner=findProperty(source,'select',['Owner','Assignee','Assigned to'])||findProperty(source,'people',['Owner','Assignee','Assigned to']);
  if(!title||!status)throw Object.assign(new Error('Your Notion database needs a title property (e.g. Name) and a Status property of type Status or Select.'),{status:400});
  return {title,status,project,priority,due,desc,owner};
}
function columnFromNotion(label){
  const text=String(label||'').toLowerCase().trim();
  if(/on hold|paused|parked/.test(text))return 'onhold';
  if(/background|someday|non urgent|non-urgent/.test(text))return 'background';
  if(/done|complete|shipped|finished|published/.test(text))return 'done';
  if(/wait|block|hold|review|approval|decision/.test(text))return 'waiting';
  if(/progress|doing|active|working|started|develop/.test(text))return 'doing';
  return 'todo';
}
function statusNameFor(value,field){
  const options=(field?.[1]?.[field[1].type]?.options || []);
  const synonyms={todo:['To do','Not started','Not Started','Backlog','Todo','Planned','Open'],doing:['In progress','In Progress','Doing','Started','Active','Working on it'],waiting:['Waiting','Blocked','On hold','Waiting on Josh','For review','Review'],done:['Done','Complete','Completed','Finished','Shipped'],onhold:['On hold','Parked','Paused'],background:['Background','Someday','Non urgent']};
  for(const candidate of synonyms[value]||[]){const found=matchName(candidate,options);if(found)return found;}
  throw Object.assign(new Error(`Your Notion Status property needs an option for "${value}". Available options: ${options.map(o=>o.name).join(', ')}. Add a suitable status option in Notion.`),{status:400});
}
function notionTask(page,m){
  const p=page.properties||{};
  const val=f=>f?p[f[0]]:null;
  const status=val(m.status);
  const project=val(m.project);
  const priority=val(m.priority);
  const due=val(m.due);
  const desc=val(m.desc);
  const owner=val(m.owner);
  return {id:page.id,title:plain(val(m.title)?.title)||'Untitled task',status:columnFromNotion(status?.status?.name||status?.select?.name),project:project?.select?.name||project?.multi_select?.map(x=>x.name).join(', ')||'General',priority:/(urgent|critical)/i.test(priority?.select?.name||'')?'critical':/(high)/i.test(priority?.select?.name||'')?'high':'normal',due:due?.date?.start?.slice(0,10)||'',description:plain(desc?.rich_text)||'',owner:owner?.select?.name||owner?.people?.[0]?.name||'',updatedAt:page.last_edited_time||'',url:page.url,comments:[]};
}
function writable(f,value,required=false){
  if(!f)return null;
  const [name,schema]=f;
  switch(schema.type){
    case 'title':return [name,{title:rt(value)}];
    case 'rich_text':return [name,{rich_text:rt(value)}];
    case 'date':return [name,{date:value?{start:value}:null}];
    case 'select':{
      if(!value)return [name,{select:null}];
      const found=matchName(String(value),(schema.select?.options||[]));
      if(!found){if(required)throw Object.assign(new Error(`"${value}" is not an available option for Notion ${name}.`),{status:400});return null;}
      return [name,{select:{name:found}}];
    }
    case 'multi_select':{
      const found=matchName(String(value||''),(schema.multi_select?.options||[]));
      return found?[name,{multi_select:[{name:found}]}]:null;
    }
  }
  return null;
}
function buildProperties(changes,m){
  const out={};const add=pair=>{if(pair)out[pair[0]]=pair[1];};
  if(Object.hasOwn(changes,'title')){if(!String(changes.title||'').trim())throw Object.assign(new Error('Task name required.'),{status:400});add(writable(m.title,safeText(changes.title)));}
  if(Object.hasOwn(changes,'status')){const name=statusNameFor(changes.status,m.status);const [key,schema]=m.status;out[key]=schema.type==='status'?{status:{name}}:{select:{name}};}
  if(Object.hasOwn(changes,'project'))add(writable(m.project,String(changes.project||'').slice(0,80)));
  if(Object.hasOwn(changes,'priority')){const key=changes.priority==='critical'?'Urgent':changes.priority==='high'?'High':'Normal';add(writable(m.priority,key));}
  if(Object.hasOwn(changes,'owner')&&m.owner?.[1]?.type==='select')add(writable(m.owner,String(changes.owner||'')));
  if(Object.hasOwn(changes,'due')){if(changes.due&&!/^\d{4}-\d{2}-\d{2}$/.test(changes.due))throw Object.assign(new Error('Invalid due date.'),{status:400});add(writable(m.due,changes.due));}
  if(Object.hasOwn(changes,'description'))add(writable(m.desc,safeText(changes.description)));
  return out;
}
async function verifyPage(id,source){
  if(!idIsValid(id))throw Object.assign(new Error('Invalid task ID.'),{status:400});
  const page=await notion(`/pages/${cleanId(id)}`);
  const parent=page.parent||{};
  const belongs=cleanId(parent.data_source_id)===cleanId(source.id) || (source.parent?.database_id && cleanId(parent.database_id)===cleanId(source.parent.database_id));
  if(!belongs)throw Object.assign(new Error('Task is outside the configured Notion database.'),{status:403});
  return page;
}
async function listTasks(source,m){
  const all=[];let cursor;let more=true;
  for(let page=0;page<5&&more;page++){
    const body={page_size:100,...(cursor?{start_cursor:cursor}:{})};
    const data=await notion(`/data_sources/${cleanId(source.id)}/query`,'POST',body);
    all.push(...(data.results||[]).filter(x=>!plain(x.properties?.[m.title[0]]?.title).startsWith('[STUDIO WEEKLY PLAN]')).map(x=>notionTask(x,m)));
    more=Boolean(data.has_more);cursor=data.next_cursor;
  }
  return {tasks:all,limited:more};
}
export default async function handler(request){
  if(request.method!=='POST')return fail('POST only.',405);
  if(!process.env.NOTION_TOKEN||!(process.env.NOTION_DATABASE_ID||process.env.NOTION_DATA_SOURCE_ID)||!process.env.BOARD_ACCESS_CODE)return fail('Notion is not configured yet. See README: set NOTION_TOKEN, NOTION_DATABASE_ID and BOARD_ACCESS_CODE on Netlify.',503);
  if(!keyValid(request.headers.get('x-board-key'),process.env.BOARD_ACCESS_CODE))return fail('Invalid workspace access code.',401);
  if(Number(request.headers.get('content-length'))>12000)return fail('Request too large.',413);
  let input;try{input=await request.json();}catch{return fail('Invalid JSON.');}
  try{
    const source=await getSource();const m=fieldMap(source);
    switch(input.action){
      case 'list':return response(await listTasks(source,m));
      case 'planLoad':{
const who=input.owner==='Josh'?'Josh':'Daisy', week=String(input.week||'');
if(!/^\d{4}-\d{2}-\d{2}$/.test(week))return fail('Invalid week.');
if(!m.desc)return fail('Add a rich-text Description or Notes property to the Notion database.',400);
const name='[STUDIO WEEKLY PLAN] '+who+' '+week;
const data=await notion('/data_sources/'+cleanId(source.id)+'/query','POST',{filter:{property:m.title[0],title:{equals:name}},page_size:10});
let plan={goals:['','',''],notes:''};
if(data.results?.[0]){const raw=plain(data.results[0].properties?.[m.desc[0]]?.rich_text);try{const p=JSON.parse(raw);if(Array.isArray(p.goals))plan={goals:p.goals.slice(0,3).map(x=>String(x||'')),notes:String(p.notes||'')};}catch{}}
return response({plan});
}
case 'planSave':{
const who=input.owner==='Josh'?'Josh':'Daisy',week=String(input.week||'');
if(!/^\d{4}-\d{2}-\d{2}$/.test(week))return fail('Invalid week.');
if(!m.desc)return fail('Add a rich-text Description or Notes property to the Notion database.',400);
const raw=input.plan||{}, goals=Array.isArray(raw.goals)?raw.goals.slice(0,3).map(x=>String(x||'').slice(0,140)):['','',''],notes=String(raw.notes||'').slice(0,1000);
const name='[STUDIO WEEKLY PLAN] '+who+' '+week;
const data=await notion('/data_sources/'+cleanId(source.id)+'/query','POST',{filter:{property:m.title[0],title:{equals:name}},page_size:10});
const props=buildProperties({title:name,description:JSON.stringify({goals,notes})},m);
if(data.results?.[0])await notion('/pages/'+cleanId(data.results[0].id),'PATCH',{properties:props});
else{const status=statusNameFor('todo',m.status),[key,schema]=m.status;props[key]=schema.type==='status'?{status:{name:status}}:{select:{name:status}};await notion('/pages','POST',{parent:{type:'data_source_id',data_source_id:source.id},properties:props});}
return response({ok:true});
}
case 'create':{
        const task=input.task||{};
        if(!String(task.title||'').trim())return fail('Task name required.');
        const props=buildProperties(task,m);
        const page=await notion('/pages','POST',{parent:{type:'data_source_id',data_source_id:source.id},properties:props});
        return response({task:notionTask(page,m)});
      }
      case 'update':{
        await verifyPage(input.id,source);
        const patch=input.patch||{};
        const allowed=['title','status','project','priority','due','description','owner'];
        const changes=Object.fromEntries(Object.entries(patch).filter(([key])=>allowed.includes(key)));
        const props=buildProperties(changes,m);
        if(!Object.keys(props).length)return response({ok:true});
        const page=await notion(`/pages/${cleanId(input.id)}`,'PATCH',{properties:props});
        return response({task:notionTask(page,m)});
      }
      case 'comments':{
        await verifyPage(input.id,source);
        let cursor,more=true,all=[];
        for(let i=0;i<3&&more;i++){
          const q=new URLSearchParams({block_id:cleanId(input.id),page_size:'100',...(cursor?{start_cursor:cursor}:{})});
          const data=await notion(`/comments?${q}`);
          all.push(...(data.results||[]).map(x=>({id:x.id,name:x.display_name?.resolved_name||x.created_by?.name||'Notion',text:plain(x.rich_text),date:x.created_time})));
          more=Boolean(data.has_more);cursor=data.next_cursor;
        }
        return response({comments:all});
      }
      case 'addComment':{
        await verifyPage(input.id,source);
        const text=String(input.text||'').trim();if(!text||text.length>1000)return fail('Comment must be 1–1000 characters.');
        const comment=await notion('/comments','POST',{parent:{page_id:cleanId(input.id)},rich_text:rt(text)});
        return response({comment:comment.id});
      }
      default:return fail('Unknown action.',400);
    }
  }catch(error){
    console.error('Studio Notion bridge error:',error?.message);
    return fail(error?.message||'An unexpected error occurred.',Number.isInteger(error?.status)?error.status:502);
  }
}
