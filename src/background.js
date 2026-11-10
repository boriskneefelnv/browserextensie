/*
 * Service worker: bewaart opnames, voert handelingen stap voor stap uit
 * (over alle frames van het tabblad) en verwerkt automatische starters.
 */
importScripts('shared.js', 'presets.js');

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

/** Zoekt in welk frame het element staat. Geeft frameId terug of null. */
async function locate(tabId, selector, { frameHint, timeout, ctrl, allowHidden = false, wantGone = false }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let frames = [];
    try {
      frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
    } catch { /* tab weg */ }
    const score = (f) => (frameHint && f.url.includes(frameHint) ? 0 : f.frameId === 0 ? 1 : 2);
    frames.sort((a, b) => score(a) - score(b));

    let foundIn = null;
    for (const f of frames) {
      const r = await sendToFrame(tabId, f.frameId, { type: 'probe', selector, allowHidden });
      if (r && r.error) throw new Error(r.error);
      if (r && r.found) { foundIn = f.frameId; break; }
    }
    if (!wantGone && foundIn !== null) return foundIn;
    if (wantGone && foundIn === null) return true;
    if (ctrl.stopped) throw new Error('gestopt door gebruiker');
    if (Date.now() > deadline) return wantGone ? false : null;
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

async function runStep(tabId, step, vars, settings, ctrl) {
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
      toast(tabId, fill(step.value), 'info');
      return;
    case 'navigate': {
      const url = fill(step.value);
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
    const gone = await locate(tabId, selector, { frameHint: step.frame, timeout: Math.max(timeout, 30000), ctrl, wantGone: true });
    if (!gone) throw new Error(`element verdwijnt niet: ${selector}`);
    return;
  }

  const frameId = await locate(tabId, selector, {
    frameHint: step.frame,
    timeout,
    ctrl,
    allowHidden: step.type === 'read',
  });
  if (frameId === null) throw new Error(`element niet gevonden: ${selector}`);
  if (step.type === 'waitFor') return;

  const res = await sendToFrame(tabId, frameId, {
    type: 'exec',
    step: { ...step, selector, value: fill(step.value) },
  });
  if (!res) throw new Error('pagina reageerde niet (wordt hij herladen?)');
  if (!res.ok) throw new Error(res.error || 'onbekende fout');
  if (step.type === 'read' && step.variable) vars[step.variable] = res.value;
}

async function runMacro(tabId, macroId, extraVars = {}, source = 'handmatig') {
  if (running.has(tabId)) throw new Error('Er loopt al een handeling in dit tabblad.');
  if (await getRecording()) throw new Error('Stop eerst de opname.');

  const { macros, settings } = await BA.loadConfig();
  const macro = macros.find((m) => m.id === macroId);
  if (!macro) throw new Error('Handeling niet gevonden.');

  const ctrl = { macroId, stopped: false };
  running.set(tabId, ctrl);
  setBadge(tabId, '▶', '#1565c0');

  const vars = { ...BA.builtinVars() };
  for (const inp of macro.inputs) if (inp.name) vars[inp.name] = inp.default ?? '';
  Object.assign(vars, extraVars);

  const delay = Number(macro.stepDelay ?? settings.stepDelay) || 0;
  const started = Date.now();
  let error = null;
  let stepNr = 0;

  try {
    for (let i = 0; i < macro.steps.length; i++) {
      const step = macro.steps[i];
      stepNr = i + 1;
      if (ctrl.stopped) throw new Error('gestopt door gebruiker');
      if (step.disabled) continue;
      if (step.when && !BA.evalCondition(step.when, vars)) continue;
      try {
        const r = await runStep(tabId, step, vars, settings, ctrl);
        if (r === 'stop') break;
      } catch (e) {
        if (step.optional) continue;
        const label = BA.STEP_TYPES[step.type]?.label || step.type;
        throw new Error(`stap ${stepNr} (${label}): ${e.message}`);
      }
      if (delay && i < macro.steps.length - 1) await sleep(delay);
    }
    toast(tabId, `✔ "${macro.name}" is uitgevoerd`, 'ok');
  } catch (e) {
    error = e.message;
    toast(tabId, `✖ "${macro.name}" mislukt — ${e.message}`, 'error');
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
      return {
        url: tab?.url || '',
        macros,
        matching: macros.filter((m) => BA.urlMatches(m.urlPattern, tab?.url)).map((m) => m.id),
        recording: rec && rec.tabId === msg.tabId ? { count: rec.steps.length } : null,
        recordingElsewhere: !!(rec && rec.tabId !== msg.tabId),
        running: running.has(msg.tabId) ? running.get(msg.tabId).macroId : null,
        lastPicked: lastPicked || null,
      };
    }

    case 'runMacro': {
      const tabId = msg.tabId ?? senderTab;
      if (running.has(tabId)) return { ok: false, error: 'Er loopt al een handeling in dit tabblad.' };
      // Niet afwachten: de popup sluit vaak voordat de handeling klaar is.
      runMacro(tabId, msg.macroId, msg.vars || {}, msg.source || 'handmatig').catch((e) => toast(tabId, '✖ ' + e.message, 'error'));
      return { ok: true };
    }

    case 'stopMacro': {
      const ctrl = running.get(msg.tabId);
      if (ctrl) ctrl.stopped = true;
      return { ok: true };
    }

    case 'triggerFired': {
      if (running.has(senderTab) || (await getRecording())) return { ok: false };
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
