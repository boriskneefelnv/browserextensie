/*
 * Service worker: bewaart opnames, voert handelingen stap voor stap uit
 * (over alle frames van het tabblad) en verwerkt automatische starters.
 */
importScripts('shared.js', 'presets.js');

// Klik op het icoon (of Alt+B) opent het zijpaneel; dat blijft open terwijl je in BluJay werkt.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const running = new Map(); // tabId -> { macroId, stopped }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- helpers

async function sendToFrame(tabId, frameId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg, { frameId });
  } catch {
    return undefined; // frame zonder content script of frame wordt net herladen
  }
}

function toast(tabId, text, kind = 'info') {
  sendToFrame(tabId, 0, { type: 'toast', text, kind });
}

async function setBadge(tabId, text, color = '#c62828') {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch { /* tabblad gesloten */ }
}

async function getRecording() {
  const { recording } = await chrome.storage.session.get('recording');
  return recording || null;
}

async function setRecording(recording) {
  await chrome.storage.session.set({ recording });
}

async function addLog(entry) {
  const { log = [] } = await chrome.storage.local.get('log');
  log.unshift({ time: new Date().toISOString(), ...entry });
  await chrome.storage.local.set({ log: log.slice(0, 50) });
}

// ---------------------------------------------------------------- uitvoeren
//
// Een lopende handeling ("ctrl") houdt bij in welke tabbladen hij werkt: het tabblad
// waar hij gestart is, plus vensters/tabbladen die BluJay tijdens de handeling opent.

function showProgress(ctrl, text) {
  ctrl.progress = text;
  for (const t of ctrl.tabs) sendToFrame(t, 0, { type: 'progress', text });
}

function toastAll(ctrl, text, kind) {
  for (const t of ctrl.tabs) toast(t, text, kind);
}

function ctrlForTab(tabId) {
  for (const ctrl of running.values()) if (ctrl.tabs.includes(tabId)) return ctrl;
  return null;
}

// Door BluJay geopende vensters/tabbladen meenemen in de lopende handeling.
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
  const ctrl = ctrlForTab(d.sourceTabId);
  if (ctrl && !ctrl.tabs.includes(d.tabId)) ctrl.tabs.push(d.tabId);
});
chrome.tabs.onCreated.addListener((tab) => {
  const ctrl = tab.openerTabId != null ? ctrlForTab(tab.openerTabId) : null;
  if (ctrl && !ctrl.tabs.includes(tab.id)) ctrl.tabs.push(tab.id);
});

/** Eén keer alle tabbladen/frames afzoeken naar één selector. */
async function scanOnce(ctrl, selector, { frameHint, frameText, near, allowHidden }) {
  const isFocus = /^(focus|focus-any|actief veld|cursor)$/i.test(String(selector).trim());
  let foundIn = null;
  let bestFocus = -1;
  // Nieuwste tabblad (bijv. een net geopend venster) eerst.
  for (const tabId of [...ctrl.tabs].reverse()) {
    let frames = [];
    try {
      frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
    } catch { /* tab weg */ }
    const score = (f) => (frameHint && f.url.includes(frameHint) ? 0 : f.frameId === 0 ? 1 : 2);
    frames.sort((a, b) => score(a) - score(b));
    for (const f of frames) {
      const r = await sendToFrame(tabId, f.frameId, { type: 'probe', selector, allowHidden, frameText, near });
      if (r && r.error) throw new Error(r.error);
      if (!r || !r.found) continue;
      // Bij "focus": het frame waar het laatst een veld actief werd wint.
      if (isFocus) {
        if ((r.focusAt || 0) > bestFocus) { bestFocus = r.focusAt || 0; foundIn = { tabId, frameId: f.frameId, selector }; }
        continue;
      }
      return { tabId, frameId: f.frameId, selector };
    }
  }
  return foundIn;
}

/**
 * Zoekt in welk tabblad/frame het element staat. Geeft { tabId, frameId, selector } terug of null.
 * Meerdere alternatieven kan met " || ", bijv. "focus || field=Zending" (eerste die gevonden wordt).
 */
