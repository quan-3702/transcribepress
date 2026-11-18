// TranscribePress – transcript formatting, exports, redaction, share file and audio clips (pure functions, no DOM).
const TP = (() => {
const pad = (n, w) => String(n).padStart(w || 2, '0');
// 75 -> "1:15", 3725 -> "1:02:05"
function clock(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (t) => String(t || '').replace(/\s*\n\s*/g, ' ').trim();
const spkName = (names, i) => (i == null || i < 0 ? '' : (names && names[i] && String(names[i]).trim()) || `Speaker ${i + 1}`);

// ---- redaction ----
function luhn(d) { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; }
const RX_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RX_URL = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const RX_CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const RX_PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}/g;
const RX_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
// opts: { email, phone, card, url, ssn, names: ['Anna', ...] } -> text with [EMAIL], [PHONE], [CARD], [LINK], [ID], [NAME]
function redact(text, opts) {
  opts = opts || {};
  let t = String(text || '');
  if (opts.email) t = t.replace(RX_EMAIL, '[EMAIL]');
  if (opts.url) t = t.replace(RX_URL, (m) => { const tail = (m.match(/[.,;:!?)]+$/) || [''])[0]; return '[LINK]' + tail; });
  if (opts.ssn) t = t.replace(RX_SSN, '[ID]');
  if (opts.card) t = t.replace(RX_CARD, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) ? '[CARD]' : m; });
  if (opts.phone) t = t.replace(RX_PHONE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[PHONE]' : m));
  const names = (opts.names || []).map((n) => String(n).trim()).filter((n) => n.length > 1).sort((a, b) => b.length - a.length);
  for (const n of names) t = t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1[NAME]');
  return t;
}
const anyRedact = (o) => !!o && (o.email || o.phone || o.card || o.url || o.ssn || (o.names && o.names.some((n) => String(n).trim().length > 1)));

// ---- paragraphs: lines joined while the same person speaks and there is no long pause ----
// lines: [{start,end,text,spk?,star?}]
function paragraphs(lines, opts) {
  opts = opts || {};
  const gap = opts.gap == null ? 2.5 : opts.gap, maxLen = opts.maxLen || 900;
  const out = [];
  for (const c of lines || []) {
    const text = oneLine(c.text); if (!text) continue;
    const spk = c.spk == null || c.spk < 0 ? -1 : c.spk;
    const last = out[out.length - 1];
    if (last && last.spk === spk && !c.star && !last.star && c.start - last.end < gap && last.text.length + text.length < maxLen) { last.text += ' ' + text; last.end = c.end; last.n++; }
    else out.push({ spk, start: c.start, end: c.end, text, star: !!c.star, n: 1 });
  }
  return out;
}

