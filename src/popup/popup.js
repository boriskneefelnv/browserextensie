/*
 * Zijpaneel: overzicht van acties → klik → invulscherm van die actie.
 */
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let tabId = null;
let info = null;
let startedAt = 0;
let view = null; // null = overzicht, anders macroId

function showError(text) {
  $('error').querySelector('.msg-text').textContent = text;
  $('error').hidden = !text;
}

let dismissedRun = null; // tijdstip van de weggeklikte resultaatmelding

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

// ---------------------------------------------------------------- invoervelden

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

function monthText(v) {
  const m = v.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : v;
}

// ---- snelle invoer: datum "11" → 11-<deze maand>-<dit jaar>, tijd "8" → 08:00

const pad2 = (n) => String(n).padStart(2, '0');

/** Geeft dd-mm-jjjj terug, '' bij leeg, of null als het geen geldige datum is. */
function normalizeDate(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const now = new Date();
  let d, m = now.getMonth() + 1, y = now.getFullYear(), r;
  if ((r = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = r.map(Number);
  else if ((r = v.match(/^(\d{1,2})$/))) d = Number(r[1]);
  else if ((r = v.match(/^(\d{1,2})[-./ ](\d{1,2})$/))) [d, m] = [Number(r[1]), Number(r[2])];
  else if ((r = v.match(/^(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{2}|\d{4})$/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = v.match(/^(\d{2})(\d{2})$/))) [d, m] = [Number(r[1]), Number(r[2])];
  else if ((r = v.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${pad2(d)}-${pad2(m)}-${y}`;
}

/** Geeft uu:mm terug, '' bij leeg, of null als het geen geldige tijd is. */
function normalizeTime(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  let h, min = 0, r;
  if ((r = v.match(/^(\d{1,2})$/))) h = Number(r[1]);
  else if ((r = v.match(/^(\d{1,2})[:.,;h ](\d{1,2})$/))) [h, min] = [Number(r[1]), Number(r[2])];
  else if ((r = v.match(/^(\d{1,2})(\d{2})$/))) [h, min] = [Number(r[1]), Number(r[2])];
  else return null;
  if (h > 23 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

function normalizeInput(input) {
  const t = input.dataset.type;
  if (t !== 'date' && t !== 'time') return true;
  const n = (t === 'date' ? normalizeDate : normalizeTime)(input.value);
  if (n === null) {
    input.classList.add('missing');
    input.title = t === 'date' ? 'Geen geldige datum (bijv. 11, 11-12 of 11-12-2026)' : 'Geen geldige tijd (bijv. 8, 17 of 8:30)';
    return false;
  }
  input.value = n;
  input.title = input.dataset.label;
  return true;
}

function makeInput(m, inp) {
  const type = BA.INPUT_TYPES[inp.type] ? inp.type : 'text';
  const smart = type === 'date' || type === 'time';
  const input = el('input', {
    type: smart ? 'text' : type,
    class: smart ? 'smart-' + type : null,
    id: `in-${m.id}-${inp.name}`,
    'data-name': inp.name,
    'data-type': type,
    'data-label': inp.label || inp.name,
    'data-required': inp.required ? '1' : null,
    'data-required-unless': inp.requiredUnless || null,
    title: inp.label || inp.name,
    placeholder: type === 'date' ? 'dd-mm-jjjj' : type === 'time' ? (inp.placeholder || 'uu:mm') : type === 'text' ? inp.placeholder || '' : null,
    inputmode: smart ? 'numeric' : null,
    autocomplete: 'off',
  });
  input.value = BA.fillTemplate(inp.default || '', BA.builtinVars());
  if (smart) {
    input.addEventListener('blur', () => normalizeInput(input));
    input.addEventListener('change', () => normalizeInput(input));
  }
  return input;
}

/** Velden per sectie (kader) en per regel; velden met dezelfde "row" komen naast elkaar. */
function renderFields(m) {
  const sets = [];
  let set = null;
  let row = null;
  for (const inp of m.inputs.filter((i) => i.name)) {
    const section = inp.section || '';
    if (!set || set.section !== section) {
      set = { section, node: el('fieldset', {}, section ? el('legend', {}, section) : null) };
      sets.push(set);
      row = null;
    }
    const input = makeInput(m, inp);
    if (row && inp.row && row.key === inp.row) {
      row.fields.append(input);
      continue;
    }
    const fields = el('div', { class: 'fields' }, input);
    const label = inp.rowLabel || inp.label || inp.name;
    set.node.append(el('div', { class: 'frow' },
      el('label', { for: input.id, title: label }, label, inp.required ? el('span', { class: 'req' }, ' *') : null),
      fields));
    row = { key: inp.row || null, fields };
  }
  return sets.map((s) => s.node);
}

function collectVars(box) {
  const vars = {};
  const months = [];
  for (const input of box.querySelectorAll('input[data-name]')) {
    if (!normalizeInput(input)) {
      input.focus();
      throw new Error(`"${input.dataset.label}" is geen geldige ${input.dataset.type === 'date' ? 'datum' : 'tijd'}.`);
    }
    const v = input.value.trim();
    if (input.dataset.required && !v) {
      input.classList.add('missing');
      input.focus();
      throw new Error(`Vul "${input.dataset.label}" in.`);
    }
    vars[input.dataset.name] = v;
    if (input.dataset.type === 'month' && v) months.push({ label: input.dataset.label, v });
  }
  // Verplicht, tenzij een ander veld is ingevuld (bijv. Ontvanger leeg mag als er adresgegevens zijn)
  for (const input of box.querySelectorAll('input[data-required-unless]')) {
    if (!input.value.trim() && !vars[input.dataset.requiredUnless]) {
      input.classList.add('missing');
      input.focus();
      throw new Error(`Vul "${input.dataset.label}" in, of de gegevens voor een nieuw adres.`);
    }
  }
  if (box.dataset.klantnummer) vars.klantnummer = box.dataset.klantnummer;
  for (let i = 1; i < months.length; i++) {
    if (months[i].v < months[i - 1].v) throw new Error(`"${months[i].label}" ligt vóór "${months[i - 1].label}".`);
  }
  return vars;
}

// ---------------------------------------------------------------- paklijst (PDF)

const PDF_BASE = chrome.runtime.getURL('src/lib/pdfjs/');

async function readPdf(file, box, m, status) {
  status.className = 'pdfstatus';
  status.textContent = `"${file.name}" lezen…`;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const { text, lines } = await BAPdf.extract(data, PDF_BASE);
    const { ontvangerCodes = {} } = await chrome.storage.local.get('ontvangerCodes');
    const { klant, waarden } = BAParsers.parse(text, lines, ontvangerCodes, file.name);
    if (!klant) {
      status.className = 'pdfstatus fail';
      status.textContent = `✖ Klant niet herkend in "${file.name}". Deze klant is nog niet ingesteld.`;
      return;
    }
    // Velden uit de paklijst (opnieuw) vullen; datums/tijden die je al had ingevuld blijven staan.
    for (const inp of m.inputs) {
      const input = box.querySelector(`input[data-name="${inp.name}"]`);
      if (!input) continue;
      if (Object.prototype.hasOwnProperty.call(waarden, inp.name)) {
        // datums uit de pakbon (bijv. leverdatum) alleen invullen als er iets gevonden is
        if (!(['date', 'time'].includes(inp.type) && !waarden[inp.name])) input.value = waarden[inp.name] ?? '';
      }
      else if (!['date', 'time'].includes(inp.type)) input.value = BA.fillTemplate(inp.default || '', BA.builtinVars());
      input.classList.toggle('missing', !!inp.required && !input.value);
    }
    box.dataset.klantnummer = waarden.klantnummer || '';
    const ontbreekt = m.inputs.filter((i) => i.required && !['date', 'time'].includes(i.type) && !waarden[i.name]).map((i) => i.label);
    status.className = 'pdfstatus ok';
    status.textContent = `✔ ${klant.naam}${waarden.afnemer ? ' → ' + waarden.afnemer : ''}\n${file.name}` +
      (ontbreekt.length ? `\n⚠ Niet gevonden, vul zelf in: ${ontbreekt.join(', ')}` : '');
    [...box.querySelectorAll('input[data-required]')].find((i) => !i.value)?.focus();
  } catch (e) {
    status.className = 'pdfstatus fail';
    status.textContent = `✖ PDF lezen mislukt: ${e.message}`;
  }
}

function makePdfZone(m, getBox) {
  const file = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  const status = el('p', { class: 'pdfstatus' });
  const zone = el('div', { class: 'drop', tabindex: '0' }, '📄 Sleep de paklijst (PDF) hierheen', el('br'), el('span', {}, 'of klik om een bestand te kiezen'), file);
  zone.addEventListener('click', () => file.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') file.click(); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) readPdf(f, getBox(), m, status);
  });
  file.addEventListener('change', () => { if (file.files[0]) readPdf(file.files[0], getBox(), m, status); file.value = ''; });
  return [zone, status];
}

// ---------------------------------------------------------------- detailscherm van een actie

function renderDetail(m) {
  const backBtn = el('button', { class: 'tb', title: 'Terug naar het overzicht' }, el('span', { class: 'ico' }, '◂'), 'Terug');
  const runTop = el('button', { class: 'tb go' }, el('span', { class: 'ico' }, '▶'), 'Uitvoeren');
  const runBtn = el('button', { class: 'bj-btn primary' }, '▶ Uitvoeren');
  const summary = el('p', { class: 'summary' });
  const showSummary = false; // velden staan al overzichtelijk in het formulier
  let box = null;

  box = el('div', {},
    el('div', { class: 'tabkop' }, m.name),
    el('div', { class: 'sheet' },
      el('div', { class: 'toolbar' }, backBtn, runTop),
      m.description ? el('p', { class: 'desc' }, m.description) : null,
      m.pdf ? makePdfZone(m, () => box) : null,
      renderFields(m),
      showSummary ? summary : null,
      el('div', { class: 'actions' }, runBtn)
    )
  );

  const updateSummary = () => {
    if (!showSummary) return;
    summary.textContent = [...box.querySelectorAll('input[data-name]')].map((i) => {
      const v = i.value.trim();
      return `${i.dataset.label}: ${i.dataset.type === 'month' ? monthText(v) || '—' : v || '(leeg)'}`;
    }).join(' · ');
  };

  const run = async () => {
    let vars;
    try {
      vars = collectVars(box);
    } catch (e) {
      return showError(e.message);
    }
    showError('');
    // Ontvanger-code onthouden voor dit klantnummer (volgende keer automatisch ingevuld).
    if (box.dataset.klantnummer && vars.ontvanger) {
      const { ontvangerCodes = {} } = await chrome.storage.local.get('ontvangerCodes');
      ontvangerCodes[box.dataset.klantnummer] = vars.ontvanger.toUpperCase();
      await chrome.storage.local.set({ ontvangerCodes });
    }
    const res = await send({ type: 'runMacro', tabId, macroId: m.id, vars });
    if (!res?.ok) return showError(res?.error || 'Starten mislukt');
    startedAt = Date.now();
    setTimeout(refresh, 300);
  };

  backBtn.addEventListener('click', () => { view = null; showError(''); render(); });
  runTop.addEventListener('click', run);
  runBtn.addEventListener('click', run);
  box.querySelectorAll('input[data-name]').forEach((i) => {
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    i.addEventListener('input', () => { updateSummary(); i.classList.remove('missing'); });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') normalizeInput(i); }, true);
  });
  updateSummary();
  return { box, runBtns: [runTop, runBtn] };
}

// Detailschermen hergebruiken bij verversen, zodat ingevulde waarden niet verdwijnen.
const details = new Map(); // macroId -> { json, box, runBtns }

function detailFor(m) {
  const json = JSON.stringify(m);
  let d = details.get(m.id);
  if (!d || d.json !== json) {
    d = { json, ...renderDetail(m) };
    details.set(m.id, d);
  }
  for (const b of d.runBtns) b.disabled = !!info.running || !!info.recording;
  return d.box;
}

// ---------------------------------------------------------------- overzicht

function overviewItem(m, isOther) {
  const isRunning = info.running === m.id;
  const tag = isRunning ? el('span', { class: 'tag run' }, 'bezig')
    : m.pdf ? el('span', { class: 'tag' }, 'PDF')
      : m.triggers.some((t) => t.enabled !== false && t.selector) ? el('span', { class: 'tag' }, 'auto') : null;
  return el('a', { class: 'item' + (isOther ? ' other' : ''), tabindex: '0', onclick: () => openMacro(m.id), onkeydown: (e) => { if (e.key === "Enter") openMacro(m.id); } },
    el('span', { class: 'bullet' }),
    el('span', {}, el('span', { class: 'name' }, m.name), m.description ? el('span', { class: 'sub' }, m.description) : null),
    tag);
}

function openMacro(id) {
  view = id;
  showError('');
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (!info) return;
  const macro = view ? info.macros.find((m) => m.id === view) : null;
  if (view && !macro) view = null;

  $('overview').hidden = !!macro;
  $('detail').hidden = !macro;

  if (macro) {
    const box = detailFor(macro);
    if ($('detail').firstChild !== box) $('detail').replaceChildren(box);
  } else {
    const list = $('macroList');
    const matching = info.macros.filter((m) => info.matching.includes(m.id));
    const others = info.macros.filter((m) => !info.matching.includes(m.id));
    const items = matching.map((m) => overviewItem(m, false));
    if ($('showAll').checked) items.push(...others.map((m) => overviewItem(m, true)));
    if (!items.length) {
      items.push(el('p', { class: 'empty' }, info.macros.length
        ? 'Geen acties voor deze pagina.'
        : 'Nog geen acties. Neem er een op via "Extra".'));
    }
    list.replaceChildren(...items);
  }

  const running = info.running ? info.macros.find((m) => m.id === info.running) : null;
  $('runningBox').hidden = !running;
  if (running) {
    $('runningName').textContent = running.name;
    $('runningStep').textContent = info.progress || 'starten…';
  }

  // Resultaat van de laatste uitvoering (< 2 min geleden).
  const last = info.lastRun;
  const recent = last && last.time !== dismissedRun && Date.now() - new Date(last.time).getTime() < 2 * 60 * 1000;
  $('lastRun').hidden = !!running || !recent;
  if (!running && recent) {
    $('lastRun').className = 'msg ' + (last.ok ? 'ok' : 'fail');
    $('lastRun').querySelector('.msg-text').textContent = last.ok ? `✔ "${last.macro}" is uitgevoerd.` : `✖ "${last.macro}" mislukt — ${last.error}`;
  }
  $('traceBar').hidden = !!running || !recent || last.ok || !(last.trace && last.trace.length);

  $('recActive').hidden = !info.recording;
  $('diagActive').hidden = !info.diag;
  if (info.diag) $('diagCount').textContent = info.diag.count;
  renderDiagReport();
  $('recElsewhere').hidden = !info.recordingElsewhere;
  if (info.recording) $('recCount').textContent = info.recording.count;

  if (info.lastPicked && Date.now() - info.lastPicked.time < 10 * 60 * 1000) {
    $('picked').hidden = false;
    $('picked').textContent = `Laatst gekozen: ${info.lastPicked.selector}` + (info.lastPicked.frame ? `  (frame: ${info.lastPicked.frame})` : '');
  }
}

async function refresh() {
  info = await send({ type: 'getPageInfo', tabId });
  render();
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function init() {
  tabId = await currentTab();
  // Zijpaneel: meebewegen met het actieve tabblad en met navigatie.
  chrome.tabs.onActivated.addListener(async () => { tabId = await currentTab(); refresh(); });
  chrome.tabs.onUpdated.addListener((id, change) => { if (id === tabId && change.status === 'complete') refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.macros || changes.log)) refresh(); });
  ({ dismissedRun = null } = await chrome.storage.session.get('dismissedRun'));
  const { popupShowAll } = await chrome.storage.local.get('popupShowAll');
  $('showAll').checked = !!popupShowAll;
  await refresh();
  await loadDiagReport();
  setInterval(() => { if (info?.recording || info?.running || info?.diag || Date.now() - startedAt < 3000) refresh(); }, 500);
}

$('error').querySelector('.msg-close').addEventListener('click', () => showError(''));
$('lastRun').querySelector('.msg-close').addEventListener('click', () => {
  dismissedRun = info?.lastRun?.time || null;
  chrome.storage.session.set({ dismissedRun });
  $('lastRun').hidden = true;
  $('traceBar').hidden = true;
});

function traceText(e) {
  const vars = Object.entries(e.vars || {}).map(([k, v]) => `${k}=${v}`).join(', ');
  return [`Neele-Vat BluJay Assistent ${chrome.runtime.getManifest().version} — "${e.macro}" ${e.ok ? 'gelukt' : 'mislukt'} (${new Date(e.time).toLocaleString('nl-NL')})`,
    e.error ? `Fout: ${e.error}` : '', `Invoer: ${vars}`, '', ...(e.trace || [])].filter((l, i) => l || i > 2).join('\n');
}

$('copyTrace').addEventListener('click', async () => {
  if (!info?.lastRun) return;
  await navigator.clipboard.writeText(traceText(info.lastRun));
  $('copied').textContent = '✔ Gekopieerd — plak het in de chat';
  setTimeout(() => { $('copied').textContent = ''; }, 4000);
});

$('dumpScreen').addEventListener('click', async () => {
  const r = await send({ type: 'dumpScreen', tabId });
  if (!r?.text) return showError('Kon de schermopbouw niet lezen (ververs BluJay en probeer opnieuw).');
  await navigator.clipboard.writeText(r.text);
  showError('');
  $('lastRun').className = 'msg ok';
  $('lastRun').querySelector('.msg-text').textContent = '✔ Schermopbouw gekopieerd — plak het in de chat.';
  $('lastRun').hidden = false;
});

// ---------------------------------------------------------------- nauwkeurige opname

let diagReportInfo = null;
let diagReportHidden = false;

async function loadDiagReport() {
  const st = await send({ type: 'diagStatus' });
  diagReportInfo = st?.report || null;
  renderDiagReport();
}

function renderDiagReport() {
  const show = !!diagReportInfo && !diagReportHidden && !info?.diag;
  $('diagReport').hidden = !show;
  if (show) {
    $('diagReportInfo').textContent = `${new Date(diagReportInfo.time).toLocaleString('nl-NL')} — ${diagReportInfo.events} gebeurtenissen. Download het bestand en stuur het mee in de chat.`;
  }
}

function downloadText(name, text, mime = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const stamp = () => new Date(diagReportInfo?.time || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-');

$('diagStart').addEventListener('click', async () => {
  const res = await send({ type: 'diagStart', tabId });
  if (!res?.ok) return showError(res?.error || 'Starten mislukt (ververs BluJay en probeer opnieuw).');
  showError('');
  startedAt = Date.now() + 10 * 60 * 1000;
  refresh();
});
$('diagStop').addEventListener('click', async () => {
  $('diagStop').disabled = true;
  const res = await send({ type: 'diagStop', save: true });
  $('diagStop').disabled = false;
  if (!res?.ok) return showError(res?.error || 'Stoppen mislukt');
  startedAt = 0;
  diagReportHidden = false;
  await refresh();
  await loadDiagReport();
});
$('diagCancel').addEventListener('click', async () => {
  await send({ type: 'diagStop', save: false });
  startedAt = 0;
  refresh();
});
$('diagReportClose').addEventListener('click', () => { diagReportHidden = true; renderDiagReport(); });
$('diagDownload').addEventListener('click', async () => {
  const r = await send({ type: 'diagReport' });
  if (r) downloadText(`blujay-opname-${stamp()}.txt`, r.text);
});
$('diagJson').addEventListener('click', async () => {
  const r = await send({ type: 'diagReport' });
  if (r) downloadText(`blujay-opname-${stamp()}.json`, r.json, 'application/json');
});
$('diagCopy').addEventListener('click', async () => {
  const r = await send({ type: 'diagReport' });
  if (!r) return;
  await navigator.clipboard.writeText(r.text);
  $('diagCopied').textContent = '✔ Gekopieerd';
  setTimeout(() => { $('diagCopied').textContent = ''; }, 3000);
});

const openOptions = () => chrome.runtime.openOptionsPage();
$('openOptions').addEventListener('click', openOptions);
$('openOptions2').addEventListener('click', openOptions);
$('showAll').addEventListener('change', () => {
  chrome.storage.local.set({ popupShowAll: $('showAll').checked });
  render();
});
$('stopRun').addEventListener('click', async () => {
  await send({ type: 'stopMacro', tabId });
  refresh();
});
$('startRec').addEventListener('click', async () => {
  if (info?.recordingElsewhere) return showError('Er loopt al een opname in een ander tabblad.');
  const res = await send({ type: 'startRecording', tabId });
  if (!res?.ok) return showError(res?.error || 'Opname starten mislukt (herlaad de pagina en probeer opnieuw).');
  refresh();
});
$('saveRec').addEventListener('click', async () => {
  const res = await send({ type: 'stopRecording', save: true, name: $('recName').value.trim() });
  if (!res?.ok) return showError(res?.error || 'Opslaan mislukt');
  await chrome.storage.session.set({ openMacro: res.macroId });
  chrome.runtime.openOptionsPage();
});
$('cancelRec').addEventListener('click', async () => {
  await send({ type: 'stopRecording', save: false });
  refresh();
});
$('pick').addEventListener('click', async () => {
  await send({ type: 'startPicker', tabId });
  startedAt = Date.now() + 20000; // even blijven verversen om het gekozen element te tonen
});

// Een PDF die naast het vak wordt losgelaten niet in het paneel openen.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

init().catch((e) => showError(e.message));
