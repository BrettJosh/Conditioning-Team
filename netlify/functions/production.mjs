/**
 * Production bridge for the existing Notion "Video Projects" database.
 * Set NOTION_VIDEO_DATABASE_ID, NOTION_TOKEN and BOARD_ACCESS_CODE in Netlify.
 * Uses same shared access code as the weekly task board; no public token exposure.
 */
import { timingSafeEqual } from 'node:crypto';

const BASE='https://api.notion.com/v1', VERSION='2025-09-03';
const clean=x=>String(x||'').replaceAll('-','').trim();
const validId=x=>/^[a-f0-9]{32}$/i.test(clean(x));
const send=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>send({error:message},status);
const plain=x=>(x||[]).map(v=>v.plain_text??v.text?.content??'').join('');
const rt=x=>String(x||'')?[{type:'text',text:{content:String(x).slice(0,1950)}}]:[];
const error=(message,status=400)=>Object.assign(new Error(message),{status});
function equals(actual,expected){
  if(!actual||!expected)return false;
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function notion(path,method='GET',body){
  const res=await fetch(BASE+path,{method,headers:{authorization:'Bearer '+process.env.NOTION_TOKEN,'Notion-Version':VERSION,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await res.json();}catch{throw error('Notion returned unreadable data.',502);}
  if(!res.ok)throw error('Notion: '+(data.message||'Request failed.'),res.status===429?429:res.status===403?403:res.status===404?404:400);
  return data;
}
async function source(){
  const db=process.env.NOTION_VIDEO_DATABASE_ID;
  if(!validId(db))throw error('Add NOTION_VIDEO_DATABASE_ID in Netlify using your existing Video Projects database ID.',503);
  const database=await notion('/databases/'+clean(db));
  const id=database.data_sources?.[0]?.id;
  if(!validId(id))throw error('Could not access the Video Projects data source. Share the Video Projects database with your Notion integration.',503);
  return notion('/data_sources/'+clean(id));
}
const stageChoices=['Research/Planning','Scripting','Filming','Editing','Published'];
const ownerChoices=['Josh','Tristan','Daisy','Rachit','Thumbnail designer','Unassigned'];
const thumbChoices=['Not started','Concepts','Revising','Approved'];
function mapProject(page) {
  const p=page.properties||{},str=(key)=>plain(p[key]?.rich_text);
  return {
    id:page.id, url:page.url, title:plain(p['Video Title']?.title)||'Untitled documentary',
    stage:p.Status?.select?.name||'Research/Planning',
    currentlyWith:p['Currently With']?.select?.name||'',
    nextDeliverable:str('Next Deliverable'),
    nextDue:p['Next Due']?.date?.start?.slice(0,10)||'',
    blocker:str('Blocker'),
    thumbnailStatus:p['Thumbnail Status']?.select?.name||'',
    lastConfirmed:p['Last Confirmed']?.date?.start?.slice(0,10)||'',
    publishDate:p['Publish Date']?.date?.start?.slice(0,10)||'',
    researchDoc:p['Research Doc']?.url||'',scriptDoc:p['Script Doc']?.url||'',
    lastEdited:page.last_edited_time||''
  };
}
function verifySchema(s){
  const required={'Video Title':'title','Status':'select','Currently With':'select','Next Deliverable':'rich_text','Next Due':'date','Blocker':'rich_text','Thumbnail Status':'select','Last Confirmed':'date'};
  const missing=Object.entries(required).filter(([k,t])=>s.properties?.[k]?.type!==t).map(([k])=>k);
  if(missing.length)throw error('Missing Notion Video Projects properties: '+missing.join(', ')+'. Check the database schema.',503);
}
async function listProjects(s){
  const tasks=[];let cursor,more=true;
  for(let i=0;i<5&&more;i++){
    const body={page_size:100,filter:{property:'Status',select:{does_not_equal:'Published'}},sorts:[{timestamp:'last_edited_time',direction:'descending'}],...(cursor?{start_cursor:cursor}:{})};
    const data=await notion('/data_sources/'+clean(s.id)+'/query','POST',body);
    tasks.push(...(data.results||[]).map(mapProject).filter(p=>p.stage!=='Published'));
    more=Boolean(data.has_more);cursor=data.next_cursor;
  }
  return {projects:tasks,limited:more};
}
async function verifyProject(id,s){
  if(!validId(id))throw error('Invalid project ID.');
  const page=await notion('/pages/'+clean(id));
  const parent=page.parent||{};
  const matching=clean(parent.data_source_id)===clean(s.id)||
    (s.parent?.database_id&&clean(parent.database_id)===clean(s.parent.database_id));
  if(!matching)throw error('This project is not in the configured Video Projects database.',403);
  return page;
}
function select(name,options){
  if(!name)return {select:null};
  if(!options.includes(name))throw error('Invalid option: '+name);
  return {select:{name}};
}
function str(value,label){
  if(typeof value!=='string'||value.length>1950)throw error(label+' must be at most 1950 characters.');
  return {rich_text:rt(value)};
}
function date(value){
  if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))))throw error('Invalid due date.');
  return {date:value?{start:value}:null};
}
export default async function handler(request){
  if(request.method!=='POST')return fail('POST only.',405);
  if(!process.env.NOTION_TOKEN||!process.env.NOTION_VIDEO_DATABASE_ID||!process.env.BOARD_ACCESS_CODE)return fail('Production integration not configured yet. See setup instructions.',503);
  if(!equals(request.headers.get('x-board-key'),process.env.BOARD_ACCESS_CODE))return fail('Invalid workspace access code.',401);
  if(Number(request.headers.get('content-length'))>12000)return fail('Request too large.',413);
  let input;try{input=await request.json();}catch{return fail('Invalid JSON.');}
  try{
    const s=await source();verifySchema(s);
    if(input.action==='list')return send(await listProjects(s));
    if(input.action==='update'){
      await verifyProject(input.id,s);
      const patch=input.patch||{};
      const allowed=['stage','currentlyWith','nextDeliverable','nextDue','blocker','thumbnailStatus'];
      if(Object.keys(patch).some(k=>!allowed.includes(k)))throw error('Unsupported project field.');
      const props={
        'Status':select(patch.stage,stageChoices),
        'Currently With':select(patch.currentlyWith,ownerChoices),
        'Next Deliverable':str(patch.nextDeliverable,'Next deliverable'),
        'Next Due':date(patch.nextDue),
        'Blocker':str(patch.blocker,'Blocker'),
        'Thumbnail Status':select(patch.thumbnailStatus,thumbChoices),
        'Last Confirmed':{date:{start:new Date().toISOString().slice(0,10)}}
      };
      const page=await notion('/pages/'+clean(input.id),'PATCH',{properties:props});
      return send({project:mapProject(page)});
    }
    return fail('Unknown action.');
  }catch(err){
    console.error('Studio production bridge:',err.message);
    return fail(err.message||'Production request failed.',Number.isInteger(err.status)?err.status:502);
  }
}