async function locate(ctrl, selector, { frameHint, frameText = '', near = '', timeout, allowHidden = false, wantGone = false, label = '' }) {
  const started = Date.now();
  const deadline = started + timeout;
  const alternatives = String(selector).split(/\s+\|\|\s+/).map((x) => x.trim()).filter(Boolean);
  for (;;) {
    let foundIn = null;
    for (const alt of alternatives) {
      foundIn = await scanOnce(ctrl, alt, { frameHint, frameText, near, allowHidden });
      if (foundIn) break;
    }
    if (!wantGone && foundIn) return foundIn;
    if (wantGone && !foundIn) return true;
    if (ctrl.stopped) throw new Error('gestopt door gebruiker');
    if (Date.now() > deadline) return wantGone ? false : null;
    const secs = Math.round((Date.now() - started) / 1000);
    if (secs >= 2) showProgress(ctrl, `${label} — wacht ${wantGone ? 'tot weg' : 'op'} "${selector}" (${secs}s / ${Math.round(timeout / 1000)}s)`);
    await sleep(250);
  }
}

async function waitForTabComplete(tabId, timeout) {
  const deadline = Date.now() + timeout;
  await sleep(400);
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('tabblad is gesloten');
    if (tab.status === 'complete') return;
    await sleep(250);
  }
}

/** Klikt in de pagina-context zelf, zodat ook href="javascript:..." links werken. */
function mainWorldClick(tag) {
  const el = document.querySelector(`[data-ba-click="${tag}"]`);
  if (!el) return false;
  el.removeAttribute('data-ba-click');
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  const fire = (type) => {
    const C = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    el.dispatchEvent(new C(type, opts));
  };
  fire('pointerover');
  fire('mouseover');
  el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
  fire('mousemove');
  fire('pointerdown');
  fire('mousedown');
  if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  fire('pointerup');
  fire('mouseup');
  if (typeof el.click === 'function') el.click();
  else fire('click');
  return true;
}

async function clickTagged(tabId, frameId, tag) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func: mainWorldClick,
      args: [tag],
    });
    if (res && res.result) return;
  } catch { /* bijv. geen toegang: val terug op klikken vanuit het content script */ }
  const r = await sendToFrame(tabId, frameId, { type: 'clickTagged', tag });
  if (!r || !r.ok) throw new Error('klikken mislukt');
}

// ---------------------------------------------------------------- echte toetsaanslagen
//
// Via chrome.debugger worden échte (trusted) toetsaanslagen gestuurd, net alsof je zelf typt.
// Tijdens de handeling toont de browser een balk "… is foutopsporing gestart"; dat is normaal.
// Lukt dat niet (bijv. geblokkeerd door beleid), dan valt hij terug op nagebootste invoer.

const CDP_KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  F2: { code: 'F2', keyCode: 113 },
  F3: { code: 'F3', keyCode: 114 },
  F4: { code: 'F4', keyCode: 115 },
};
const KEY_ALIASES = { enter: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', del: 'Delete' };

const attached = new Set(); // tabIds waar wij de debugger aan hebben gekoppeld
chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId));

async function cdpAttach(ctrl, tabId) {
  if (!ctrl.cdp) ctrl.cdp = new Map();
  if (!ctrl.cdp.has(tabId)) {
    ctrl.cdp.set(tabId, (async () => {
      try {
        if (!attached.has(tabId)) {
          await chrome.debugger.attach({ tabId }, '1.3');
          attached.add(tabId);
        }
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
        return true;
      } catch (e) {
        ctrl.cdpError = e.message;
        return false;
      }
    })());
  }
  return ctrl.cdp.get(tabId);
}

async function cdpDetachAll(ctrl) {
  for (const tabId of ctrl.cdp?.keys() || []) {
    if (!attached.has(tabId)) continue;
    await chrome.debugger.detach({ tabId }).catch(() => {});
    attached.delete(tabId);
  }
}

const cdp = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);

async function cdpKey(tabId, name) {
  const key = KEY_ALIASES[String(name).toLowerCase()] || name;
  const k = CDP_KEYS[key];
  if (!k && key.length === 1) return cdpText(tabId, key);
  if (!k) throw new Error(`onbekende toets: ${name}`);
  await cdp(tabId, 'Input.dispatchKeyEvent', {
    type: k.text ? 'keyDown' : 'rawKeyDown', key, code: k.code,
    windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, text: k.text, unmodifiedText: k.text,
  });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode });
}

