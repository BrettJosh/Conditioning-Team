import {timingSafeEqual} from 'node:crypto';
const fail=(error,status=400)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const same=(a,b)=>{if(!a||!b)return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)};
export default async function handler(request){
 if(request.method!=='POST')return fail('POST required.',405);
 if(!same(request.headers.get('x-board-key'),process.env.BOARD_ACCESS_CODE))return fail('Invalid workspace access code.',401);
 const url=process.env.STUDIO_CALENDAR_SCRIPT_URL,secret=process.env.STUDIO_CALENDAR_SCRIPT_SECRET;
 if(!url||!secret)return fail('Calendar connection is not configured yet. Follow the calendar README to connect Google Sheets.',503);
 if(!/^https:\/\/script\.google\.com\/macros\/s\//.test(url))return fail('Invalid Apps Script URL.',503);
 let data;try{data=await request.json();}catch{return fail('Invalid request JSON.');}
 const action=String(data.action||'');
 if(!['list','save','remove'].includes(action))return fail('Unsupported calendar action.');
 const validDate=d=>typeof d==='string'&&/^2026-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
 if(['save','remove'].includes(action)&&data.from&&!validDate(data.from))return fail('Invalid source date.');
 if(action==='save'&&(!validDate(data.date)||!String(data.text||'').trim()||String(data.text).length>1500))return fail('A valid date and title are required.');
 try{
  const upstream=await fetch(url,{method:'POST',headers:{'content-type':'text/plain;charset=utf-8'},body:JSON.stringify({...data,secret}),redirect:'follow',signal:AbortSignal.timeout(19000)});
  const raw=await upstream.text();let parsed;try{parsed=JSON.parse(raw)}catch{return fail('Google Sheets connection returned an unexpected response. Check your Apps Script deployment.',502)}
  if(!upstream.ok||!parsed.ok)return fail(parsed.error||'Google Sheets update failed.',upstream.status>=400&&upstream.status<500?400:502);
  return Response.json(parsed,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return fail('Unable to reach the Google Sheets calendar. '+String(e.message||''),502);}
}
