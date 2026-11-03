import {timingSafeEqual} from 'node:crypto';
import {youtubeConfigured, channelVideos, enrich} from '../lib/youtube.mjs';
const fail=(error,status=400)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const same=(a,b)=>{if(!a||!b)return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)};
const METRIC_KEYS=['views','ctr','avd','sponsor','sponsorStatus','youtubeUrl'];
const SPONSOR_STATUSES=['','In progress','Invoiced','Paid'];
const UNEXPECTED='Google Sheets returned a page instead of data. Usually the script needs re-approving (Apps Script → Studio bridge → run studioSelfTest → Allow) or a new version wasn\'t deployed. Then press Refresh.';
export default async function handler(request){
 if(request.method!=='POST')return fail('POST required.',405);
 if(!same(request.headers.get('x-board-key'),process.env.BOARD_ACCESS_CODE))return fail('Invalid workspace access code.',401);
 const url=process.env.STUDIO_CALENDAR_SCRIPT_URL,secret=process.env.STUDIO_CALENDAR_SCRIPT_SECRET;
 if(!url||!secret)return fail('Calendar connection is not configured yet. Follow the calendar README to connect Google Sheets.',503);
 if(!/^https:\/\/script\.google\.com\/macros\/s\//.test(url))return fail('Invalid Apps Script URL.',503);
 let data;try{data=await request.json();}catch{return fail('Invalid request JSON.');}
 const action=String(data.action||'');
 if(!['list','save','remove'].includes(action))return fail('Unsupported calendar action.');
 const validDate=d=>typeof d==='string'&&/^20(2[6-9]|30)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d; // 2026–2030
 if(['save','remove'].includes(action)&&data.from&&!validDate(data.from))return fail('Invalid source date.');
 if(action==='save'&&(!validDate(data.date)||!String(data.text||'').trim()||String(data.text).length>1500))return fail('A valid date and title are required.');
 const payload={action,from:data.from||null,previousText:String(data.previousText??''),date:data.date,text:data.text};
 if(action==='save'){
  const m=data.metrics||{},metrics={};
  for(const k of METRIC_KEYS)if(k in m)metrics[k]=String(m[k]??'').slice(0,k==='youtubeUrl'?300:120);
  if('sponsorStatus' in metrics&&!SPONSOR_STATUSES.includes(metrics.sponsorStatus))return fail('Sponsor status must be In progress, Invoiced or Paid.');
  payload.metrics=metrics;
 }
 // Start YouTube in parallel with the sheet round-trip; it never blocks or breaks the calendar.
 const ytOn=youtubeConfigured();
 const ytPromise=ytOn?channelVideos({fresh:Boolean(data.fresh)}).then(v=>({ok:v}),e=>({err:e})):null;
 let parsed;
 try{
  const upstream=await fetch(url,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,secret}),redirect:'follow',signal:AbortSignal.timeout(19000)});
  const raw=await upstream.text();try{parsed=JSON.parse(raw)}catch{return fail(UNEXPECTED,502)}
  if(!upstream.ok||!parsed.ok)return fail(parsed.error||'Google Sheets update failed.',upstream.status>=400&&upstream.status<500?400:502);
 }catch(e){return fail('Unable to reach the Google Sheets calendar. '+String(e.message||''),502);}
 parsed.youtube={configured:ytOn};
 if(ytOn&&Array.isArray(parsed.events)){
  try{const got=await ytPromise;if(got.err)throw got.err;const{channel,extras}=await enrich(parsed.events,{prefetched:got.ok});parsed.youtube={configured:true,channel,extras};}
  catch(e){parsed.youtube={configured:true,error:String(e.message||e)};}
 }
 return Response.json(parsed,{headers:{'Cache-Control':'no-store'}});
}
