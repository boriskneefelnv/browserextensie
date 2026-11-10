const $ = (id) => document.getElementById(id);

const state = {
  macros: [],
  settings: { ...BA.DEFAULT_SETTINGS },
  view: 'help', // 'macro' | 'settings' | 'log' | 'help'
  selectedId: null,
  openDetails: new Set(),
};

// ---------------------------------------------------------------- helpers

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v ?? '';
    else if (k === 'checked') e.checked = !!v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

let saveTimer = null;
function scheduleSave() {
  $('saved').textContent = 'Opslaan…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await BA.saveMacros(state.macros);
    await BA.saveSettings(state.settings);
    saveTimer = null;
    $('saved').textContent = 'Opgeslagen ✓';
    renderNav();
  }, 400);
}

/** Tekstveld gekoppeld aan obj[key]. */
function bind(obj, key, attrs = {}) {
  const tag = attrs.tag || 'input';
  delete attrs.tag;
  const input = el(tag, { type: tag === 'input' ? attrs.type || 'text' : undefined, ...attrs, value: obj[key] ?? '' });
  input.addEventListener('input', () => {
    let v = input.value;
    if (attrs.type === 'number') v = v === '' ? null : Number(v);
    obj[key] = v;
    scheduleSave();
  });
  return input;
}

function bindCheck(obj, key, label, { defaultTrue = false, onchange } = {}) {
  const box = el('input', { type: 'checkbox', checked: defaultTrue ? obj[key] !== false : !!obj[key] });
  box.addEventListener('change', () => {
    obj[key] = box.checked;
    scheduleSave();
    onchange?.();
  });
  return el('label', {}, box, label);
}

function bindSelect(obj, key, options, { onchange, defaultValue } = {}) {
  const sel = el('select', {}, Object.entries(options).map(([v, label]) => el('option', { value: v }, label)));
  sel.value = obj[key] ?? defaultValue ?? Object.keys(options)[0];
  sel.addEventListener('change', () => {
    obj[key] = sel.value;
    scheduleSave();
    onchange?.();
  });
  return sel;
}

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const selected = () => state.macros.find((m) => m.id === state.selectedId);

