/**
 * @OnlyCurrentDoc
 * Josh Brett Studio Content Calendar, backed by existing 2026-content-plan Google Sheet.
 * Paste this code into Apps Script opened from Extensions > Apps Script in the spreadsheet.
 * Uses @OnlyCurrentDoc and getActiveSpreadsheet() to avoid broader spreadsheet OAuth access.
 * In Apps Script Project Settings, create Script property STUDIO_CALENDAR_SECRET.
 * Deploy as Web app, execute as Me, access Anyone. Keep the URL and secret in Netlify only.
 */
const PLAN_SHEET='2026 Content Plan';
const METRICS_SHEET='Studio Metrics';
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}
function validDate(x){if(typeof x!=='string'||!/^2026-\d\d-\d\d$/.test(x))return false;const d=new Date(x+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===x}
function spot(date){const p=date.split('-').map(Number);return{row:p[2]+1,col:p[1]+1}}
function main(){const wb=SpreadsheetApp.getActiveSpreadsheet();if(!wb)throw Error('Open Apps Script via Extensions > Apps Script from the 2026-content-plan spreadsheet, not a standalone script.');const sheet=wb.getSheetByName(PLAN_SHEET);if(!sheet)throw Error('Content plan tab missing');return sheet}
function metricsSheet(){const wb=SpreadsheetApp.getActiveSpreadsheet();let sheet=wb.getSheetByName(METRICS_SHEET);if(!sheet){sheet=wb.insertSheet(METRICS_SHEET);sheet.getRange(1,1,1,4).setValues([['Date','Views at 7 days','CTR percent','Average view duration']]);}return sheet}
function metrics(){const s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(METRICS_SHEET);const map={};if(s&&s.getLastRow()>1){for(const row of s.getRange(2,1,s.getLastRow()-1,4).getValues()){const date=String(row[0]||'');if(date)map[date]={views:row[1]??'',ctr:row[2]??'',avd:row[3]??''}}}return map}
function writeMetric(oldDate,date,values,remove){const s=metricsSheet(),end=s.getLastRow();let target=0;
 if(end>1){const rows=s.getRange(2,1,end-1,1).getValues();for(let i=0;i<rows.length;i++){if(String(rows[i][0])===String(oldDate||date)){target=i+2;break}}}
 if(remove){if(target)s.deleteRow(target);return}
 const row=[date,String(values?.views??''),String(values?.ctr??''),String(values?.avd??'')];
 if(target)s.getRange(target,1,1,4).setValues([row]);else s.appendRow(row)
}
function events(sheet){const data=sheet.getRange('B2:M32').getDisplayValues(),list=[];const metric=metrics();
 for(let m=0;m<12;m++)for(let d=1;d<=31;d++){const day=data[d-1][m];const key='2026-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');if(!validDate(key)||!day.trim())continue;list.push({date:key,text:day,...(metric[key]||{})})}
 return list
}
function doPost(e){try{const data=JSON.parse(e.postData.contents||'{}'),secret=PropertiesService.getScriptProperties().getProperty('STUDIO_CALENDAR_SECRET');
 if(!secret||data.secret!==secret)return json({ok:false,error:'Incorrect calendar secret.'});
 const lock=LockService.getScriptLock();lock.waitLock(15000);
 try{const sheet=main(),action=data.action;
  if(action==='list')return json({ok:true,events:events(sheet)});
  if(action==='save'){
   if(!validDate(data.date)||!String(data.text||'').trim())throw Error('Valid 2026 date and title required.');
   if(data.from&&!validDate(data.from))throw Error('Invalid previous date.');
   const dst=spot(data.date),dstRange=sheet.getRange(dst.row,dst.col),previous=String(dstRange.getDisplayValue()||'');
   if(data.from!==data.date&&previous.trim())throw Error('The destination day already has a plan. Select another day or edit that existing slot.');
   if(data.from&&data.from!==data.date){const src=spot(data.from),srcRange=sheet.getRange(src.row,src.col);if(String(srcRange.getDisplayValue()||'')!==String(data.previousText||''))throw Error('The source entry changed in Google Sheets. Refresh before moving it.');srcRange.clearContent();}
   if(data.from===data.date&&previous!==String(data.previousText||''))throw Error('This entry changed in Google Sheets. Refresh before saving.');
   dstRange.setValue(String(data.text).slice(0,1500));writeMetric(data.from||data.date,data.date,data.metrics,false);
   return json({ok:true,events:events(sheet)});
  }
  if(action==='remove'){
   if(!validDate(data.from))throw Error('Valid date required.');
   const src=spot(data.from),cell=sheet.getRange(src.row,src.col);
   if(String(cell.getDisplayValue()||'')!==String(data.previousText||''))throw Error('This entry changed in Google Sheets. Refresh before removing it.');
   cell.clearContent();writeMetric(data.from,data.from,null,true);return json({ok:true,events:events(sheet)});
  }
  throw Error('Unknown calendar action');
 }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:String(err.message||err)})}
}
