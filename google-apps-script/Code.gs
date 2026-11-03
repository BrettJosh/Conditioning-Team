/**
 * Josh Brett Studio Content Calendar, backed by existing 2026-content-plan Google Sheet.
 * Paste this code into a bound Google Apps Script project for that spreadsheet.
 * In Apps Script Project Settings, create Script property STUDIO_CALENDAR_SECRET.
 * Deploy as Web app, execute as Me, access Anyone. Keep the URL and secret in Netlify only.
 * ONE file holds everything: the content calendar (top) and the Sponsorships tab (below).
 * Actions whose name starts with "sponsor" are routed to sponsorRequest() further down.
 */
const PLAN_SHEET='2026 Content Plan';
const METRICS_SHEET='Studio Metrics';
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}
function validDate(x){if(typeof x!=='string'||!/^2026-\d\d-\d\d$/.test(x))return false;const d=new Date(x+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===x}
function spot(date){const p=date.split('-').map(Number);return{row:p[2]+1,col:p[1]+1}}
function main(){const sheet=SpreadsheetApp.openById('1zvaFJCApnz6YFzJCXUtC9BSLW40pR58vyPM7pgSWfB4').getSheetByName(PLAN_SHEET);if(!sheet)throw Error('Content plan tab missing');return sheet}
/** Studio Metrics tab (same spreadsheet): one row per calendar date. Columns are found by their heading, so new ones can be added. */
const METRIC_FIELDS={views:'Views at 7 days',ctr:'CTR percent',avd:'Average view duration',sponsor:'Sponsor',sponsorStatus:'Sponsor status',youtubeUrl:'YouTube link'};
const BRIDGE_VERSION=2;
function metricsSheet(){const wb=SpreadsheetApp.openById('1zvaFJCApnz6YFzJCXUtC9BSLW40pR58vyPM7pgSWfB4');let sheet=wb.getSheetByName(METRICS_SHEET);if(!sheet)sheet=wb.insertSheet(METRICS_SHEET);
 const width=Math.max(sheet.getLastColumn(),1),head=sheet.getRange(1,1,1,width).getValues()[0].map(h=>String(h||'').trim());
 if(!head[0]){head[0]='Date';sheet.getRange(1,1).setValue('Date')}
 Object.keys(METRIC_FIELDS).forEach(k=>{if(head.indexOf(METRIC_FIELDS[k])<0){head.push(METRIC_FIELDS[k]);sheet.getRange(1,head.length).setValue(METRIC_FIELDS[k])}});
 return{sheet,head}}
function metrics(){const{sheet,head}=metricsSheet(),last=sheet.getLastRow(),map={};if(last<2)return map;
 const range=sheet.getRange(2,1,last-1,head.length),raw=range.getValues(),shown=range.getDisplayValues();
 raw.forEach((r,n)=>{const date=isoDate(r[0]);if(!date)return;const o={};Object.keys(METRIC_FIELDS).forEach(k=>{const i=head.indexOf(METRIC_FIELDS[k]);o[k]=i>0?String(shown[n][i]||''):''});map[date]=o});
 return map}
function writeMetric(oldDate,date,values,remove){const{sheet,head}=metricsSheet(),end=sheet.getLastRow(),want=String(oldDate||date);let target=0;
 if(end>1){const col=sheet.getRange(2,1,end-1,1).getValues();for(let i=0;i<col.length;i++){if(isoDate(col[i][0])===want){target=i+2;break}}}
 if(remove){if(target)sheet.deleteRow(target);return}
 const row=target?sheet.getRange(target,1,1,head.length).getDisplayValues()[0]:head.map(()=>'');row[0]=date;
 Object.keys(METRIC_FIELDS).forEach(k=>{const i=head.indexOf(METRIC_FIELDS[k]);if(i>0&&values&&Object.prototype.hasOwnProperty.call(values,k))row[i]=String(values[k]??'').slice(0,500)});
 const range=sheet.getRange(target||end+1,1,1,head.length);range.setNumberFormat('@');range.setValues([row]) // stored as plain text so "7:30" and dates stay exactly as typed
}
function events(sheet){const data=sheet.getRange('B2:M32').getDisplayValues(),list=[];const metric=metrics();
 for(let m=0;m<12;m++)for(let d=1;d<=31;d++){const day=data[d-1][m];const key='2026-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');if(!validDate(key)||!day.trim())continue;list.push({date:key,text:day,...(metric[key]||{})})}
 return list
}
function doPost(e){try{const data=JSON.parse(e.postData.contents||'{}'),secret=PropertiesService.getScriptProperties().getProperty('STUDIO_CALENDAR_SECRET');
 if(!secret||data.secret!==secret)return json({ok:false,error:'Incorrect calendar secret.'});
 const lock=LockService.getScriptLock();lock.waitLock(15000);
 try{const action=data.action;
  if(String(action||'').indexOf('sponsor')===0)return json(sponsorRequest(data)); // Sponsorships.gs
  const sheet=main();
  if(action==='list')return json({ok:true,events:events(sheet),bridgeVersion:BRIDGE_VERSION});
  if(action==='save'){
   if(!validDate(data.date)||!String(data.text||'').trim())throw Error('Valid 2026 date and title required.');
   if(data.from&&!validDate(data.from))throw Error('Invalid previous date.');
   const dst=spot(data.date),dstRange=sheet.getRange(dst.row,dst.col),previous=String(dstRange.getDisplayValue()||'');
   if(data.from!==data.date&&previous.trim())throw Error('The destination day already has a plan. Select another day or edit that existing slot.');
   if(data.from&&data.from!==data.date){const src=spot(data.from),srcRange=sheet.getRange(src.row,src.col);if(String(srcRange.getDisplayValue()||'')!==String(data.previousText||''))throw Error('The source entry changed in Google Sheets. Refresh before moving it.');srcRange.clearContent();}
   if(data.from===data.date&&previous!==String(data.previousText||''))throw Error('This entry changed in Google Sheets. Refresh before saving.');
   dstRange.setValue(String(data.text).slice(0,1500));writeMetric(data.from||data.date,data.date,data.metrics,false);
   return json({ok:true,events:events(sheet),bridgeVersion:BRIDGE_VERSION});
  }
  if(action==='remove'){
   if(!validDate(data.from))throw Error('Valid date required.');
   const src=spot(data.from),cell=sheet.getRange(src.row,src.col);
   if(String(cell.getDisplayValue()||'')!==String(data.previousText||''))throw Error('This entry changed in Google Sheets. Refresh before removing it.');
   cell.clearContent();writeMetric(data.from,data.from,null,true);return json({ok:true,events:events(sheet),bridgeVersion:BRIDGE_VERSION});
  }
  throw Error('Unknown calendar action');
 }finally{lock.releaseLock()}
 }catch(err){return json({ok:false,error:String(err.message||err)})}
}