function move(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// ---------------------------------------------------------------- navigatie

function renderNav() {
  const nav = $('macroNav');
  nav.textContent = '';
  if (!state.macros.length) nav.append(el('p', { class: 'empty' }, 'Nog geen acties.'));
  for (const m of state.macros) {
    nav.append(
      el('button', {
        class: state.view === 'macro' && m.id === state.selectedId ? 'active' : '',
        onclick: () => show('macro', m.id),
      }, m.name || '(naamloos)', el('span', { class: 'count' }, `${m.steps.length}`))
    );
  }
}

function show(view, id = null) {
  state.view = view;
  if (id) state.selectedId = id;
  state.openDetails.clear();
  renderNav();
  renderMain();
}

function renderMain() {
  const main = $('main');
  main.textContent = '';
  if (state.view === 'macro' && selected()) return renderMacro(main, selected());
  if (state.view === 'settings') return renderSettings(main);
  if (state.view === 'log') return renderLog(main);
  main.append($('helpTpl').content.cloneNode(true));
}

// ---------------------------------------------------------------- handeling bewerken

function renderMacro(main, m) {
  const rerender = () => renderMain();

  main.append(
    el('div', { class: 'toolbar' },
      el('h2', { style: 'flex:1;margin:0' }, m.name || '(naamloos)'),
      el('button', { onclick: () => duplicate(m) }, 'Dupliceren'),
      el('button', { onclick: () => download(`${slug(m.name)}.json`, { macros: [m] }) }, 'Exporteren'),
      el('button', { class: 'danger', onclick: () => remove(m) }, 'Verwijderen')
    )
  );

  // Algemeen
  const nameInput = bind(m, 'name');
  nameInput.addEventListener('input', () => { main.querySelector('h2').textContent = m.name; });
  main.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Algemeen'),
      el('div', { class: 'grid2' },
        el('label', { class: 'f' }, el('span', {}, 'Naam'), nameInput),
        el('label', { class: 'f' }, el('span', {}, 'Wachttijd tussen stappen (ms, leeg = standaard)'), bind(m, 'stepDelay', { type: 'number', min: 0, placeholder: String(state.settings.stepDelay) }))
      ),
      el('label', { class: 'f' }, el('span', {}, 'Omschrijving'), bind(m, 'description', { placeholder: 'Wat doet deze handeling?' })),
      el('div', { class: 'checks', style: 'margin-bottom:10px' },
        bindCheck(m, 'realKeys', ' Echte toetsaanslagen gebruiken (aanbevolen voor BluJay; tijdens de handeling toont de browser een "foutopsporing"-balk)'),
        bindCheck(m, 'pdf', ' Paklijst (PDF) laten inlezen in het paneel')
      ),
      el('label', { class: 'f' },
        el('span', {}, 'Werkt op pagina\'s (URL-patroon, * = joker, meerdere scheiden met komma; leeg = overal)'),
        bind(m, 'urlPattern', { class: 'mono', placeholder: 'https://*.blujaysolutions.net/*' }))
    )
  );

  // Invoervelden
  const inputsBody = el('tbody');
  m.inputs.forEach((inp, i) => {
    inputsBody.append(
      el('tr', {},
        el('td', {}, bind(inp, 'name', { class: 'mono', placeholder: 'ordernummer' })),
        el('td', { style: 'width:150px' }, bindSelect(inp, 'type', BA.INPUT_TYPES)),
        el('td', {}, bind(inp, 'label', { placeholder: 'Ordernummer' })),
        el('td', {}, bind(inp, 'default', { placeholder: inp.type === 'month' ? '{{jaar}}-01' : '(optioneel)' })),
        el('td', { style: 'padding-top:9px;white-space:nowrap' }, bindCheck(inp, 'required', ' verplicht')),
        el('td', { class: 'actions' }, el('button', { class: 'mini danger', title: 'Verwijderen', onclick: () => { m.inputs.splice(i, 1); scheduleSave(); rerender(); } }, '✕'))
      )
    );
  });
  main.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Invoervelden'),
      el('p', { class: 'hint' }, 'Waarden die bij het starten worden gevraagd. Gebruik ze in stappen als {{naam}}. Maand + jaar opmaken kan met bijv. {{van|JJ/MM}} → 26/01.'),
      m.inputs.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Variabelenaam'), el('th', {}, 'Soort'), el('th', {}, 'Vraag / label'), el('th', {}, 'Standaardwaarde'), el('th'), el('th'))), inputsBody) : null,
      el('button', { onclick: () => { m.inputs.push({ name: '', type: 'text', label: '', default: '' }); scheduleSave(); rerender(); } }, '+ Invoerveld')
    )
  );

  // Automatisch starten
  const trigBody = el('tbody');
  m.triggers.forEach((t, i) => {
    trigBody.append(
      el('tr', {},
        el('td', { style: 'width:40px;padding-top:9px' }, bindCheck(t, 'enabled', '', { defaultTrue: true })),
        el('td', { style: 'width:190px' }, bindSelect(t, 'type', BA.TRIGGER_TYPES)),
        el('td', {}, bind(t, 'selector', { class: 'mono', placeholder: 'label=Status' })),
        el('td', { style: 'width:150px' }, bindSelect(t, 'condition', BA.CONDITIONS, { onchange: rerender })),
        el('td', { style: 'width:150px' }, ['any', 'notEmpty'].includes(t.condition || 'any') ? null : bind(t, 'value', { placeholder: 'Geleverd' })),
        el('td', { style: 'padding-top:9px;white-space:nowrap' }, bindCheck(t, 'confirm', ' eerst vragen')),
        el('td', { class: 'actions' }, el('button', { class: 'mini danger', title: 'Verwijderen', onclick: () => { m.triggers.splice(i, 1); scheduleSave(); rerender(); } }, '✕'))
      )
    );
  });
  main.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Automatisch starten'),
      el('p', { class: 'hint' }, 'Start deze handeling vanzelf wanneer je in BluJay een veld wijzigt of wanneer een element verschijnt. De waarde is beschikbaar als {{waarde}}.'),
      m.triggers.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Aan'), el('th', {}, 'Wanneer'), el('th', {}, 'Element'), el('th', {}, 'Voorwaarde'), el('th', {}, 'Waarde'), el('th'), el('th'))), trigBody) : null,
      el('button', { onclick: () => { m.triggers.push({ type: 'change', selector: '', condition: 'any', value: '', confirm: true }); scheduleSave(); rerender(); } }, '+ Automatische start')
    )
  );

  // Stappen
  const stepsBody = el('tbody');
  m.steps.forEach((s, i) => renderStepRow(stepsBody, m, s, i, rerender));
  const addStep = (type) => { m.steps.push({ type, selector: '', value: '' }); state.openDetails.clear(); scheduleSave(); rerender(); };
  main.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Stappen'),
      m.steps.length
        ? el('table', {}, el('thead', {}, el('tr', {}, el('th'), el('th', { style: 'width:170px' }, 'Soort'), el('th', {}, 'Element (selector)'), el('th', {}, 'Waarde'), el('th'))), stepsBody)
        : el('p', { class: 'empty' }, 'Nog geen stappen. Neem de handeling op via de popup, of voeg stappen toe.'),
      el('div', { class: 'toolbar', style: 'margin:10px 0 0' },
        el('button', { onclick: () => addStep('click') }, '+ Klik'),
        el('button', { onclick: () => addStep('type') }, '+ Typ tekst'),
        el('button', { onclick: () => addStep('select') }, '+ Kies uit lijst'),
        el('button', { onclick: () => addStep('waitFor') }, '+ Wacht op element'),
        el('button', { onclick: () => addStep('wait') }, '+ Wacht'),
        el('button', { onclick: () => addStep('notify') }, '+ Melding')
      )
    )
  );

  // Geavanceerd: JSON
  const ta = el('textarea', { rows: 14 });
  ta.value = JSON.stringify(m, null, 2);
  main.append(
    el('div', { class: 'card' },
      el('details', {},
        el('summary', {}, 'Geavanceerd: bewerken als JSON'),
        el('p', { class: 'hint' }, 'Handig om snel veel stappen aan te passen of te kopiëren.'),
        ta,
        el('div', { class: 'toolbar', style: 'margin-top:8px' },
          el('button', {
            class: 'primary',
            onclick: () => {
              try {
                const parsed = BA.normalizeMacro({ ...JSON.parse(ta.value), id: m.id });
                Object.assign(m, parsed);
                scheduleSave();
                rerender();
              } catch (e) {
                alert('Ongeldige JSON: ' + e.message);
              }
            },
          }, 'JSON toepassen')
        )
      )
    )
  );
}

