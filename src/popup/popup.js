const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let tabId = null;
let info = null;

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

function renderMacro(m, isOther) {
  const inputs = m.inputs.filter((i) => i.name);
  const fields = inputs.map((inp) => renderInput(m, inp));
  const runBtn = el('button', { class: 'primary small', disabled: !!info.running || !!info.recording }, '▶ Uitvoeren');
  const summary = el('p', { class: 'summary' });
  const box = el('div', { class: 'macro' + (isOther ? ' other' : '') },
    el('div', { class: 'macro-head' }, el('strong', {}, m.name), runBtn),
    m.description ? el('p', { class: 'desc' }, m.description) : null,
    m.triggers.some((t) => t.enabled !== false && t.selector) ? el('div', { class: 'auto' }, '⚡ start ook automatisch') : null,
    fields.length ? el('div', { class: 'inputs' }, ...fields) : null,
    fields.length ? summary : null
  );
  const updateSummary = () => {
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
    const res = await send({ type: 'runMacro', tabId, macroId: m.id, vars });
    if (!res?.ok) return showError(res?.error || 'Starten mislukt');
    window.close();
  };
  runBtn.addEventListener('click', run);
  box.querySelectorAll('input[data-name]').forEach((i) => {
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    i.addEventListener('input', updateSummary);
  });
  updateSummary();
  return box;
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
  matching.forEach((m) => list.append(renderMacro(m, false)));
  if ($('showAll').checked) others.forEach((m) => list.append(renderMacro(m, true)));

  const running = info.running ? info.macros.find((m) => m.id === info.running) : null;
  $('runningBox').hidden = !running;
  if (running) $('runningName').textContent = running.name;

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

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  const { popupShowAll } = await chrome.storage.local.get('popupShowAll');
  $('showAll').checked = !!popupShowAll;
  await refresh();
  // Opname-teller live bijwerken
  setInterval(() => { if (info?.recording || info?.running) refresh(); }, 1000);
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
  window.close();
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
  window.close();
});

init().catch((e) => showError(e.message));
