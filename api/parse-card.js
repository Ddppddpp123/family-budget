import pdfParse from 'pdf-parse';

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const CATEGORIES = [
  'מכולת/סופר','מסעדות/קפה','מעדניות','ביטוח','תש\' רשויות','הלבשה','מוצרי חשמל','שונות','פארמה','נופש ותיור','מחשבים','דלק','תרבות','שירותי רכב','כלי בית','מכוני יופי','בתי ספר','שרות רפואי','שיווק ישיר','בניה/שיפוץ','העברת כספים','דלק, חשמל וגז'
];
const CITY_WORDS = new Set(['WARSZAWA','KRAKOW','PARIS','AMSTERDAM','BRZEZINKA','BALICE','LYON','SINGAPORE','KANDERSTEG','NEW','YORK','SEATTLE','LUXEMBOURG','LONDON','ROME','MILANO']);

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function norm(s='') {
  return String(s).replace(/[\u200e\u200f]/g, ' ').replace(/[־–—]/g, '-').replace(/\s+/g, ' ').trim();
}
function amountFromText(s) {
  if (typeof s === 'number') return s;
  const n = String(s || '').replace(/[₪,\s]/g, '').replace(/[\u200e\u200f]/g, '');
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function isAmountToken(s) {
  return /^₪?\s*-?[\d,]+\.\d{2}$/.test(norm(s));
}
function isDateToken(s) {
  return /^\d{1,2}[\/.]\d{1,2}[\/.](?:\d{2}|\d{4})$/.test(norm(s));
}
function toISO(date) {
  const p = String(date || '').split(/[\/.]/).map(Number);
  if (p.length < 3 || !p[0] || !p[1] || !p[2]) return '';
  let [d, m, y] = p;
  if (y < 100) y += 2000;
  return `${y.toString().padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function findCard(text, filename='') {
  const t = norm(text);
  const m = t.match(/כרטיס\s+שמסתיים\s+בספרות\s*:?\s*(\d{4})/) ||
            t.match(/כרטיס[^\n]{0,60}בספרות\s*:?\s*(\d{4})/) ||
            t.match(/מאסטרקארד\s*(\d{4})/) ||
            t.match(/\*(\d{4})\*/) ||
            String(filename || '').match(/(\d{4})/);
  return m ? m[1] : '';
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
function joinMerchant(tokens) {
  const arr = tokens.filter(t => t && norm(t.s)).map(t => ({ x: t.x, s: norm(t.s) }))
    .filter(t => !isDateToken(t.s) && !isAmountToken(t.s))
    .filter(t => !['₪','$','€','PLN','CHF','USD','EUR','.',',','|',':'].includes(t.s))
    .filter(t => !CITY_WORDS.has(t.s.toUpperCase()));
  if (!arr.length) return '';
  const joined = arr.map(t => t.s).join('');
  const hasHebrew = /[\u0590-\u05ff]/.test(joined);
  const hasLatin = /[A-Za-z]/.test(joined);
  const sorted = arr.sort((a,b) => (hasHebrew ? b.x - a.x : a.x - b.x));
  return stripKnownNoise(sorted.map(t => t.s).join(' '));
}
function rowHasBadText(text) {
  return /סה"כ|סה״כ|סך הכל|חיוב ב\s*:?|עסקאות במועד החיוב|פירוט החיובים|העסקאות שמוצגות|המידע המוצג|חשבון:|עמוד\s+\d|מסגרת הכרטיס|ריבית|פרוט פעולותיך|כרטיס שמסתיים|לכבוד|www\.|https?:|מקור חשבונית|הודעות|ביאורים|לינק|תאריך\s+עסקה|שם בית העסק|סכום\s+עסקה|ת\.עסקה|עסקות וחיובים|רוצה להיות|שכחת|CASH|לתשומת|שער המרה|עמלה ברוטו|%עמלה|מע"מ/.test(text);
}
function makeTx({ date, merchant, amount, card, sourceCategory='', installment='', raw='', issuer='' }) {
  return { date: toISO(date), merchant: stripKnownNoise(merchant), amount: amountFromText(amount), card: card || '', sourceCategory, installment: installment || '', raw, issuer };
}
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (!t.date || !t.merchant || !Number.isFinite(t.amount)) continue;
    if (/^(רגילה|ביטול עסקה|פריקה|חיוב|pdf|₪)$/.test(t.merchant)) continue;
    if (/סה"כ|סה״כ|עמוד|פירוט|עסקאות במועד|מסגרת/.test(t.merchant)) continue;
    if (Math.abs(t.amount) > 200000) continue;
    const k = [t.card, t.date, t.merchant.toLowerCase(), Number(t.amount).toFixed(2)].join('|');
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}
function amountTokenIn(tokens, min, max) {
  const c = tokens.filter(t => t.x >= min && t.x <= max && isAmountToken(t.s));
  return c[0] || null;
}
function parseIsracardRows(rows, text, filename) {
  const card = findCard(text, filename);
  const out = [];
  for (const r of rows) {
    const rowText = norm(r.text);
    if (rowHasBadText(rowText)) continue;
    const toks = r.tokens || [];
    const dates = toks.filter(t => isDateToken(t.s));
    const amounts = toks.filter(t => isAmountToken(t.s));
    if (!dates.length || !amounts.length) continue;
    const date = dates.sort((a,b)=>b.x-a.x)[0].s;
    const isForeign = toks.some(t => ['$', '€', 'PLN', 'CHF', 'USD', 'EUR'].includes(t.s) || CITY_WORDS.has(String(t.s).toUpperCase())) || /\$|€|PLN|CHF/.test(rowText);
    let amountTok = null;
    if (isForeign) amountTok = amountTokenIn(toks, 130, 190) || amountTokenIn(toks, 145, 210);
    if (!amountTok) amountTok = amountTokenIn(toks, 215, 270) || amountTokenIn(toks, 220, 285);
    if (!amountTok) amountTok = amounts.sort((a,b)=>a.x-b.x)[0];
    const merchantTokens = toks.filter(t => t.x >= (isForeign ? 375 : 350) && t.x <= 480);
    const merchant = joinMerchant(merchantTokens);
    const src = sourceCategory(rowText);
    out.push(makeTx({ date, merchant, amount: amountTok.s, card, sourceCategory: src, installment: getInstallment(rowText), raw: rowText, issuer:'ישראכרט' }));
  }
  return dedupe(out);
}
function parseCalRows(rows, text, filename) {
  const card = findCard(text, filename);
  const out = [];
  for (const r of rows) {
    const rowText = norm(r.text);
    if (rowHasBadText(rowText) || /עסקאות לחיוב|פירוט עסקאות|חשבון:/.test(rowText)) continue;
    const toks = r.tokens || [];
    const dates = toks.filter(t => isDateToken(t.s));
    const amounts = toks.filter(t => isAmountToken(t.s));
    if (!dates.length || !amounts.length) continue;
    const date = dates.sort((a,b)=>b.x-a.x)[0].s;
    const amountTok = amountTokenIn(toks, 60, 130) || amounts.sort((a,b)=>a.x-b.x)[0];
    let merchantTokens = toks.filter(t => t.x >= 330 && t.x <= 470);
    // Include left-side English merchant such as MOUCHES/BATEAUX when the row has currency detail.
    if (!merchantTokens.length || merchantTokens.every(t => /סכום|עסקה|-|[$€]/.test(t.s))) {
      merchantTokens = toks.filter(t => t.x >= 320 && t.x <= 470);
    }
    let merchant = joinMerchant(merchantTokens);
    // Remove technical currency detail words that sometimes sit in the merchant band.
    merchant = merchant.replace(/סכום העסקה/g,'').replace(/[$€]\s*\d+(?:\.\d+)?/g,'').trim();
    out.push(makeTx({ date, merchant, amount: amountTok.s, card, sourceCategory: sourceCategory(rowText), installment: getInstallment(rowText), raw: rowText, issuer:'כאל' }));
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
    const toks = r.tokens || [];
    const dates = toks.filter(t => isDateToken(t.s));
    const amounts = toks.filter(t => isAmountToken(t.s));
    if (!dates.length || !amounts.length) continue;
    const date = dates.sort((a,b)=>b.x-a.x)[0].s;
    const amountTok = amountTokenIn(toks, 90, 180) || amounts.sort((a,b)=>a.x-b.x)[0];
    let merchantTokens = toks.filter(t => t.x >= 500 && t.x <= 650);
    // Continuation under merchant, e.g. "הטבות" below "טעינת כרטיס".
    const next = rows[i+1];
    if (next && !(next.tokens || []).some(t => isDateToken(t.s)) && Math.abs((next.y||0)-(r.y||0)) < 42) {
      merchantTokens = merchantTokens.concat((next.tokens || []).filter(t => t.x >= 500 && t.x <= 650));
    }
    const merchant = joinMerchant(merchantTokens);
    const catTokens = toks.filter(t => t.x >= 390 && t.x <= 470);
    const src = sourceCategory(catTokens.map(t=>t.s).join(' ') || rowText);
    out.push(makeTx({ date, merchant, amount: amountTok.s, card, sourceCategory: src, installment: getInstallment(rowText), raw: rowText, issuer:'MAX' }));
  }
  return dedupe(out);
}
function parseGenericRows(rows, text, filename) {
  const card = findCard(text, filename);
  const out = [];
  for (const r of rows) {
    const toks = r.tokens || [];
    const dates = toks.filter(t => isDateToken(t.s));
    const amounts = toks.filter(t => isAmountToken(t.s));
    if (!dates.length || !amounts.length || rowHasBadText(r.text)) continue;
    const date = dates.sort((a,b)=>b.x-a.x)[0].s;
    const amountTok = amounts.sort((a,b)=>a.x-b.x)[0];
    const merchant = joinMerchant(toks.filter(t => t.x > 180 && t.x < 520));
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
    const byCard = transactions.reduce((a,t)=>{a[t.card||'ללא כרטיס']=(a[t.card||'ללא כרטיס']||0)+1; return a;}, {});
    const sum = transactions.reduce((a,t)=>a+Number(t.amount||0),0);
    return json(res, 200, { ok:true, filename, transactions, diagnostics:{ rows:rows.length, count:transactions.length, byCard, sum } });
  } catch (error) {
    return json(res, 500, { ok:false, error:error.message || String(error) });
  }
}