function renderStepRow(tbody, m, s, i, rerender) {
  const def = BA.STEP_TYPES[s.type] || {};
  const key = i;
  const open = state.openDetails.has(key);

  const valuePlaceholder = {
    type: 'tekst of {{variabele}}', select: 'optietekst', check: 'aan / uit', key: 'Enter, Tab, Escape',
    wait: '1000', setVar: 'waarde of {{andere}}', navigate: 'https://…', notify: 'Klaar met {{ordernummer}}',
  }[s.type] || '';

  const row = el('tr', { class: 'step-row' + (s.disabled ? ' disabled' : '') },
    el('td', { class: 'nr' }, String(i + 1)),
    el('td', {}, bindSelect(s, 'type', Object.fromEntries(Object.entries(BA.STEP_TYPES).map(([k, v]) => [k, v.label])), { onchange: rerender })),
    el('td', {}, def.selector ? bind(s, 'selector', { class: 'mono', placeholder: 'text=Opslaan' }) : el('span', { class: 'hint' }, '—')),
    el('td', {}, def.value ? bind(s, 'value', { placeholder: valuePlaceholder })
      : def.variable ? bind(s, 'variable', { class: 'mono', placeholder: 'variabelenaam' })
        : null),
    el('td', { class: 'actions' },
      el('button', { class: 'mini', title: 'Meer opties', onclick: () => { open ? state.openDetails.delete(key) : state.openDetails.add(key); rerender(); } }, open ? '▴' : '⋯'),
      ' ',
      el('button', { class: 'mini', title: 'Omhoog', onclick: () => { move(m.steps, i, -1); state.openDetails.clear(); scheduleSave(); rerender(); } }, '↑'),
      el('button', { class: 'mini', title: 'Omlaag', onclick: () => { move(m.steps, i, 1); state.openDetails.clear(); scheduleSave(); rerender(); } }, '↓'),
      el('button', { class: 'mini', title: 'Kopie invoegen', onclick: () => { m.steps.splice(i + 1, 0, structuredClone(s)); state.openDetails.clear(); scheduleSave(); rerender(); } }, '⧉'),
      el('button', { class: 'mini danger', title: 'Verwijderen', onclick: () => { m.steps.splice(i, 1); state.openDetails.clear(); scheduleSave(); rerender(); } }, '✕')
    )
  );
  row.title = def.help || '';
  tbody.append(row);

  if (open) {
    const lbl = (t, input) => el('label', {}, el('span', { class: 'small-label' }, t), input);
    tbody.append(
      el('tr', { class: 'details' },
        el('td', { colspan: 5 },
          el('div', { class: 'grid' },
            def.variable && def.value ? lbl('Variabele', bind(s, 'variable', { class: 'mono' })) : null,
            lbl('Alleen als (voorwaarde)', bind(s, 'when', { class: 'mono', placeholder: '{{status}} == Gepland  /  !bestaat: text=X' })),
            def.selector ? lbl('Frame (deel van URL)', bind(s, 'frame', { class: 'mono', placeholder: 'automatisch' })) : null,
            def.selector ? lbl('Time-out (ms)', bind(s, 'timeout', { type: 'number', placeholder: String(state.settings.timeout) })) : null,
            def.selector ? lbl('Dichtst bij tekst', bind(s, 'near', { placeholder: 'bijv. Artikelregels' })) : null,
            def.selector ? lbl('Alleen in frame met tekst', bind(s, 'frameText', { placeholder: '(optioneel)' })) : null,
            s.type === 'read' ? lbl('Patroon (regex, 1e groep)', bind(s, 'pattern', { class: 'mono', placeholder: '(\\d{6,})' })) : null,
            el('div', { class: 'checks' },
              bindCheck(s, 'optional', 'Optioneel (overslaan als het mislukt)'),
              s.type === 'type' ? bindCheck(s, 'slow', 'Letter voor letter typen') : null,
              bindCheck(s, 'disabled', 'Uitgeschakeld', { onchange: rerender })
            ),
            el('div', { class: 'hint', style: 'grid-column:1/-1;margin:0' }, def.help || '')
          )
        )
      )
    );
  }
}