/* =====================================================================================
 * SPONSORSHIPS TAB — brand-deal tracker, backed by the Google Sheet "Sponsorship outreach 2026".
 * Tabs used: Brands, Agencies, Action list. On first use the script adds an ID column to Brands
 * and Agencies, an "Email log" tab and a hidden "Studio meta" tab. Nothing else is restructured.
 * Finding the sheet: Script property STUDIO_SPONSORSHIP_SHEET_ID wins; otherwise SPONSOR_SHEET_ID.
 * Only SpreadsheetApp is used on purpose (a Drive lookup would be blocked for unverified scripts).
 * ===================================================================================== */
const SPONSOR_SHEET_ID = '1yvBS7TYPy7v-kQldwYSJAvq4dMuGF1ZUkLP_SKPy_Is'; // "Sponsorship outreach 2026"
const SPONSOR_TABS = { brands: 'Brands', agencies: 'Agencies' };
const ACTION_TAB = 'Action list';
const EMAIL_TAB = 'Email log';
const META_TAB = 'Studio meta';
const EMAIL_HEADERS = ['Date', 'Direction', 'Matched to', 'Tab', 'Record ID', 'From', 'To', 'Subject', 'Snippet', 'Message ID', 'Thread ID', 'Folder', 'Matched by', 'Logged at'];
const MAX_TEXT = 6000;

