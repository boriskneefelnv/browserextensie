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

/** Zoekt in welk tabblad/frame het element staat. Geeft { tabId, frameId } terug of null. */
async function locate(ctrl, selector, { frameHint, timeout, allowHidden = false, wantGone = false, label = '' }) {
  const started = Date.now();
  const deadline = started + timeout;
  for (;;) {
    let foundIn = null;
    // Nieuwste tabblad (bijv. een net geopend venster) eerst.
    for (const tabId of [...ctrl.tabs].reverse()) {
      let frames = [];
      try {
        frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
      } catch { /* tab weg */ }
      const score = (f) => (frameHint && f.url.includes(frameHint) ? 0 : f.frameId === 0 ? 1 : 2);
      frames.sort((a, b) => score(a) - score(b));
      for (const f of frames) {
        const r = await sendToFrame(tabId, f.frameId, { type: 'probe', selector, allowHidden });
        if (r && r.error) throw new Error(r.error);
        if (r && r.found) { foundIn = { tabId, frameId: f.frameId }; break; }
      }
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

  const where = await locate(ctrl, selector, { frameHint: step.frame, timeout, allowHidden: step.type === 'read', label });
  if (!where) throw new Error(`element niet gevonden: ${selector}`);
  if (step.type === 'waitFor') return;

  const res = await sendToFrame(where.tabId, where.frameId, {
    type: 'exec',
    step: { ...step, selector, value: fill(step.value) },
  });
  if (!res) throw new Error('pagina reageerde niet (wordt hij herladen?)');
  if (!res.ok) throw new Error(res.error || 'onbekende fout');
  if (res.value && res.value.__clickTag) {
    await clickTagged(where.tabId, where.frameId, res.value.__clickTag);
    return;
  }
  if (step.type === 'read' && step.variable) vars[step.variable] = res.value;
}

async function runMacro(tabId, macroId, extraVars = {}, source = 'handmatig') {
  if (running.has(tabId) || ctrlForTab(tabId)) throw new Error('Er loopt al een handeling in dit tabblad.');
  if (await getRecording()) throw new Error('Stop eerst de opname.');

  const { macros, settings } = await BA.loadConfig();
  const macro = macros.find((m) => m.id === macroId);
  if (!macro) throw new Error('Handeling niet gevonden.');

  const ctrl = { macroId, macroName: macro.name, stopped: false, tabs: [tabId], progress: '' };
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
      if (step.when && !BA.evalCondition(step.when, vars)) continue;
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