const slug = (s) => (s || 'handeling').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'handeling';

function duplicate(m) {
  const copy = BA.normalizeMacro({ ...structuredClone(m), id: BA.newId(), name: m.name + ' (kopie)' });
  state.macros.push(copy);
  scheduleSave();
  show('macro', copy.id);
}

function remove(m) {
  if (!confirm(`Handeling "${m.name}" verwijderen?`)) return;
  state.macros = state.macros.filter((x) => x !== m);
  scheduleSave();
  show('help');
}

// ---------------------------------------------------------------- instellingen & logboek

function renderSettings(main) {
  main.append(
    el('h2', {}, 'Instellingen'),
    el('div', { class: 'card' },
      el('div', { class: 'grid2' },
        el('label', { class: 'f' }, el('span', {}, 'Standaard wachttijd tussen stappen (ms)'), bind(state.settings, 'stepDelay', { type: 'number', min: 0 })),
        el('label', { class: 'f' }, el('span', {}, 'Maximaal wachten op een element (ms)'), bind(state.settings, 'timeout', { type: 'number', min: 500 }))
      ),
      el('p', { class: 'hint' }, 'Werkt BluJay traag? Verhoog dan beide waarden.')
    )
  );
}

async function renderLog(main) {
  const { log = [] } = await chrome.storage.local.get('log');
  main.append(
    el('div', { class: 'toolbar' },
      el('h2', { style: 'flex:1;margin:0' }, 'Logboek'),
      el('button', { onclick: async () => { await chrome.storage.local.set({ log: [] }); renderMain(); } }, 'Leegmaken')
    )
  );
  const card = el('div', { class: 'card' });
  if (!log.length) card.append(el('p', { class: 'empty' }, 'Nog niets uitgevoerd.'));
  for (const e of log) {
    const vars = Object.entries(e.vars || {}).map(([k, v]) => el('code', {}, `${k}=${v}`));
    card.append(
      el('div', { class: 'log-entry' },
        el('div', {}, new Date(e.time).toLocaleString('nl-NL')),
        el('div', {},
          el('span', { class: e.ok ? 'ok' : 'fail' }, e.ok ? '✔ ' : '✖ '),
          el('strong', {}, e.macro), ` — ${e.source}, ${(e.durationMs / 1000).toFixed(1)} s `,
          ...vars.flatMap((v) => [v, ' ']),
          e.error ? el('div', { class: 'fail' }, e.error) : null,
          e.trace && e.trace.length ? el('details', {},
            el('summary', {}, 'Stappenverslag'),
            el('pre', { style: 'white-space:pre-wrap;font:10.5px Consolas,monospace;background:#f7f7f7;border:1px solid #ddd;padding:6px;margin:4px 0' }, e.trace.join('\n')),
            el('button', { onclick: (ev) => { navigator.clipboard.writeText(`"${e.macro}" — ${e.error || 'gelukt'}\n` + e.trace.join('\n')); ev.target.textContent = '✔ Gekopieerd'; } }, '📋 Kopiëren')
          ) : null
        )
      )
    );
  }
  main.append(card);
}