/** Column map for each tab: internal field → header text in row 4. */
const BRAND_FIELDS = {
  name: 'Brand', status: 'Status', summary: "What's happening (one line)", nextStep: 'Next step',
  lastActivity: 'Last activity', daysSince: 'Days since', firstContact: 'First contact', via: 'Via',
  contact: 'Contact', initiatedBy: 'Initiated by', category: 'Category', rate: 'Rate discussed',
  agreedValue: 'Agreed value (USD)', history: 'Full history', id: 'ID'
};
const AGENCY_FIELDS = {
  name: 'Agency / network', status: 'Status', summary: 'Where it stands (one line)',
  lastActivity: 'Last activity', daysSince: 'Days since', firstContact: 'First contact',
  contact: 'Contact', type: 'Type', terms: 'Terms / rate on file', brands: 'Brands brought or mentioned',
  history: 'Full history', id: 'ID'
};
const DATE_FIELDS = ['lastActivity', 'firstContact'];
const EDITABLE = {
  brands: ['name', 'status', 'summary', 'nextStep', 'lastActivity', 'firstContact', 'via', 'contact', 'initiatedBy', 'category', 'rate', 'agreedValue', 'history'],
  agencies: ['name', 'status', 'summary', 'lastActivity', 'firstContact', 'contact', 'type', 'terms', 'brands', 'history']
};

function sponsorWorkbook() {
  const id = PropertiesService.getScriptProperties().getProperty('STUDIO_SPONSORSHIP_SHEET_ID');
  try { return SpreadsheetApp.openById((id || SPONSOR_SHEET_ID).trim()); }
  catch (e) { throw Error('Sponsorship sheet not found. Set the STUDIO_SPONSORSHIP_SHEET_ID script property to the ID in the sheet\'s URL.'); }
}