async function cdpText(tabId, text) {
  for (const ch of text) {
    const kc = /[a-z0-9]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : ch === ' ' ? 32 : 0;
    const code = /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : '';
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
  }
}

/** Voorwaarde "Alleen als": gewone vergelijking, of "bestaat: <selector>" / "!bestaat: <selector>". */
async function checkWhen(ctrl, when, vars) {
  const m = String(when).trim().match(/^(!|niet\s+)?bestaat\s*:\s*(.+)$/i);
  if (!m) return BA.evalCondition(when, vars);
  const found = await locate(ctrl, BA.fillTemplate(m[2], vars), { timeout: 0 });
  return m[1] ? !found : !!found;
}

/** Druk Tab tot de cursor in het gevraagde veld staat (volgt de tab-volgorde van BluJay). */
async function tabTo(ctrl, step, selector, fill, timeout, label) {
  const max = Number(fill(step.value)) || 10;
  const target = await locate(ctrl, selector, { frameHint: step.frame, near: fill(step.near || ''), timeout, label });
  if (!target) throw new Error(`veld niet gevonden: ${selector}`);
  let clicked = false;
  for (let i = 0; ; i++) {
    if (ctrl.stopped) throw new Error('gestopt door gebruiker');
    const f = await scanOnce(ctrl, 'focus-any', {});
    const sameFrame = f && f.tabId === target.tabId && f.frameId === target.frameId;
    if (sameFrame) {
      const r = await sendToFrame(f.tabId, f.frameId, { type: 'isFocused', selector });
      if (r && r.focused) return;
    }
    if (!sameFrame || i >= max) {
      // Cursor staat buiten het formulier (bijv. bij de rol-keuze) of het veld komt niet langs:
      // nooit verder tabben, maar het veld aanklikken.
      if (clicked) {
        const d = f ? await sendToFrame(f.tabId, f.frameId, { type: 'describeFocus' }) : null;
        throw new Error(`cursor komt niet in "${selector}" (staat bij: ${d?.text || 'onbekend'})`);
      }
      clicked = true;
      const res = await sendToFrame(target.tabId, target.frameId, { type: 'exec', step: { type: 'click', selector } });
      if (res?.value?.__clickTag) await clickTagged(target.tabId, target.frameId, res.value.__clickTag);
      await sleep(300);
      i = -1; // na het aanklikken opnieuw tellen
      continue;
    }
    if (ctrl.realKeys && (await cdpAttach(ctrl, f.tabId))) await cdpKey(f.tabId, 'Tab');
    else await sendToFrame(f.tabId, f.frameId, { type: 'exec', step: { type: 'key', selector: 'focus-any', value: 'Tab' } });
    await sleep(350);
  }
}