// ---- exports ----
// o: { names, times (bool), speakers (bool), redact (opts), title, meta: {file, date, duration, lang} }
function prepared(lines, o) {
  o = o || {};
  const r = anyRedact(o.redact) ? o.redact : null;
  return (lines || []).map((c) => ({ ...c, text: r ? redact(c.text, r) : String(c.text || '') }));
}
function toText(lines, o) {
  o = o || {};
  const ps = paragraphs(prepared(lines, o));
  const spk = o.speakers !== false && ps.some((p) => p.spk >= 0);
  return ps.map((p) => `${o.times ? `[${clock(p.start)}] ` : ''}${spk && p.spk >= 0 ? spkName(o.names, p.spk) + ': ' : ''}${p.star ? '★ ' : ''}${p.text}`).join('\n\n') + '\n';
}
function toMarkdown(lines, o) {
  o = o || {};
  const ps = paragraphs(prepared(lines, o)), m = o.meta || {};
  const spk = o.speakers !== false && ps.some((p) => p.spk >= 0);
  const head = [`# ${o.title || m.file || 'Transcript'}`, ''];
  const info = [['Date', m.date], ['File', m.file], ['Length', m.duration]].filter((x) => x[1]).map(([k, v]) => `- **${k}:** ${v}`);
  if (info.length) head.push(...info, '');
  return head.join('\n') + ps.map((p) => `${o.times !== false ? `\`${clock(p.start)}\` ` : ''}${spk && p.spk >= 0 ? `**${spkName(o.names, p.spk)}:** ` : ''}${p.star ? '★ ' : ''}${p.text.replace(/([*_`#\\])/g, '\\$1')}`).join('\n\n') + '\n';
}
function toCSV(lines, o) {
  o = o || {};
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  return 'Start,End,Speaker,Text\r\n' + prepared(lines, o).map((c) => [clock(c.start), clock(c.end), q(spkName(o.names, c.spk)), q(oneLine(c.text))].join(',')).join('\r\n') + '\r\n';
}
function toJSON(lines, o) {
  o = o || {};
  return JSON.stringify({ app: 'TranscribePress', version: 1, title: o.title || '', meta: o.meta || {}, speakers: (o.names || []).map((n, i) => spkName(o.names, i)),
    lines: prepared(lines, o).map((c) => ({ start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000, speaker: c.spk == null || c.spk < 0 ? null : spkName(o.names, c.spk), text: oneLine(c.text) })) }, null, 2);
}
const SPK_COL = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#e87ba4', '#008300', '#6250d6', '#e34948'];
// a clean, printable web page (also used for "Save as PDF")
function toHTMLDoc(lines, o) {
  o = o || {};
  const ps = paragraphs(prepared(lines, o)), m = o.meta || {};
  const spk = o.speakers !== false && ps.some((p) => p.spk >= 0);
  const info = [['Date', m.date], ['File', m.file], ['Length', m.duration]].filter((x) => x[1]).map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join('');
  const body = ps.map((p) => `<p>${o.times !== false ? `<span class="t">${clock(p.start)}</span>` : ''}${spk && p.spk >= 0 ? `<b style="color:${SPK_COL[p.spk % SPK_COL.length]}">${esc(spkName(o.names, p.spk))}:</b> ` : ''}${p.star ? '★ ' : ''}${esc(p.text)}</p>`).join('\n');
  return `<!doctype html><html lang="${esc(m.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title || 'Transcript')}</title><style>body{font:16px/1.6 Calibri,"Segoe UI",Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1f2937}h1{font-size:26px;color:#0f766e;margin:0 0 6px}.info{color:#6b7280;font-size:14px;display:flex;gap:18px;flex-wrap:wrap;margin-bottom:24px}.t{color:#6b7280;font-size:13px;margin-right:8px;font-variant-numeric:tabular-nums}p{margin:0 0 12px}footer{color:#9ca3af;font-size:12px;margin-top:30px}@media print{body{margin:0}}</style></head><body><h1>${esc(o.title || 'Transcript')}</h1><div class="info">${info}</div>${body}<footer>Made with TranscribePress – transcribed on this computer.</footer></body></html>`;
}

// ---- Word ----
function xmlEsc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
function wRun(text, f) { f = f || {}; const pr = (f.b ? '<w:b/>' : '') + (f.color ? `<w:color w:val="${f.color.replace('#', '')}"/>` : '') + (f.sz ? `<w:sz w:val="${f.sz}"/>` : ''); return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`; }
function wPara(runs, style) { return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`; }
// makeZip: NC.makeZip (stored ZIP) is passed in so this file stays free of other dependencies
function toDocx(lines, o, makeZip) {
  o = o || {};
  const ps = paragraphs(prepared(lines, o)), m = o.meta || {};
  const spk = o.speakers !== false && ps.some((p) => p.spk >= 0);
  const body = [wPara(wRun(o.title || 'Transcript'), 'Title')];
  [['Date', m.date], ['File', m.file], ['Length', m.duration]].filter((x) => x[1]).forEach(([k, v]) => body.push(wPara(wRun(k + ': ', { b: true }) + wRun(v))));
  if (spk && o.stats && o.stats.length) {
    body.push(wPara(wRun('Speakers'), 'Heading1'));
    o.stats.forEach((s, i) => { if (s.lines) body.push(wPara(wRun(spkName(o.names, i), { b: true, color: SPK_COL[i % SPK_COL.length] }) + wRun(` – spoke for ${clock(s.time)}`), 'ListBullet')); });
  }
  body.push(wPara(wRun('Transcript'), 'Heading1'));
  for (const p of ps) body.push(wPara((o.times !== false ? wRun(`[${clock(p.start)}]  `, { color: '#6b7280', sz: 18 }) : '') + (spk && p.spk >= 0 ? wRun(spkName(o.names, p.spk) + ': ', { b: true, color: SPK_COL[p.spk % SPK_COL.length] }) : '') + wRun((p.star ? '★ ' : '') + p.text)));
  body.push(wPara(wRun('Made with TranscribePress – transcribed on this computer.', { color: '#9ca3af', sz: 16 })));
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="0F766E"/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style></w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
  return makeZip([['[Content_Types].xml', types], ['_rels/.rels', rels], ['word/document.xml', doc], ['word/styles.xml', styles], ['word/numbering.xml', numbering], ['word/_rels/document.xml.rels', docRels]]);
}

// ---- interactive share file: one HTML with the sound inside; click any sentence to hear it ----
// audioUrl: a data: URL (mp3) – the file works offline and needs nothing else
function shareHtml(lines, o, audioUrl) {
  o = o || {};
  const ps = paragraphs(prepared(lines, o), { gap: 0.6, maxLen: 260 }), m = o.meta || {};
  const spk = o.speakers !== false && ps.some((p) => p.spk >= 0);
  const data = ps.map((p) => [Math.round(p.start * 100) / 100, Math.round(p.end * 100) / 100, spk && p.spk >= 0 ? spkName(o.names, p.spk) : '', p.text, p.spk]);
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="${esc(m.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title || 'Transcript')}</title><style>
:root{--bg:#f8fafc;--fg:#1f2937;--mut:#6b7280;--card:#fff;--hl:#ccfbf1;--ac:#0f766e}@media(prefers-color-scheme:dark){:root{--bg:#0f172a;--fg:#e5e7eb;--mut:#94a3b8;--card:#111827;--hl:#134e4a;--ac:#2dd4bf}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 "Segoe UI",system-ui,Arial,sans-serif}header{position:sticky;top:0;background:var(--card);border-bottom:1px solid #8883;padding:12px 16px;z-index:2}h1{font-size:19px;margin:0 0 6px;color:var(--ac)}audio{width:100%}.info{color:var(--mut);font-size:13px}main{max-width:820px;margin:0 auto;padding:16px}
.p{display:flex;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer}.p:hover{background:#8881}.p.on{background:var(--hl)}.t{color:var(--mut);font-size:13px;min-width:54px;font-variant-numeric:tabular-nums;padding-top:2px}.s{font-weight:700}input[type=search]{width:100%;padding:8px 10px;border-radius:8px;border:1px solid #8885;background:var(--bg);color:var(--fg);margin-top:8px}mark{background:#fde68a;color:#111}footer{color:var(--mut);font-size:12px;text-align:center;padding:24px}
</style></head><body><header><h1>${esc(o.title || 'Transcript')}</h1><div class="info">${esc([m.date, m.duration].filter(Boolean).join(' · '))}</div><audio id="a" controls preload="metadata" src="${audioUrl || ''}"></audio><input type="search" id="q" placeholder="Search the transcript…"></header><main id="list"></main><footer>Made with TranscribePress · click any sentence to hear it</footer>
<script>(function(){var D=${json},C=${JSON.stringify(SPK_COL)},a=document.getElementById('a'),L=document.getElementById('list'),q=document.getElementById('q');function e(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}function ck(s){s=Math.floor(s);var h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+':'+(m<10?'0':''):'')+m+':'+(x<10?'0':'')+x}
function draw(){var w=q.value.trim().toLowerCase();L.innerHTML=D.map(function(d,i){if(w&&d[3].toLowerCase().indexOf(w)<0&&d[2].toLowerCase().indexOf(w)<0)return'';var t=e(d[3]);if(w){t=t.replace(new RegExp(w.replace(/[.*+?^$\{\}()|[\\]\\\\]/g,'\\\\$&'),'gi'),function(x){return'<mark>'+x+'</mark>'})}return'<div class="p" data-i="'+i+'"><span class="t">'+ck(d[0])+'</span><div>'+(d[2]?'<span class="s" style="color:'+C[d[4]%C.length]+'">'+e(d[2])+':</span> ':'')+t+'</div></div>'}).join('')}
draw();q.oninput=draw;L.onclick=function(ev){var p=ev.target.closest('.p');if(!p)return;a.currentTime=D[+p.dataset.i][0];a.play()};var last=-1;a.ontimeupdate=function(){var t=a.currentTime,k=-1;for(var i=0;i<D.length;i++){if(D[i][0]<=t+0.05)k=i;else break}if(k===last)return;last=k;var o=L.querySelector('.on');if(o)o.classList.remove('on');var n=L.querySelector('[data-i="'+k+'"]');if(n){n.classList.add('on');var r=n.getBoundingClientRect();if(r.top<120||r.bottom>innerHeight)n.scrollIntoView({block:'center',behavior:'smooth'})}}})();</script></body></html>`;
}

// ---- audio clips ----
// WAV (16-bit PCM) from one or two Float32Array channels
function wav(channels, sr) {
  const ch = channels.length, n = channels[0].length, bytes = 44 + n * ch * 2, b = new ArrayBuffer(bytes), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(b);
}
// the lines between two indexes as one clip: start/end in seconds, with a short lead-in and fade
function clipRange(lines, a, b, pad) {
  pad = pad == null ? 0.25 : pad;
  const i = Math.min(a, b), j = Math.max(a, b);
  if (!lines[i] || !lines[j]) return null;
  return { start: Math.max(0, lines[i].start - pad), end: lines[j].end + pad, from: i, to: j };
}
function fade(ch, sr, sec) { const n = Math.min(Math.floor(sr * sec), Math.floor(ch.length / 2)); for (let i = 0; i < n; i++) { const g = i / n; ch[i] *= g; ch[ch.length - 1 - i] *= g; } return ch; }

// ---- library search ----
// items: [{id,name,lines:[{text}]}] -> [{id, hits, first}] best first
function search(items, q) {
  const w = String(q || '').trim().toLowerCase(); if (!w) return [];
  const out = [];
  for (const it of items || []) {
    let hits = 0, first = -1;
    const inName = String(it.name || '').toLowerCase().includes(w);
    (it.lines || []).forEach((c, i) => { const t = String(c.text || '').toLowerCase(); let k = t.indexOf(w); while (k >= 0) { hits++; if (first < 0) first = i; k = t.indexOf(w, k + w.length); } });
    if (hits || inName) out.push({ id: it.id, hits, first, name: inName });
  }
  return out.sort((x, y) => y.hits - x.hits || (y.name ? 1 : 0) - (x.name ? 1 : 0));
}
// find & replace in lines; returns {lines, count}
function replaceIn(lines, find, repl, matchCase) {
  if (!find) return { lines, count: 0 };
  const rx = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  let count = 0;
  const out = lines.map((c) => { const t = String(c.text).replace(rx, () => { count++; return repl; }); return t === c.text ? c : { ...c, text: t }; });
  return { lines: out, count };
}
// words and talk time per speaker
function stats(lines, n) {
  const st = Array.from({ length: Math.max(0, n || 0) }, () => ({ lines: 0, time: 0, words: 0 }));
  let words = 0, speech = 0;
  for (const c of lines || []) {
    const w = oneLine(c.text).split(/\s+/).filter(Boolean).length, d = Math.max(0, c.end - c.start);
    words += w; speech += d;
    if (c.spk != null && c.spk >= 0) { while (st.length <= c.spk) st.push({ lines: 0, time: 0, words: 0 }); const s = st[c.spk]; s.lines++; s.time += d; s.words += w; }
  }
  return { words, speech, wpm: speech > 30 ? Math.round(words / (speech / 60)) : 0, speakers: st };
}
// a file name without characters Windows/Mac do not allow
const safeName = (s, d) => (String(s || '').replace(/\.[a-z0-9]{2,4}$/i, '').normalize('NFC').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || d || 'transcript');

return { clock, esc, oneLine, spkName, redact, anyRedact, luhn, paragraphs, toText, toMarkdown, toCSV, toJSON, toHTMLDoc, toDocx, shareHtml, wav, clipRange, fade, search, replaceIn, stats, safeName, SPK_COL };
})();
if (typeof module !== 'undefined') module.exports = TP;
