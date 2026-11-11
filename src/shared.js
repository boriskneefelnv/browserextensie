/*
 * Gedeelde hulpfuncties voor achtergrond, content script, popup en opties.
 * Wordt geladen via importScripts (service worker), <script> (popup/opties)
 * en als content script.
 */
// eslint-disable-next-line no-unused-vars
var BA = (() => {
  const DEFAULT_SETTINGS = {
    stepDelay: 60, // ms wachten tussen stappen (er wordt al gewacht tot elementen/pagina's klaar zijn)
    timeout: 10000, // ms wachten tot een element verschijnt
  };

  // Stapsoorten met Nederlandse labels en welke velden ze gebruiken.
  const STEP_TYPES = {
    click: { label: 'Klik', selector: true, value: false, help: 'Klik op een knop, link of veld.' },
    type: { label: 'Typ tekst', selector: true, value: true, help: 'Vul tekst in een invoerveld in. Gebruik {{naam}} voor variabelen.' },
    select: { label: 'Kies uit lijst', selector: true, value: true, help: 'Kies een optie (tekst of waarde) in een keuzelijst.' },
    check: { label: 'Vinkje', selector: true, value: true, help: 'Zet een vinkje aan of uit (waarde: aan / uit).' },
    key: { label: 'Toets', selector: true, value: true, help: 'Druk op een toets in een veld, bijv. Enter, Tab of Escape.' },
    read: { label: 'Lees waarde', selector: true, value: false, variable: true, help: 'Lees de waarde/tekst van een element en bewaar die in een variabele.' },
    tabTo: { label: 'Tab naar veld', selector: true, value: true, help: 'Druk Tab (zoals jij dat doet) tot de cursor in dit veld staat. Waarde = maximaal aantal keer Tab (standaard 10).' },
    waitFor: { label: 'Wacht op element', selector: true, value: false, help: 'Wacht tot een element zichtbaar is.' },
    waitGone: { label: 'Wacht tot weg', selector: true, value: false, help: 'Wacht tot een element (bijv. een laadscherm) verdwenen is.' },
    wait: { label: 'Wacht (ms)', selector: false, value: true, help: 'Wacht een vast aantal milliseconden.' },
    setVar: { label: 'Zet variabele', selector: false, value: true, variable: true, help: 'Geef een variabele een waarde.' },
    navigate: { label: 'Ga naar URL', selector: false, value: true, help: 'Open een adres in het huidige tabblad.' },
    notify: { label: 'Melding', selector: false, value: true, help: 'Toon een melding op de pagina.' },
    remember: { label: 'Onthoud waarde', selector: false, value: true, variable: true, help: 'Bewaar een waarde blijvend (bijv. een nieuwe ontvanger-code per afnemer). Variabele = lijst (bijv. ontvangerCodes), Sleutel = bijv. {{klantnummer}}, Waarde = bijv. {{nieuwecode}}.' },
    stop: { label: 'Stop handeling', selector: false, value: false, help: 'Stop de handeling (meestal samen met "Alleen als").' },
  };

  const INPUT_TYPES = {
    text: 'Tekst',
    month: 'Maand + jaar',
    date: 'Datum',
    time: 'Tijd',
  };

  const TRIGGER_TYPES = {
    change: 'Veld wordt gewijzigd',
    appear: 'Element verschijnt op pagina',
  };

  const CONDITIONS = {
    any: 'altijd',
    notEmpty: 'is niet leeg',
    equals: 'is gelijk aan',
    contains: 'bevat',
    startsWith: 'begint met',
    regex: 'voldoet aan regex',
  };

  function newId() {
    return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function escapeRegex(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  function globToRegex(glob) {
    return new RegExp('^' + glob.split('*').map(escapeRegex).join('.*') + '$', 'i');
  }

  /** URL-patroon met * als joker. Meerdere patronen scheiden met komma of nieuwe regel. Leeg = overal. */
  function urlMatches(pattern, url) {
    const parts = String(pattern || '')
      .split(/[\n,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return true;
    return parts.some((p) => globToRegex(p).test(url || ''));
  }

  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

  function builtinVars() {
    const now = new Date();
    const day = 24 * 3600 * 1000;
    return {
      vandaag: fmtDate(now),
      morgen: fmtDate(new Date(now.getTime() + day)),
      gisteren: fmtDate(new Date(now.getTime() - day)),
      tijd: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      nu: `${fmtDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      jaar: String(now.getFullYear()),
      maand: pad(now.getMonth() + 1),
    };
  }

  /**
   * Opmaak na een | in een variabele, bijv. {{van|JJ/MM}} of {{klant|hoofdletters}}.
   * Datumtokens: JJJJ/YYYY (jaar), JJ/YY (jaar 2 cijfers), MM (maand), DD (dag).
   * Werkt op waarden als 2026-01 (maandkiezer), 2026-01-31 (datumkiezer) en 31-01-2026.
   */
  function formatValue(value, fmt) {
    const f = fmt.trim();
    if (/^(hoofdletters|upper)$/i.test(f)) return value.toUpperCase();
    if (/^(kleineletters|lower)$/i.test(f)) return value.toLowerCase();
    if (/^(trim)$/i.test(f)) return value.trim();
    let y, m, d;
    let match = value.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (match) [, y, m, d] = match;
    else if ((match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) [, d, m, y] = match;
    if (!y) return value;
    return f.replace(/JJJJ|YYYY|JJ|YY|MM|DD/g, (t) =>
      t === 'JJJJ' || t === 'YYYY' ? y : t === 'JJ' || t === 'YY' ? y.slice(-2) : t === 'MM' ? pad(m) : pad(d || 1)
    );
  }

  /** Vervangt {{naam}} (of {{naam|opmaak}}) door de waarde van variabele "naam". Onbekende variabelen blijven staan. */
  function fillTemplate(str, vars) {
    return String(str ?? '').replace(/\{\{\s*([\w.-]+)\s*(?:\|([^}]*))?\}\}/g, (m, key, fmt) => {
      if (!Object.prototype.hasOwnProperty.call(vars, key)) return m;
      const v = String(vars[key] ?? '');
      return fmt ? formatValue(v, fmt) : v;
    });
  }

  /**
   * Eenvoudige voorwaarde (na invullen van variabelen):
   *   "A == B", "A != B", "A ~ B" (A bevat B), "A !~ B", of alleen "A" (niet leeg).
   * Vergelijking is hoofdletterongevoelig.
   */
  function evalCondition(expr, vars) {
    // Meerdere voorwaarden met && (allemaal waar)
    const delen = String(expr ?? '').split(/\s*&&\s*/);
    if (delen.length > 1) return delen.every((d) => evalCondition(d, vars));
    const filled = fillTemplate(expr, vars).trim();
    if (!filled) return true;
    const m = filled.match(/^(.*?)\s*(==|!=|!~|~)\s*(.*)$/s);
    if (!m) return filled !== '' && !/^(0|nee|false|onwaar)$/i.test(filled) && !/\{\{/.test(filled);
    const a = m[1].trim().toLowerCase();
    const b = m[3].trim().toLowerCase();
    switch (m[2]) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '~': return a.includes(b);
      case '!~': return !a.includes(b);
    }
    return false;
  }

  function checkTriggerCondition(trigger, value) {
    const v = String(value ?? '').trim();
    const c = String(trigger.value ?? '').trim();
    switch (trigger.condition || 'any') {
      case 'any': return true;
      case 'notEmpty': return v !== '';
      case 'equals': return v.toLowerCase() === c.toLowerCase();
      case 'contains': return v.toLowerCase().includes(c.toLowerCase());
      case 'startsWith': return v.toLowerCase().startsWith(c.toLowerCase());
      case 'regex':
        try { return new RegExp(c, 'i').test(v); } catch { return false; }
    }
    return false;
  }

  function normalizeMacro(m) {
    return {
      id: m.id || newId(),
      name: m.name || 'Naamloze handeling',
      description: m.description || '',
      urlPattern: m.urlPattern ?? '',
      stepDelay: m.stepDelay ?? null,
      realKeys: !!m.realKeys,
      pdf: !!m.pdf,
      inputs: Array.isArray(m.inputs) ? m.inputs : [],
      triggers: Array.isArray(m.triggers) ? m.triggers : [],
      steps: Array.isArray(m.steps) ? m.steps : [],
    };
  }

  async function loadConfig() {
    const data = await chrome.storage.local.get(['macros', 'settings']);
    return {
      macros: (data.macros || []).map(normalizeMacro),
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    };
  }

  async function saveMacros(macros) {
    await chrome.storage.local.set({ macros });
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ settings });
  }

  return {
    DEFAULT_SETTINGS,
    STEP_TYPES,
    INPUT_TYPES,
    TRIGGER_TYPES,
    CONDITIONS,
    newId,
    urlMatches,
    builtinVars,
    formatValue,
    fillTemplate,
    evalCondition,
    checkTriggerCondition,
    normalizeMacro,
    loadConfig,
    saveMacros,
    saveSettings,
  };
})();
