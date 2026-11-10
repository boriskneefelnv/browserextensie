const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let tabId = null;
let info = null;
let startedAt = 0;

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function renderInput(m, inp) {
  const type = BA.INPUT_TYPES[inp.type] ? inp.type : 'text';
  const id = `in-${m.id}-${inp.name}`;
  const input = el('input', {
    type,
    id,
    'data-name': inp.name,
    'data-type': type,
    'data-label': inp.label || inp.name,
    'data-required': inp.required ? '1' : null,
    placeholder: type === 'text' ? inp.placeholder || '' : null,
    autocomplete: 'off',
  });
  input.value = BA.fillTemplate(inp.default || '', BA.builtinVars());
  return el('div', { class: type === 'text' ? 'full' : 'half' },
    el('label', { for: id }, inp.label || inp.name),
    input
  );
}

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

function collectVars(box) {
  const vars = {};
  const months = [];
  for (const input of box.querySelectorAll('input[data-name]')) {
    const v = input.value.trim();
    if (input.dataset.required && !v) throw new Error(`Vul "${input.dataset.label}" in.`);
    vars[input.dataset.name] = v;
    if (input.dataset.type === 'month' && v) months.push({ label: input.dataset.label, v });
  }
  // Van-periode mag niet na t/m-periode liggen.
  for (let i = 1; i < months.length; i++) {
    if (months[i].v < months[i - 1].v) throw new Error(`"${months[i].label}" ligt vóór "${months[i - 1].label}".`);
  }
  return vars;
}

function monthText(v) {
  const m = v.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : v;
}

const PDF_BASE = chrome.runtime.getURL('src/lib/pdfjs/');

async function readPdf(file, box, m, status) {
  status.className = 'pdfstatus';
  status.textContent = `"${file.name}" lezen…`;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const { text, lines } = await BAPdf.extract(data, PDF_BASE);
    const { ontvangerCodes = {} } = await chrome.storage.local.get('ontvangerCodes');
    const { klant, waarden } = BAParsers.parse(text, lines, ontvangerCodes);
    if (!klant) {
      status.className = 'pdfstatus fail';
      status.textContent = `✖ Klant niet herkend in "${file.name}". Deze klant is nog niet ingesteld.`;
      return;
    }
    // Velden uit de paklijst (opnieuw) vullen; datums/tijden die je al had ingevuld blijven staan.
    for (const inp of m.inputs) {
      const input = box.querySelector(`input[data-name="${inp.name}"]`);
      if (!input) continue;
      if (Object.prototype.hasOwnProperty.call(waarden, inp.name)) input.value = waarden[inp.name] ?? '';
      else if (!['date', 'time'].includes(inp.type)) input.value = BA.fillTemplate(inp.default || '', BA.builtinVars());
      input.classList.toggle('missing', !!inp.required && !input.value);
    }
    box.dataset.klantnummer = waarden.klantnummer || '';
    const ontbreekt = m.inputs.filter((i) => i.required && !['date', 'time'].includes(i.type) && !waarden[i.name]).map((i) => i.label);
    status.className = 'pdfstatus ok';
    status.textContent = `✔ ${klant.naam}${waarden.afnemer ? ' → ' + waarden.afnemer : ''}  ·  ${file.name}` +
      (ontbreekt.length ? `\n⚠ Niet gevonden, vul zelf in: ${ontbreekt.join(', ')}` : '');
    const firstEmpty = [...box.querySelectorAll('input[data-required]')].find((i) => !i.value);
    firstEmpty?.focus();
  } catch (e) {
    status.className = 'pdfstatus fail';
    status.textContent = `✖ PDF lezen mislukt: ${e.message}`;
  }
}