function tz() { return Session.getScriptTimeZone() || 'Europe/London'; }
function isoDate(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) return Utilities.formatDate(value, tz(), 'yyyy-MM-dd');
  const text = String(value || '').trim();
  if (/^\d{4}-\d\d-\d\d/.test(text)) return text.slice(0, 10);
  if (/^\d\d\/\d\d\/\d{4}$/.test(text)) { const p = text.split('/'); return p[2] + '-' + p[1] + '-' + p[0]; }
  return '';
}
function toCellDate(iso) {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(iso || ''))) return '';
  const p = String(iso).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
}
function todayIso() { return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd'); }
function clean(value, max) { return String(value == null ? '' : value).slice(0, max || MAX_TEXT); }
function newId(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function numberOrBlank(value) { if (value === '' || value == null) return ''; const n = Number(String(value).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? '' : n; }

/** Reads a tracker tab (Brands or Agencies): header row 4, data from row 5. Adds the ID column if missing. */
function readTab(wb, tab) {
  const sheet = wb.getSheetByName(SPONSOR_TABS[tab]);
  if (!sheet) throw Error('The "' + SPONSOR_TABS[tab] + '" tab is missing from the sponsorship sheet.');
  const fields = tab === 'brands' ? BRAND_FIELDS : AGENCY_FIELDS;
  const headerRow = 4;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const cols = {};
  Object.keys(fields).forEach(key => { const i = headers.findIndex(h => h.toLowerCase() === fields[key].toLowerCase()); if (i >= 0) cols[key] = i + 1; });
  if (!cols.name || !cols.status) throw Error('Row 4 of "' + SPONSOR_TABS[tab] + '" must hold the column headings (' + fields.name + ', Status, …).');
  if (!cols.id) {
    const idCol = headers.length + 1;
    sheet.getRange(headerRow, idCol).setValue('ID').setFontWeight('bold');
    cols.id = idCol;
  }
  const lastRow = sheet.getLastRow();
  const rows = [];
  if (lastRow >= headerRow + 1) {
    const width = Math.max(sheet.getLastColumn(), cols.id);
    const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, width).getValues();
    const idWrites = [];
    values.forEach((row, i) => {
      const name = String(row[cols.name - 1] || '').trim();
      if (!name) return;
      let id = String(row[cols.id - 1] || '').trim();
      if (!id) { id = newId(tab === 'brands' ? 'b' : 'a'); idWrites.push([headerRow + 1 + i, id]); }
      const record = { id: id, row: headerRow + 1 + i };
      Object.keys(cols).forEach(key => {
        if (key === 'id') return;
        const raw = row[cols[key] - 1];
        if (DATE_FIELDS.indexOf(key) >= 0) record[key] = isoDate(raw);
        else if (key === 'daysSince') record[key] = raw === '' || raw == null ? '' : Number(raw);
        else if (key === 'agreedValue') record[key] = numberOrBlank(raw);
        else record[key] = clean(raw);
      });
      rows.push(record);
    });
    idWrites.forEach(w => sheet.getRange(w[0], cols.id).setValue(w[1]));
  }
  return { sheet: sheet, cols: cols, rows: rows, headerRow: headerRow };
}

function findRow(info, id) {
  const record = info.rows.find(r => r.id === id);
  if (!record) throw Error('That record was not found in the sheet. Refresh and try again.');
  return record;
}

function writeFields(info, tab, rowNumber, patch) {
  const allowed = EDITABLE[tab];
  Object.keys(patch || {}).forEach(key => {
    if (allowed.indexOf(key) < 0 || !info.cols[key]) return;
    let value = patch[key];
    if (DATE_FIELDS.indexOf(key) >= 0) value = toCellDate(isoDate(value));
    else if (key === 'agreedValue') value = numberOrBlank(value);
    else value = clean(value);
    const cell = info.sheet.getRange(rowNumber, info.cols[key]);
    if (key === 'status') addStatusOption(info, cell, value);
    try { cell.setValue(value); }
    catch (e) {
      if (key !== 'status' || !/validation/i.test(String(e.message || e))) throw e;
      cell.setDataValidation(null); cell.setValue(value); // the sheet's dropdown rejected a new status: keep the value, drop the rule for that cell
    }
  });
}
/** The Status column in the sheet is a dropdown; a status chosen in the app that it doesn't know yet is added to the list. */
function addStatusOption(info, cell, value) {
  try {
    const rule = cell.getDataValidation();
    if (!value || !rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return;
    const args = rule.getCriteriaValues(), list = (args[0] || []).map(String);
    if (list.indexOf(value) >= 0) return;
    list.push(value);
    const built = SpreadsheetApp.newDataValidation().requireValueInList(list, args[1] !== false).setAllowInvalid(rule.getAllowInvalid()).build();
    const lastRow = Math.max(info.sheet.getLastRow(), cell.getRow());
    info.sheet.getRange(info.headerRow + 1, cell.getColumn(), lastRow - info.headerRow, 1).setDataValidation(built);
  } catch (e) { /* the dropdown is a convenience; never block a save over it */ }
}

/** Action list tab: headers on row 3, open items until the "Completed" marker row. */
function readActions(wb) {
  const sheet = wb.getSheetByName(ACTION_TAB);
  if (!sheet) return { open: [], completed: [] };
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return { open: [], completed: [] };
  const values = sheet.getRange(1, 1, lastRow, 8).getValues();
  const open = [], completed = [];
  let section = 'open', headerSeen = false;
  values.forEach((row, i) => {
    const rowNumber = i + 1;
    const a = String(row[0] || '').trim(), b = String(row[1] || '').trim(), c = String(row[2] || '').trim();
    if (!headerSeen) { if (a.toLowerCase() === 'priority') headerSeen = true; return; }
    if (a.toLowerCase() === 'completed') { section = 'completed'; return; }
    if (section === 'open') {
      if (!a && !b && !c) return;
      open.push({ row: rowNumber, priority: a, who: b, what: c, why: clean(row[3]), lastWrote: isoDate(row[4]), daysWaiting: row[5] === '' ? '' : Number(row[5]), done: String(row[6] || '').trim(), tab: String(row[7] || '').trim() });
    } else {
      if (!b && !c) return;
      if (b.toLowerCase() === 'who' && c.toLowerCase().indexOf('what') === 0) return;
      completed.push({ row: rowNumber, who: b, what: c, date: isoDate(row[4]) });
    }
  });
  return { open: open, completed: completed, sheet: sheet };
}

function emailSheet(wb) {
  let sheet = wb.getSheetByName(EMAIL_TAB);
  if (!sheet) {
    sheet = wb.insertSheet(EMAIL_TAB);
    sheet.getRange(1, 1, 1, EMAIL_HEADERS.length).setValues([EMAIL_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), EMAIL_HEADERS.length).setNumberFormat('@');
  }
  return sheet;
}

function readEmails(wb, limit) {
  const sheet = emailSheet(wb);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, EMAIL_HEADERS.length).getValues();
  const list = values.map((row, i) => ({
    row: i + 2, date: String(row[0] || ''), direction: String(row[1] || ''), matchedTo: String(row[2] || ''), tab: String(row[3] || ''),
    recordId: String(row[4] || ''), from: String(row[5] || ''), to: String(row[6] || ''), subject: String(row[7] || ''), snippet: String(row[8] || ''),
    messageId: String(row[9] || ''), threadId: String(row[10] || ''), folder: String(row[11] || ''), matchedBy: String(row[12] || ''), loggedAt: String(row[13] || '')
  })).filter(e => e.date || e.subject);
  list.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  return limit ? list.slice(0, limit) : list;
}

function metaSheet(wb) {
  let sheet = wb.getSheetByName(META_TAB);
  if (!sheet) { sheet = wb.insertSheet(META_TAB); sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]); sheet.hideSheet(); }
  return sheet;
}
function readMeta(wb) {
  const sheet = metaSheet(wb); const lastRow = sheet.getLastRow(); const meta = {};
  if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(r => { if (r[0]) meta[String(r[0])] = String(r[1] == null ? '' : r[1]); });
  return meta;
}
function writeMeta(wb, patch) {
  const sheet = metaSheet(wb); const lastRow = sheet.getLastRow();
  const keys = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0])) : [];
  Object.keys(patch).forEach(key => {
    const value = clean(patch[key], 20000); const i = keys.indexOf(key);
    if (i >= 0) sheet.getRange(i + 2, 2).setValue(value); else { sheet.appendRow([key, value]); keys.push(key); }
  });
}

