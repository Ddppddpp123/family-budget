import pdfParse from 'pdf-parse';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const CATEGORIES = [
  'מכולת/סופר','מסעדות/קפה','מעדניות','ביטוח','תש\' רשויות','הלבשה','מוצרי חשמל','שונות','פארמה','נופש ותיור','מחשבים','דלק','תרבות','שירותי רכב','כלי בית','מכוני יופי','בתי ספר','שרות רפואי','שיווק ישיר','בניה/שיפוץ','העברת כספים','דלק, חשמל וגז'
];
const CITY_WORDS = new Set(['WARSZAWA','KRAKOW','PARIS','AMSTERDAM','BRZEZINKA','BALICE','LYON','SINGAPORE','KANDERSTEG','NEW','YORK','SEATTLE','LUXEMBOURG','LONDON','ROME','MILANO']);

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function norm(s='') {
  return String(s)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, ' ')
    .replace(/[־–—]/g, '-')
    .replace(/סהכ/g, 'סה"כ')
    .replace(/\s+/g, ' ')
    .trim();
}
function compactNumberParts(s) {
  return String(s || '')
    .replace(/[₪\s]/g, '')
    .replace(/,/g, '')
    .replace(/−/g, '-')
    .trim();
}
function amountFromText(s) {
  if (typeof s === 'number') return s;
  let raw = norm(s);
  raw = raw.replace(/₪\s*(-?)\s*([\d,]+)\s*\.\s*(\d{2})/, '$1$2.$3');
  const n = compactNumberParts(raw);
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function isDateToken(s) {
  return /^\d{1,2}[\/.]\d{1,2}[\/.](?:\d{2}|\d{4})$/.test(norm(s));
}
function isAmountToken(s) {
  return /^₪?\s*-?[\d,]+\.\d{2}$/.test(norm(s));
}
function toISO(date) {
  const p = String(date || '').split(/[\/.]/).map(Number);
  if (p.length < 3 || !p[0] || !p[1] || !p[2]) return '';
  let [d, m, y] = p;
  if (y < 100) y += 2000;
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function findCard(text, filename='') {
  const t = norm(text);
  const patterns = [
    /ספרות[^0-9]{0,25}(\d{4})/,
    /(\d{4})[^0-9]{0,25}ספרות/,
    /כרטיס\s+שמסתיים\s+בספרות\s*:?\s*(\d{4})/,
    /מאסטרקארד\s*(\d{4})/,
    /\*(\d{4})\*/
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[1];
  }
  const fm = String(filename || '').match(/(\d{4})/);
  return fm ? fm[1] : '';
}
function getInstallment(text) {
  const t = norm(text);
  let m = t.match(/תשלום\s*(\d+)\s*מתוך\s*(\d+)/);
  if (m) return `${m[1]} מתוך ${m[2]}`;
  m = t.match(/(\d+)\s*מתוך\s*(\d+)\s*תשלום/);
  if (m) return `${m[2]} מתוך ${m[1]}`;
  return '';
}
function sourceCategory(text) {
  const t = norm(text);
  for (const c of CATEGORIES) if (t.includes(c)) return c === "תש' רשויות" ? 'מסים' : c;
  if (/רשויות/.test(t)) return 'מסים';
  return '';
}
function stripKnownNoise(s) {
  let m = norm(s)
    .replace(/תש\s*\.?\s*נייד/g, ' ')
    .replace(/לא\s+הוצג/g, ' ')
    .replace(/ה\s*\.?\s*קבע/g, ' ')
    .replace(/\bא\b/g, ' ')
    .replace(/תשלום\s*\d+\s*מתוך\s*\d+/g, ' ')
    .replace(/\d+\s*מתוך\s*\d+\s*תשלום/g, ' ')
    .replace(/סכום\s+העסקה\s*-\s*[$€]\s*\d+(?:\.\d+)?/g, ' ')
    .replace(/[₪$€]/g, ' ')
    .replace(/[|:;,]+/g, ' ')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, ' ');
  for (const c of CATEGORIES) m = m.replaceAll(c, ' ');
  return norm(m).replace(/\s+\/\s+/g, '/').replace(/\s+"\s+/g, '"');
}
function rowHasBadText(text) {
  return /סה"כ|סה״כ|סך הכל|חיוב ב\s*:?|עסקאות במועד החיוב|פירוט החיובים|העסקאות שמוצגות|המידע המוצג|חשבון:|עמוד\s+\d|מסגרת הכרטיס|ריבית|פרוט פעולותיך|כרטיס שמסתיים|לכבוד|www\.|https?:|מקור חשבונית|הודעות|ביאורים|לינק|תאריך\s+עסקה|שם בית העסק|סכום\s+עסקה|ת\.עסקה|עסקות וחיובים|רוצה להיות|שכחת|CASH|לתשומת|שער המרה|עמלה ברוטו|%עמלה|מע"מ/.test(text);
}
function joinMerchant(tokens) {
  const arr = (tokens || [])
    .filter(t => t && norm(t.s))
    .map(t => ({ x: Number(t.x || 0), s: norm(t.s) }))
    .filter(t => !isDateToken(t.s))
    .filter(t => !isAmountToken(t.s))
    .filter(t => !/^₪-?$/.test(t.s))
    .filter(t => !/^[.,]$/.test(t.s))
    .filter(t => !['₪','$','€','PLN','CHF','USD','EUR','.',',','|',':'].includes(t.s))
    .filter(t => !CITY_WORDS.has(t.s.toUpperCase()));
  if (!arr.length) return '';
  const joined = arr.map(t => t.s).join('');
  const hasHebrew = /[\u0590-\u05ff]/.test(joined);
  const sorted = arr.sort((a,b) => (hasHebrew ? b.x - a.x : a.x - b.x));
  return stripKnownNoise(sorted.map(t => t.s).join(' '));
}
function textAmountMatches(text) {
  const out = [];
  const t = norm(text);
  let m;
  const re1 = /₪\s*(-?)\s*([\d,]+)\s*\.\s*(\d{2})/g;
  while ((m = re1.exec(t))) out.push({ s: `${m[1] || ''}${m[2]}.${m[3]}`, x: 0 });
  const re2 = /(?<![\d])(-?[\d,]+\.\d{2})(?![\d])/g;
  while ((m = re2.exec(t))) out.push({ s: m[1], x: 0 });
  return out;
}
function moneyFromTokens(tokens=[]) {
  const out = [];
  for (let i=0; i<tokens.length; i++) {
    const s = norm(tokens[i].s);
    if (isAmountToken(s)) {
      const prev = i > 0 ? norm(tokens[i-1].s) : '';
      const sign = prev.includes('₪-') && !String(s).startsWith('-') ? '-' : '';
      out.push({ s: sign + compactNumberParts(s), x: tokens[i].x });
      continue;
    }
    if (/^₪-?$/.test(s) || s === '₪') {
      let sign = s.includes('-') ? '-' : '';
      let main = '';
      let cents = '';
      let seenDot = false;
      for (let j=i+1; j<Math.min(tokens.length, i+6); j++) {
        const p = norm(tokens[j].s);
        if (/^-?[\d,]+$/.test(p) && !seenDot) {
          if (p.startsWith('-')) { sign = '-'; main = p.slice(1); }
          else main += p;
        } else if (p === '.') {
          seenDot = true;
        } else if (/^\d{2}$/.test(p) && seenDot) {
          cents = p;
          break;
        } else if (main) {
          break;
        }
      }
      if (main && cents) out.push({ s: `${sign}${main}.${cents}`, x: tokens[i].x });
    }
  }
  const by = new Set();
  return out.filter(a => { const k = `${a.x}|${a.s}`; if (by.has(k)) return false; by.add(k); return true; });
}
function findAmounts(rowOrText) {
  if (typeof rowOrText === 'string') return textAmountMatches(rowOrText);
  const fromTokens = moneyFromTokens(rowOrText.tokens || []);
  const fromText = textAmountMatches(rowOrText.text || '').map(x => ({ ...x, x: x.x || 0 }));
  return fromTokens.length ? fromTokens : fromText;
}
function makeTx({ date, merchant, amount, card, sourceCategory='', installment='', raw='', issuer='' }) {
  return { date: toISO(date), merchant: stripKnownNoise(merchant), amount: amountFromText(amount), card: card || '', sourceCategory, installment: installment || '', raw, issuer };
}
function dedupe(list) {
  const out = [];
  for (const t of list) {
    if (!t.date || !t.merchant || !Number.isFinite(t.amount) || Number(t.amount) === 0) continue;
    if (/^(רגילה|ביטול עסקה|פריקה|חיוב|pdf|₪)$/.test(t.merchant)) continue;
    if (/סה"כ|סה״כ|עמוד|פירוט|עסקאות במועד|מסגרת/.test(t.merchant)) continue;
    if (Math.abs(t.amount) > 200000) continue;
    out.push(t);
  }
  return out;
}
function amountTokenIn(row, min, max) {
  const c = findAmounts(row).filter(t => Number(t.x || 0) >= min && Number(t.x || 0) <= max);
  return c[0] || null;
}
function merchantFromBand(row, min, max) {
  return joinMerchant((row.tokens || []).filter(t => Number(t.x || 0) >= min && Number(t.x || 0) <= max));
}
function parseCalRows(rows, text, filename) {
  const card = findCard(text, filename);
  const out = [];
  let pendingMerchant = null;
  for (let i=0; i<rows.length; i++) {
    const r = rows[i];
    const rowText = norm(r.text);
    if (rowHasBadText(rowText) || /עסקאות לחיוב|פירוט עסקאות|חשבון:/.test(rowText)) continue;
    const dates = (r.tokens || []).filter(t => isDateToken(t.s));
    const amounts = findAmounts(r);
    const hasOnlyMerchant = !dates.length && !amounts.length && (r.tokens || []).some(t => Number(t.x||0) > 320 && /[\u0590-\u05ffA-Za-z]/.test(t.s));
    if (hasOnlyMerchant) { pendingMerchant = r; continue; }
    if (!dates.length && !amounts.length) continue;
    let date = dates[dates.length - 1]?.s || '';
    let amount = amounts[0]?.s || '';
    let installment = getInstallment(rowText);
    let merchant = merchantFromBand(r, 300, 520);
    let raw = rowText;

    if (date && !amount) {
      for (let j=i+1; j<Math.min(rows.length, i+4); j++) {
        const n = rows[j];
        if (rowHasBadText(n.text)) continue;
        const na = findAmounts(n);
        if (!na.length) continue;
        amount = na[0].s;
        installment = installment || getInstallment(n.text);
        const nm = merchantFromBand(n, 300, 520);
        if (!merchant || /^(תשלום|מתוך)$/.test(merchant)) merchant = nm;
        raw += ' ' + norm(n.text);
        break;
      }
    }
    if (!date && amounts.length) {
      const d = (r.tokens || []).filter(t => isDateToken(t.s));
      date = d[d.length-1]?.s || '';
    }
    if ((!merchant || merchant.length < 2) && pendingMerchant) {
      merchant = merchantFromBand(pendingMerchant, 300, 520);
      raw = norm(pendingMerchant.text) + ' ' + raw;
      pendingMerchant = null;
    }
    if (!date || !amount || !merchant) continue;
    out.push(makeTx({ date, merchant, amount, card, sourceCategory: sourceCategory(raw), installment, raw, issuer:'כאל' }));
  }
  return dedupe(out);
}
function parseMaxRows(rows, text, filename) {
  const card = findCard(text, filename);
  const out = [];
  for (let i=0; i<rows.length; i++) {
    const r = rows[i];
    const rowText = norm(r.text);
    if (rowHasBadText(rowText)) continue;
    const dates = (r.tokens || []).filter(t => isDateToken(t.s));
    const amounts = findAmounts(r);
    if (!dates.length || !amounts.length) continue;
    const date = dates[dates.length-1].s;
    const amountTok = amountTokenIn(r, 60, 190) || amounts[0];
    let merchantTokens = (r.tokens || []).filter(t => t.x >= 500 && t.x <= 670);
    const next = rows[i+1];
    if (next && !(next.tokens || []).some(t => isDateToken(t.s)) && Math.abs((next.y||0)-(r.y||0)) < 42) {
      merchantTokens = merchantTokens.concat((next.tokens || []).filter(t => t.x >= 500 && t.x <= 670));
    }
    const merchant = joinMerchant(merchantTokens);
    const catTokens = (r.tokens || []).filter(t => t.x >= 390 && t.x <= 490);
    const src = sourceCategory(catTokens.map(t=>t.s).join(' ') || rowText);
    out.push(makeTx({ date, merchant, amount: amountTok.s, card, sourceCategory: src, installment: getInstallment(rowText), raw: rowText, issuer:'MAX' }));
  }
  return dedupe(out);
}
function parseIsracardRows(rows, text, filename) {
  const card = findCard(text, filename);
  const out = [];
  for (const r of rows) {
    const rowText = norm(r.text);
    if (rowHasBadText(rowText)) continue;
    const toks = r.tokens || [];
    const dates = toks.filter(t => isDateToken(t.s));
    const amounts = findAmounts(r);
    if (!dates.length || !amounts.length) continue;
    const date = dates[dates.length-1].s;
    const isForeign = toks.some(t => ['$', '€', 'PLN', 'CHF', 'USD', 'EUR'].includes(t.s) || CITY_WORDS.has(String(t.s).toUpperCase())) || /\$|€|PLN|CHF/.test(rowText);
    let amountTok = null;
    if (isForeign) amountTok = amountTokenIn(r, 100, 210);
    if (!amountTok) amountTok = amountTokenIn(r, 215, 290);
    if (!amountTok) amountTok = amounts[0];
    const merchantTokens = toks.filter(t => t.x >= (isForeign ? 365 : 340) && t.x <= 500);
    const merchant = joinMerchant(merchantTokens);
    const src = sourceCategory(rowText);
    out.push(makeTx({ date, merchant, amount: amountTok.s, card, sourceCategory: src, installment: getInstallment(rowText), raw: rowText, issuer:'ישראכרט' }));
  }
  return dedupe(out);
}
function parseGenericRows(rows, text, filename) {
  const card = findCard(text, filename);
  const out = [];
  for (const r of rows) {
    const dates = (r.tokens || []).filter(t => isDateToken(t.s));
    const amounts = findAmounts(r);
    if (!dates.length || !amounts.length || rowHasBadText(r.text)) continue;
    const date = dates[dates.length-1].s;
    const amountTok = amounts[0];
    const merchant = joinMerchant((r.tokens || []).filter(t => t.x > 180 && t.x < 520));
    out.push(makeTx({ date, merchant, amount: amountTok.s, card, sourceCategory: sourceCategory(r.text), installment:getInstallment(r.text), raw:r.text, issuer:'כללי' }));
  }
  return dedupe(out);
}
function parseRows(rows, text, filename) {
  const lower = `${text} ${filename}`.toLowerCase();
  if (/max|עסקאות במועד החיוב|פירוט החיובים/.test(lower)) return parseMaxRows(rows, text, filename);
  if (/פירוט עסקאות וחיובים לכרטיס|digital-web\.cal|כאל|מאסטרקארד/.test(lower)) return parseCalRows(rows, text, filename);
  if (/ישראכרט|isracard|עסקות שחויבו|רכישות בחו/.test(lower)) return parseIsracardRows(rows, text, filename);
  return parseGenericRows(rows, text, filename);
}
function extractCardTotals(rows, text, filename, transactions) {
  const card = findCard(text, filename) || (transactions[0] && transactions[0].card) || '';
  if (!card) return {};
  const allText = norm([text, ...rows.map(r=>r.text)].join('\n'));
  let total = null;
  const lower = `${allText} ${filename}`.toLowerCase();
  if (/פירוט עסקאות וחיובים לכרטיס|digital-web\.cal|מאסטרקארד/.test(lower)) {
    const line = rows.find(r => /עסקאות לחיוב/.test(r.text));
    const a = line ? findAmounts(line)[0] : null;
    if (a) total = amountFromText(a.s);
  } else if (/max|עסקאות במועד החיוב|פירוט החיובים/.test(lower)) {
    const line = rows.find(r => /סה"כ|סה״כ/.test(r.text) && findAmounts(r).length);
    const a = line ? findAmounts(line)[0] : null;
    if (a) total = amountFromText(a.s);
  } else if (/ישראכרט|isracard|עסקות שחויבו|רכישות בחו/.test(lower)) {
    const monthly = rows.find(r => /(סה\"כ|סה״כ).{0,80}לחיוב החודש בכרטיס|לחיוב החודש בכרטיס.{0,80}(סה\"כ|סה״כ)/.test(r.text) && findAmounts(r).length);
    if (monthly) total = amountFromText(findAmounts(monthly)[0].s);
    else {
      const parts = rows.filter(r => /(סה\"כ|סה״כ).{0,80}חיוב.{0,80}לתאריך|לתאריך.{0,80}חיוב.{0,80}(סה\"כ|סה״כ)/.test(r.text) && findAmounts(r).length).map(r => amountFromText(findAmounts(r)[0].s));
      if (parts.length) total = parts.reduce((a,b)=>a+b,0);
    }
  }
  if (total == null || !Number.isFinite(total)) return {};
  return { [card]: Math.round(total * 100) / 100 };
}
async function renderPage(pageData) {
  const tc = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const groups = new Map();
  for (const it of tc.items) {
    const s = norm(it.str);
    if (!s) continue;
    const x = Number(it.transform[4] || 0);
    const y = Math.round(Number(it.transform[5] || 0));
    const key = String(y);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ x, s });
  }
  const rows = [...groups.entries()]
    .map(([y,tokens]) => ({ y:Number(y), tokens:tokens.sort((a,b)=>a.x-b.x), text:tokens.sort((a,b)=>a.x-b.x).map(t=>t.s).join(' ') }))
    .sort((a,b)=>b.y-a.y);
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n';
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const filename = body.filename || 'file.pdf';
    const base64 = String(body.base64 || body.data || '').replace(/^data:application\/pdf;base64,/, '');
    if (!base64) throw new Error('Missing PDF base64');
    const buffer = Buffer.from(base64, 'base64');
    const parsed = await pdfParse(buffer, { pagerender: renderPage, max: 0 });
    const lines = String(parsed.text || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
    const rows = [];
    const textLines = [];
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r && r.tokens && r.text) { rows.push(r); textLines.push(r.text); }
      } catch { textLines.push(line); }
    }
    const text = textLines.join('\n');
    const transactions = parseRows(rows, text, filename);
    const cardTotals = extractCardTotals(rows, text, filename, transactions);
    const byCard = transactions.reduce((a,t)=>{a[t.card||'ללא כרטיס']=(a[t.card||'ללא כרטיס']||0)+1; return a;}, {});
    const sum = transactions.reduce((a,t)=>a+Number(t.amount||0),0);
    return json(res, 200, { ok:true, filename, transactions, diagnostics:{ rows:rows.length, count:transactions.length, byCard, sum, cardTotals } });
  } catch (error) {
    return json(res, 500, { ok:false, error:error.message || String(error) });
  }
}