// ---------------------------------------------------------------- import / export

$('newMacro').addEventListener('click', () => {
  const m = BA.normalizeMacro({ name: 'Nieuwe handeling', urlPattern: '' });
  state.macros.push(m);
  scheduleSave();
  show('macro', m.id);
});
$('navSettings').addEventListener('click', () => show('settings'));
$('navLog').addEventListener('click', () => show('log'));
$('navHelp').addEventListener('click', () => show('help'));
$('exportAll').addEventListener('click', () => download('blujay-handelingen.json', { macros: state.macros, settings: state.settings }));
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.macros || (data.steps ? [data] : []);
    if (!list.length) throw new Error('geen handelingen gevonden in dit bestand');
    let added = 0;
    for (const raw of list) {
      const m = BA.normalizeMacro(raw);
      const existing = state.macros.findIndex((x) => x.id === m.id);
      if (existing >= 0) {
        if (!confirm(`"${m.name}" bestaat al. Overschrijven?`)) continue;
        state.macros[existing] = m;
      } else state.macros.push(m);
      added++;
    }
    if (data.settings && confirm('Ook de instellingen uit dit bestand overnemen?')) state.settings = { ...state.settings, ...data.settings };
    scheduleSave();
    renderNav();
    alert(`${added} handeling(en) geïmporteerd.`);
  } catch (e) {
    alert('Importeren mislukt: ' + e.message);
  }
});

// Wijzigingen van buitenaf (bijv. een nieuwe opname) oppikken zonder lopende bewerkingen te verliezen.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.macros) return;
  const incoming = (changes.macros.newValue || []).map(BA.normalizeMacro);
  const ids = new Set(incoming.map((m) => m.id));
  const known = new Set(state.macros.map((m) => m.id));
  if (incoming.length === state.macros.length && incoming.every((m) => known.has(m.id))) return;
  state.macros = state.macros.filter((m) => ids.has(m.id));
  for (const m of incoming) if (!known.has(m.id)) state.macros.push(m);
  renderNav();
  if (state.view === 'macro' && !selected()) show('help');
});

async function init() {
  const cfg = await BA.loadConfig();
  state.macros = cfg.macros;
  state.settings = cfg.settings;
  const { openMacro } = await chrome.storage.session.get('openMacro');
  if (openMacro && state.macros.some((m) => m.id === openMacro)) {
    await chrome.storage.session.remove('openMacro');
    show('macro', openMacro);
  } else show(state.macros.length ? 'macro' : 'help', state.macros[0]?.id);
}

init();