function renderMacro(m, isOther) {
  const inputs = m.inputs.filter((i) => i.name);
  const fields = [];
  let section = null;
  for (const inp of inputs) {
    if (inp.section && inp.section !== section) {
      section = inp.section;
      fields.push(el('div', { class: 'sec full' }, section));
    }
    fields.push(renderInput(m, inp));
  }
  const runBtn = el('button', { class: 'primary small' }, '▶ Uitvoeren');
  const summary = el('p', { class: 'summary' });
  const showSummary = inputs.length > 0 && inputs.length <= 4;

  let pdfZone = null;
  let pdfStatus = null;
  if (m.pdf) {
    const file = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
    pdfStatus = el('p', { class: 'pdfstatus' });
    pdfZone = el('div', { class: 'drop', tabindex: '0' }, '📄 Sleep de paklijst (PDF) hierheen', el('br'), el('span', {}, 'of klik om een bestand te kiezen'), file);
    pdfZone.addEventListener('click', () => file.click());
    pdfZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') file.click(); });
    pdfZone.addEventListener('dragover', (e) => { e.preventDefault(); pdfZone.classList.add('over'); });
    pdfZone.addEventListener('dragleave', () => pdfZone.classList.remove('over'));
    pdfZone.addEventListener('drop', (e) => {
      e.preventDefault();
      pdfZone.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) readPdf(f, box, m, pdfStatus);
    });
    file.addEventListener('change', () => { if (file.files[0]) readPdf(file.files[0], box, m, pdfStatus); file.value = ''; });
  }

  const box = el('div', { class: 'macro' + (isOther ? ' other' : '') },
    el('div', { class: 'macro-head' }, el('strong', {}, m.name), runBtn),
    m.description ? el('p', { class: 'desc' }, m.description) : null,
    m.triggers.some((t) => t.enabled !== false && t.selector) ? el('div', { class: 'auto' }, '⚡ start ook automatisch') : null,
    pdfZone,
    pdfStatus,
    fields.length ? el('div', { class: 'inputs' }, ...fields) : null,
    showSummary ? summary : null
  );
  const updateSummary = () => {
    if (!showSummary) return;
    const parts = [];
    for (const input of box.querySelectorAll('input[data-name]')) {
      const v = input.value.trim();
      parts.push(`${input.dataset.label}: ${input.dataset.type === 'month' ? monthText(v) || '—' : v || '(leeg)'}`);
    }
    summary.textContent = parts.join(' · ');
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
    setTimeout(refresh, 300); // paneel blijft open en toont de voortgang
  };
  runBtn.addEventListener('click', run);
  box.querySelectorAll('input[data-name]').forEach((i) => {
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    i.addEventListener('input', () => { updateSummary(); i.classList.remove('missing'); });
  });
  updateSummary();
  return { box, runBtn };
}

// Kaarten hergebruiken bij verversen, zodat ingevulde waarden niet verdwijnen.
const cards = new Map(); // macroId -> { json, box, runBtn }

function card(m, isOther) {
  const json = JSON.stringify(m) + isOther;
  let c = cards.get(m.id);
  if (!c || c.json !== json) {
    c = { json, ...renderMacro(m, isOther) };
    cards.set(m.id, c);
  }
  c.runBtn.disabled = !!info.running || !!info.recording;
  return c.box;
}

function render() {
  const list = $('macroList');
  list.textContent = '';
  const matching = info.macros.filter((m) => info.matching.includes(m.id));
  const others = info.macros.filter((m) => !info.matching.includes(m.id));
  if (!matching.length) {
    list.append(el('p', { class: 'empty' }, info.macros.length
      ? 'Geen handelingen voor deze pagina.'
      : 'Nog geen handelingen. Neem er hieronder een op, of maak er een via ⚙.'));
  }
  matching.forEach((m) => list.append(card(m, false)));
  if ($('showAll').checked) others.forEach((m) => list.append(card(m, true)));

  const running = info.running ? info.macros.find((m) => m.id === info.running) : null;
  $('runningBox').hidden = !running;
  if (running) {
    $('runningName').textContent = running.name;
    $('runningStep').textContent = info.progress || 'starten…';
  }

  // Resultaat van de laatste uitvoering (alleen als die net in deze popup gestart is of < 2 min geleden).
  const last = info.lastRun;
  const recent = last && Date.now() - new Date(last.time).getTime() < 2 * 60 * 1000;
  $('lastRun').hidden = !!running || !recent;
  if (!running && recent) {
    $('lastRun').className = 'lastrun ' + (last.ok ? 'ok' : 'fail');
    $('lastRun').textContent = last.ok ? `✔ "${last.macro}" is uitgevoerd.` : `✖ "${last.macro}" mislukt — ${last.error}`;
  }

  $('recIdle').hidden = !!info.recording || info.recordingElsewhere;
  $('recActive').hidden = !info.recording;
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
  const { popupShowAll } = await chrome.storage.local.get('popupShowAll');
  $('showAll').checked = !!popupShowAll;
  await refresh();
  // Opname-teller live bijwerken
  setInterval(() => { if (info?.recording || info?.running || Date.now() - startedAt < 3000) refresh(); }, 500);
}

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('showAll').addEventListener('change', () => {
  chrome.storage.local.set({ popupShowAll: $('showAll').checked });
  render();
});
$('stopRun').addEventListener('click', async () => {
  await send({ type: 'stopMacro', tabId });
  refresh();
});
$('startRec').addEventListener('click', async () => {
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