async function runStep(ctrl, step, vars, settings, label) {
  const fill = (s) => BA.fillTemplate(s, vars);
  const timeout = Number(step.timeout) || settings.timeout;

  switch (step.type) {
    case 'wait':
      await sleep(Number(fill(step.value)) || 0);
      return;
    case 'setVar':
      if (step.variable) vars[step.variable] = fill(step.value);
      return;
    case 'notify':
      toastAll(ctrl, fill(step.value), 'info');
      return;
    case 'navigate': {
      const url = fill(step.value);
      const tabId = ctrl.tabs[ctrl.tabs.length - 1];
      await chrome.tabs.update(tabId, { url });
      await waitForTabComplete(tabId, Math.max(timeout, 30000));
      return;
    }
    case 'stop':
      return 'stop';
  }

  const selector = fill(step.selector);
  if (!selector) throw new Error('geen element (selector) ingevuld');

  if (step.type === 'waitGone') {
    const gone = await locate(ctrl, selector, { frameHint: step.frame, timeout: Math.max(timeout, 30000), wantGone: true, label });
    if (!gone) throw new Error(`element verdwijnt niet: ${selector}`);
    return;
  }

  if (step.type === 'tabTo') return tabTo(ctrl, step, selector, fill, timeout, label);

  const deadline = Date.now() + timeout;
  for (;;) {
    const where = await locate(ctrl, selector, {
      frameHint: step.frame, frameText: fill(step.frameText || ''), near: fill(step.near || ''), timeout: Math.max(0, deadline - Date.now()), allowHidden: step.type === 'read', label,
    });
    if (!where) throw new Error(`element niet gevonden: ${selector}`);
    if (step.type === 'waitFor') return;

    const value = fill(step.value);
    const useReal = ctrl.realKeys && (step.type === 'type' || step.type === 'key') && (await cdpAttach(ctrl, where.tabId));
    const res = await sendToFrame(where.tabId, where.frameId, {
      type: 'exec',
      step: { ...step, selector: where.selector, value, realKeys: !!useReal },
    });
    if (!res) throw new Error('pagina reageerde niet (wordt hij herladen?)');
    if (!res.ok) throw new Error(res.error || 'onbekende fout');

    if (res.value && res.value.__clickTag) {
      await clickTagged(where.tabId, where.frameId, res.value.__clickTag);
      return;
    }
    if (res.value && res.value.__real) {
      try {
        if (step.type === 'key') await cdpKey(where.tabId, value || 'Enter');
        else if (value === '') { if (res.value.hadValue) await cdpKey(where.tabId, 'Backspace'); }
        else await cdpText(where.tabId, value);
        return;
      } catch (e) {
        // Terugvallen op nagebootste invoer
        ctrl.realKeys = false;
        ctrl.cdpError = e.message;
        const r2 = await sendToFrame(where.tabId, where.frameId, { type: 'exec', step: { ...step, selector: where.selector, value, realKeys: false } });
        if (!r2 || !r2.ok) throw new Error(r2?.error || 'invoer mislukt');
        return;
      }
    }
    if (step.type === 'read') {
      let v = res.value ?? '';
      if (step.pattern) {
        let m = null;
        try { m = String(v).match(new RegExp(step.pattern)); } catch { throw new Error(`ongeldig patroon: ${step.pattern}`); }
        if (!m) {
          if (Date.now() < deadline && !ctrl.stopped) { await sleep(400); continue; } // waarde nog niet zoals verwacht: opnieuw proberen
          throw new Error(`waarde "${String(v).slice(0, 60)}" past niet bij patroon ${step.pattern}`);
        }
        v = m[1] ?? m[0];
      }
      if (step.variable) vars[step.variable] = v;
    }
    return;
  }
}

async function runMacro(tabId, macroId, extraVars = {}, source = 'handmatig') {
  if (running.has(tabId) || ctrlForTab(tabId)) throw new Error('Er loopt al een handeling in dit tabblad.');
  if (await getRecording()) throw new Error('Stop eerst de opname.');

  const { macros, settings } = await BA.loadConfig();
  const macro = macros.find((m) => m.id === macroId);
  if (!macro) throw new Error('Handeling niet gevonden.');

  const ctrl = { macroId, macroName: macro.name, stopped: false, tabs: [tabId], progress: '', realKeys: !!macro.realKeys };
  running.set(tabId, ctrl);
  setBadge(tabId, '▶', '#1565c0');

  const vars = { ...BA.builtinVars() };
  for (const inp of macro.inputs) if (inp.name) vars[inp.name] = BA.fillTemplate(inp.default ?? '', vars);
  Object.assign(vars, extraVars);

  const delay = Number(macro.stepDelay ?? settings.stepDelay) || 0;
  const started = Date.now();
  const total = macro.steps.length;
  let error = null;
  let stepNr = 0;

  try {
    for (let i = 0; i < total; i++) {
      const step = macro.steps[i];
      stepNr = i + 1;
      if (ctrl.stopped) throw new Error('gestopt door gebruiker');
      if (step.disabled) continue;
      if (step.when && !(await checkWhen(ctrl, step.when, vars))) continue;
      const typeLabel = BA.STEP_TYPES[step.type]?.label || step.type;
      const label = `▶ ${macro.name} — stap ${stepNr}/${total}: ${typeLabel}`;
      const detail = [BA.fillTemplate(step.selector || '', vars), BA.STEP_TYPES[step.type]?.value ? BA.fillTemplate(step.value ?? '', vars) : '']
        .filter(Boolean).join(' → ');
      showProgress(ctrl, detail ? `${label} (${detail})` : label);
      try {
        const r = await runStep(ctrl, step, vars, settings, label);
        if (r === 'stop') break;
      } catch (e) {
        if (step.optional) continue;
        throw new Error(`stap ${stepNr} (${typeLabel}): ${e.message}`);
      }
      if (delay && i < total - 1) await sleep(delay);
    }
    showProgress(ctrl, '');
    toastAll(ctrl, `✔ "${macro.name}" is uitgevoerd`, 'ok');
  } catch (e) {
    error = e.message;
    showProgress(ctrl, '');
    toastAll(ctrl, `✖ "${macro.name}" mislukt — ${e.message}`, 'error');
  } finally {
    await cdpDetachAll(ctrl);
    running.delete(tabId);
    setBadge(tabId, '');
    await addLog({
      macro: macro.name,
      source,
      ok: !error,
      error,
      durationMs: Date.now() - started,
      vars: Object.fromEntries(Object.entries(vars).filter(([k]) => !(k in BA.builtinVars()))),
    });
  }
  return { ok: !error, error };
}