function syncState(meta) { try { return JSON.parse(meta.zohoSync || '{}'); } catch (e) { return {}; } }

function listPayload(wb) {
  const brands = readTab(wb, 'brands'), agencies = readTab(wb, 'agencies'), actions = readActions(wb);
  const meta = readMeta(wb);
  return {
    ok: true,
    brands: brands.rows, agencies: agencies.rows,
    actions: actions.open, completed: actions.completed,
    emails: readEmails(wb, 600),
    sheetUrl: wb.getUrl(),
    sync: syncState(meta)
  };
}

/** Appends a dated bullet to the top of Full history and bumps Last activity. */
function appendHistory(info, tab, record, text, iso) {
  const stamp = Utilities.formatDate(toCellDate(iso) || new Date(), tz(), 'd MMM');
  const line = '• ' + stamp + ': ' + clean(text, 1500);
  const existing = record.history ? record.history : '';
  const history = existing ? line + '\n' + existing : line;
  const patch = { history: history };
  if (!record.lastActivity || iso > record.lastActivity) patch.lastActivity = iso;
  writeFields(info, tab, record.row, patch);
}

/** Stores a batch of emails (deduped on Message ID) and refreshes Last activity on matched rows. */
function logEmails(wb, emails, state) {
  const sheet = emailSheet(wb);
  const existing = readEmails(wb, 0);
  const known = {};
  existing.forEach(e => { if (e.messageId) known[e.messageId] = true; });
  const infos = { brands: readTab(wb, 'brands'), agencies: readTab(wb, 'agencies') };
  const rows = [], latest = {};
  const loggedAt = new Date().toISOString();
  (emails || []).forEach(e => {
    const messageId = clean(e.messageId, 80);
    if (!messageId || known[messageId]) return;
    known[messageId] = true;
    const tab = e.tab === 'brands' || e.tab === 'agencies' ? e.tab : 'unmatched';
    rows.push([clean(e.date, 40), e.direction === 'out' ? 'out' : 'in', clean(e.matchedTo, 200), tab, clean(e.recordId, 40), clean(e.from, 300), clean(e.to, 600), clean(e.subject, 500), clean(e.snippet, 600), messageId, clean(e.threadId, 80), clean(e.folder, 60), clean(e.matchedBy, 60), loggedAt]);
    const day = isoDate(String(e.date || '').slice(0, 10));
    const bump = (t, id) => { if (!day || !id || (t !== 'brands' && t !== 'agencies')) return; const key = t + '|' + id; if (!latest[key] || day > latest[key]) latest[key] = day; };
    if (tab !== 'unmatched') bump(tab, e.recordId);
    (Array.isArray(e.also) ? e.also : []).forEach(a => bump(a && a.tab, a && a.id));
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, EMAIL_HEADERS.length).setValues(rows);
  let touched = 0;
  Object.keys(latest).forEach(key => {
    const parts = key.split('|'), info = infos[parts[0]];
    const record = info.rows.find(r => r.id === parts[1]);
    if (record && (!record.lastActivity || latest[key] > record.lastActivity)) { writeFields(info, parts[0], record.row, { lastActivity: latest[key] }); touched++; }
  });
  if (state) writeMeta(wb, { zohoSync: JSON.stringify(state) });
  return { ok: true, added: rows.length, skipped: (emails || []).length - rows.length, touched: touched };
}

/** Assigns an Email log row (and its whole thread) to a brand or agency, optionally saving the address as a contact. */
function assignEmail(wb, data) {
  const tab = data.tab === 'agencies' ? 'agencies' : 'brands';
  const info = readTab(wb, tab);
  const record = findRow(info, String(data.id || ''));
  const sheet = emailSheet(wb);
  const emails = readEmails(wb, 0);
  const target = emails.find(e => e.messageId === String(data.messageId || ''));
  if (!target) throw Error('That email is no longer in the log.');
  const sameThread = emails.filter(e => e.messageId === target.messageId || (target.threadId && e.threadId === target.threadId && e.tab === 'unmatched'));
  sameThread.forEach(e => sheet.getRange(e.row, 3, 1, 3).setValues([[record.name, tab, record.id]]));
  sameThread.forEach(e => sheet.getRange(e.row, 13).setValue('manual'));
  const dates = sameThread.map(e => isoDate(e.date.slice(0, 10))).filter(Boolean).sort();
  const latest = dates[dates.length - 1];
  const patch = {};
  if (latest && (!record.lastActivity || latest > record.lastActivity)) patch.lastActivity = latest;
  if (data.saveContact) {
    const address = String(data.saveContact).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && (record.contact || '').toLowerCase().indexOf(address) < 0) patch.contact = (record.contact ? record.contact + '\n' : '') + address;
  }
  if (Object.keys(patch).length) writeFields(info, tab, record.row, patch);
  return { ok: true, updated: sameThread.length };
}

