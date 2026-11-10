import {timingSafeEqual} from 'node:crypto';
import {youtubeConfigured, channelVideos, allUploads, enrich} from '../lib/youtube.mjs';
const fail=(error,status=400)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const same=(a,b)=>{if(!a||!b)return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)};
const METRIC_KEYS=['views','ctr','avd','sponsor','sponsorStatus','youtubeUrl'];
const SPONSOR_STATUSES=['','In progress','Invoiced','Paid'];
const UNEXPECTED='Google Sheets returned a page instead of data. Usually the script needs re-approving (Apps Script → Studio bridge → run studioSelfTest → Allow) or a new version wasn\'t deployed. Then press Refresh.';
const VIDEO_DEAL_STATUSES=['','In progress','Invoiced','Paid','Not a sponsor'];
const NEEDS_BRIDGE='Saving a status on videos from before 2026 needs the updated Studio bridge script (version 4): paste the new Code.gs into Studio bridge, run studioSelfTest, then Deploy, Manage deployments, ✎, New version.';
/* Deal statuses for videos outside the content-plan tabs, kept in the sponsorship sheet's hidden Studio meta tab. */
async function scriptVideoDeals(set){
 const url=process.env.STUDIO_CALENDAR_SCRIPT_URL,secret=process.env.STUDIO_CALENDAR_SCRIPT_SECRET;
 if(!url||!secret||!/^https:\/\/script\.google\.com\/macros\/s\//.test(url))throw Error('Google Sheets is not connected yet.');
 const upstream=await fetch(url,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'sponsorVideoDeals',set:set||null,secret}),redirect:'follow',signal:AbortSignal.timeout(19000)});
 const raw=await upstream.text();let parsed;try{parsed=JSON.parse(raw)}catch{throw Error(UNEXPECTED)}
 if(!parsed.ok)throw Error(/Unknown sponsorship action/i.test(parsed.error||'')?NEEDS_BRIDGE:(parsed.error||'Google Sheets update failed.'));
 return parsed.deals||{};
}
export default async function handler(request){
 if(request.method!=='POST')return fail('POST required.',405);
 if(!same(request.headers.get('x-board-key'),process.env.BOARD_ACCESS_CODE))return fail('Invalid workspace access code.',401);
 let data;try{data=await request.json();}catch{return fail('Invalid request JSON.');}
 const action=String(data.action||'');
 if(!['list','save','remove','sponsorHistory','videoDeals'].includes(action))return fail('Unsupported calendar action.');
 // Sponsor history: every long-form upload on the channel with the sponsor link read from its description. YouTube only, no sheet round-trip.
 if(action==='sponsorHistory'){
  if(!youtubeConfigured())return fail('Connect YouTube first (YOUTUBE_API_KEY in Netlify, see the README) to list sponsors from video descriptions.',503);
  const dealsPromise=scriptVideoDeals(null).then(d=>({deals:d}),e=>({dealsError:String(e.message||e)}));
  try{
   const{channel,videos}=await allUploads({fresh:Boolean(data.fresh)});
   const slim=v=>({id:v.id,title:v.title,url:v.url,date:v.date,views:v.views,seconds:v.seconds,thumb:v.thumb,sponsor:v.sponsor?{line:v.sponsor.line,lineNo:v.sponsor.lineNo,url:v.sponsor.url,domain:v.sponsor.domain,shortened:Boolean(v.sponsor.shortened),finalDomain:v.sponsor.finalDomain||'',guess:v.sponsor.guess||''}:null});
   const deals=await dealsPromise;
   return Response.json({ok:true,channel,videos:videos.filter(v=>v.long&&v.live!=='upcoming').map(slim),deals:deals.deals||{},dealsError:deals.dealsError||''},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return fail('YouTube: '+String(e.message||e).replace(/^YouTube:\s*/,''),502);}
 }
 if(action==='videoDeals'){
  const set={};
  for(const[id,status]of Object.entries(data.set||{})){
   if(!/^[A-Za-z0-9_-]{11}$/.test(id))return fail('Invalid video id.');
   if(!VIDEO_DEAL_STATUSES.includes(status))return fail('Status must be In progress, Invoiced, Paid or Not a sponsor.');
   set[id]=status;
  }
  if(!Object.keys(set).length||Object.keys(set).length>200)return fail('Nothing to save.');
  try{return Response.json({ok:true,deals:await scriptVideoDeals(set)},{headers:{'Cache-Control':'no-store'}});}
  catch(e){return fail(String(e.message||e),502);}
 }
 const url=process.env.STUDIO_CALENDAR_SCRIPT_URL,secret=process.env.STUDIO_CALENDAR_SCRIPT_SECRET;
 if(!url||!secret)return fail('Calendar connection is not configured yet. Follow the calendar README to connect Google Sheets.',503);
 if(!/^https:\/\/script\.google\.com\/macros\/s\//.test(url))return fail('Invalid Apps Script URL.',503);
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