// ---------------------------------------------------------------- opnemen

let recordQueue = Promise.resolve();

function appendRecordedStep(tabId, frameId, frameUrl, step) {
  recordQueue = recordQueue.then(async () => {
    const rec = await getRecording();
    if (!rec || rec.tabId !== tabId) return;
    if (frameId !== 0 && frameUrl) {
      try { step.frame = new URL(frameUrl).pathname; } catch { /* negeer */ }
    }
    const last = rec.steps[rec.steps.length - 1];
    // Opeenvolgende invoer in hetzelfde veld samenvoegen.
    if (last && step.type === 'type' && last.type === 'type' && last.selector === step.selector) {
      last.value = step.value;
    } else {
      rec.steps.push(step);
    }
    await setRecording(rec);
    sendToFrame(tabId, 0, { type: 'recordingState', active: true, count: rec.steps.length });
  });
  return recordQueue;
}

async function broadcastRecording(tabId, active, count = 0) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'recordingState', active, count });
  } catch { /* geen content script */ }
}

// ---------------------------------------------------------------- berichten

async function handleMessage(msg, sender) {
  const senderTab = sender.tab?.id;

  switch (msg.type) {
    case 'getPageInfo': {
      const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
      const { macros } = await BA.loadConfig();
      const rec = await getRecording();
      const { lastPicked } = await chrome.storage.session.get('lastPicked');
      const { log = [] } = await chrome.storage.local.get('log');
      return {
        url: tab?.url || '',
        macros,
        matching: macros.filter((m) => BA.urlMatches(m.urlPattern, tab?.url)).map((m) => m.id),
        recording: rec && rec.tabId === msg.tabId ? { count: rec.steps.length } : null,
        recordingElsewhere: !!(rec && rec.tabId !== msg.tabId),
        running: ctrlForTab(msg.tabId)?.macroId || null,
        progress: ctrlForTab(msg.tabId)?.progress || '',
        lastPicked: lastPicked || null,
        lastRun: log[0] || null,
      };
    }

    case 'runMacro': {
      const tabId = msg.tabId ?? senderTab;
      if (ctrlForTab(tabId)) return { ok: false, error: 'Er loopt al een handeling in dit tabblad.' };
      // Niet afwachten: de popup sluit vaak voordat de handeling klaar is.
      runMacro(tabId, msg.macroId, msg.vars || {}, msg.source || 'handmatig').catch((e) => toast(tabId, '✖ ' + e.message, 'error'));
      return { ok: true };
    }

    case 'stopMacro': {
      const ctrl = ctrlForTab(msg.tabId);
      if (ctrl) ctrl.stopped = true;
      return { ok: true };
    }

    case 'triggerFired': {
      if (ctrlForTab(senderTab) || (await getRecording())) return { ok: false };
      runMacro(senderTab, msg.macroId, msg.vars || {}, 'automatisch').catch(() => {});
      return { ok: true };
    }

    case 'getTriggers': {
      if (await getRecording()) return { triggers: [] };
      const { macros } = await BA.loadConfig();
      const url = sender.tab?.url || '';
      const triggers = [];
      for (const m of macros) {
        if (!BA.urlMatches(m.urlPattern, url)) continue;
        m.triggers.forEach((t, index) => {
          if (t.enabled !== false && t.selector) triggers.push({ ...t, macroId: m.id, macroName: m.name, index });
        });
      }
      return { triggers };
    }

    case 'startRecording': {
      const existing = await getRecording();
      if (existing) return { ok: false, error: 'Er loopt al een opname.' };
      const tab = await chrome.tabs.get(msg.tabId);
      await setRecording({ tabId: msg.tabId, url: tab.url, steps: [] });
      setBadge(msg.tabId, 'REC');
      await broadcastRecording(msg.tabId, true, 0);
      return { ok: true };
    }

    case 'getRecordingState': {
      const rec = await getRecording();
      const active = !!(rec && rec.tabId === senderTab);
      return { active, count: active ? rec.steps.length : 0 };
    }

    case 'recordStep': {
      await appendRecordedStep(senderTab, sender.frameId, sender.url, msg.step);
      return { ok: true };
    }

    case 'stopRecording': {
      await recordQueue;
      const rec = await getRecording();
      await setRecording(null);
      if (!rec) return { ok: false, error: 'Geen opname actief.' };
      setBadge(rec.tabId, '');
      await broadcastRecording(rec.tabId, false);
      if (!msg.save) return { ok: true };
      let pattern = '';
      try {
        const u = new URL(rec.url);
        pattern = `${u.origin}/*`;
      } catch { /* geen geldige url */ }
      const macro = BA.normalizeMacro({
        name: msg.name || `Opname ${new Date().toLocaleString('nl-NL')}`,
        urlPattern: pattern,
        steps: rec.steps,
      });
      const { macros } = await BA.loadConfig();
      macros.push(macro);
      await BA.saveMacros(macros);
      return { ok: true, macroId: macro.id };
    }

    case 'startPicker': {
      await chrome.tabs.sendMessage(msg.tabId, { type: 'startPicker' }).catch(() => {});
      return { ok: true };
    }

    case 'pickerResult': {
      await chrome.tabs.sendMessage(senderTab, { type: 'stopPicker' }).catch(() => {});
      let frame = '';
      if (sender.frameId !== 0 && sender.url) {
        try { frame = new URL(sender.url).pathname; } catch { /* negeer */ }
      }
      const picked = { selector: msg.selector, frame, text: msg.text || '', time: Date.now() };
      await chrome.storage.session.set({ lastPicked: picked });
      toast(senderTab, `Element gekozen (gekopieerd): ${msg.selector}`, 'info');
      return { ok: true };
    }

    case 'pickerCancel': {
      await chrome.tabs.sendMessage(senderTab, { type: 'stopPicker' }).catch(() => {});
      return { ok: true };
    }

    case 'runMacroNow': {
      // Gebruikt door tests: voert uit en wacht op het resultaat.
      return runMacro(msg.tabId, msg.macroId, msg.vars || {}, 'test');
    }
  }
  return undefined;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

// Vaste handelingen (presets) toevoegen bij installatie/update.
// Een verwijderde preset komt niet terug; een nieuwere versie vervangt de oude.
chrome.runtime.onInstalled.addListener(async () => {
  let { presetVersions, presetsInstalled } = await chrome.storage.local.get(['presetVersions', 'presetsInstalled']);
  presetVersions = presetVersions || Object.fromEntries((presetsInstalled || []).map((id) => [id, 1]));
  const { macros } = await BA.loadConfig();
  let changed = false;
  for (const p of PRESETS) {
    const version = p.version || 1;
    const installed = presetVersions[p.id];
    if (installed && installed >= version) continue;
    const idx = macros.findIndex((m) => m.id === p.id);
    const fresh = BA.normalizeMacro(structuredClone(p));
    if (idx >= 0) macros[idx] = fresh;
    else if (!installed) macros.push(fresh); // nieuw: toevoegen; eerder verwijderd: niet terugzetten
    presetVersions[p.id] = version;
    changed = true;
  }
  if (changed) {
    await BA.saveMacros(macros);
    await chrome.storage.local.set({ presetVersions });
  }
});

// Opname netjes beëindigen als het tabblad gesloten wordt.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getRecording();
  if (rec && rec.tabId === tabId) await setRecording(null);
  const ctrl = running.get(tabId);
  if (ctrl) ctrl.stopped = true;
});

// Na installeren/bijwerken: content script direct in open tabbladen laden (dan hoeft BluJay niet herladen te worden).
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/shared.js', 'src/content.js'],
    }).catch(() => { /* bijv. beveiligde pagina */ });
  }
}
chrome.runtime.onInstalled.addListener(() => { injectIntoOpenTabs(); });