/** Compact context for the Zoho sync: who to match against, which messages are already logged, thread → record. */
function syncContext(wb) {
  const brands = readTab(wb, 'brands'), agencies = readTab(wb, 'agencies');
  const strip = r => ({ id: r.id, name: r.name, contact: r.contact, via: r.via || '', status: r.status });
  const emails = readEmails(wb, 0);
  const known = [], threads = {};
  emails.forEach(e => { if (e.messageId) known.push(e.messageId); if (e.threadId && e.tab !== 'unmatched' && !threads[e.threadId]) threads[e.threadId] = { tab: e.tab, id: e.recordId, name: e.matchedTo }; });
  return { ok: true, brands: brands.rows.map(strip), agencies: agencies.rows.map(strip), knownMessageIds: known.slice(-5000), threads: threads, sync: syncState(readMeta(wb)) };
}

/** Entry point called from Code.gs doPost for any action starting with "sponsor". */
function sponsorRequest(data) {
  const wb = sponsorWorkbook();
  const action = String(data.action || '');
  if (action === 'sponsorList') return listPayload(wb);
  if (action === 'sponsorSyncContext') return syncContext(wb);
  if (action === 'sponsorSyncState') { writeMeta(wb, { zohoSync: JSON.stringify(data.state || {}) }); return { ok: true }; }
  if (action === 'sponsorEmails') return logEmails(wb, data.emails, data.state);
  if (action === 'sponsorAssign') return assignEmail(wb, data);
  const tab = data.tab === 'agencies' ? 'agencies' : 'brands';
  if (action === 'sponsorUpdate') {
    const info = readTab(wb, tab); const record = findRow(info, String(data.id || ''));
    if (data.patch && 'name' in data.patch && !String(data.patch.name || '').trim()) throw Error('A name is required.');
    writeFields(info, tab, record.row, data.patch || {});
    return listPayload(wb);
  }
  if (action === 'sponsorAdd') {
    const info = readTab(wb, tab); const record = data.record || {};
    if (!String(record.name || '').trim()) throw Error('Give the ' + (tab === 'brands' ? 'brand' : 'agency') + ' a name.');
    const today = todayIso();
    const rowNumber = Math.max(info.sheet.getLastRow() + 1, info.headerRow + 1);
    const id = newId(tab === 'brands' ? 'b' : 'a');
    info.sheet.getRange(rowNumber, info.cols.id).setValue(id);
    const fields = Object.assign({ lastActivity: today, firstContact: today, status: tab === 'brands' ? 'In conversation' : "Awaiting Josh's reply" }, record);
    writeFields(info, tab, rowNumber, fields);
    if (info.cols.daysSince) { const col = info.cols.lastActivity; const letter = col ? columnLetter(col) : ''; if (letter) info.sheet.getRange(rowNumber, info.cols.daysSince).setFormula('=IF(' + letter + rowNumber + '="","",TODAY()-' + letter + rowNumber + ')'); }
    return listPayload(wb);
  }
  if (action === 'sponsorNote') {
    const info = readTab(wb, tab); const record = findRow(info, String(data.id || ''));
    const text = clean(data.text, 1500).trim(); if (!text) throw Error('Write a note first.');
    const iso = isoDate(data.date) || todayIso();
    const direction = data.direction === 'in' || data.direction === 'out' ? data.direction : 'note';
    const prefix = direction === 'in' ? 'They wrote — ' : direction === 'out' ? 'Josh wrote — ' : '';
    appendHistory(info, tab, record, prefix + text, iso);
    if (direction !== 'note') {
      logEmails(wb, [{ date: iso + 'T12:00:00Z', direction: direction, matchedTo: record.name, tab: tab, recordId: record.id, from: direction === 'in' ? record.name : 'Josh', to: direction === 'in' ? 'Josh' : record.name, subject: text.slice(0, 120), snippet: text, messageId: 'manual-' + newId('m'), threadId: '', folder: 'Manual', matchedBy: 'manual' }], null);
    }
    return listPayload(wb);
  }
  if (action === 'sponsorAction') {
    const actions = readActions(wb); const item = actions.open.find(a => a.row === Number(data.row));
    if (!item || item.what !== String(data.what || '')) throw Error('That action changed in the sheet. Refresh first.');
    actions.sheet.getRange(item.row, 7).setValue(data.done ? 'Yes' : 'No');
    return listPayload(wb);
  }
  throw Error('Unknown sponsorship action');
}

function columnLetter(col) { let s = ''; while (col > 0) { const m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - 1) / 26); } return s; }

/** Run this from the editor (choose studioSelfTest in the toolbar, press Run) to check everything. */
function studioSelfTest() {
  const secret = PropertiesService.getScriptProperties().getProperty('STUDIO_CALENDAR_SECRET');
  Logger.log('Secret set: ' + (secret ? 'yes (' + secret.length + ' chars)' : 'NO — add STUDIO_CALENDAR_SECRET under Project Settings → Script properties'));
  const calendar = events(main());
  Logger.log('Calendar OK: ' + calendar.length + ' scheduled entries');
  const result = sponsorRequest({ action: 'sponsorList' });
  Logger.log('Sponsorships OK: ' + result.brands.length + ' brands, ' + result.agencies.length + ' agencies, ' + result.actions.length + ' open actions');
  Logger.log('All good — now Deploy → Manage deployments → ✎ → New version → Deploy.');
}
