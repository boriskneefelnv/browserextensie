/*
 * Content script (draait in elk frame): zoekt elementen, voert stappen uit,
 * neemt handelingen op, element-kiezer en automatische starters.
 */
(() => {
  if (window.__blujayAssistent) return;
  window.__blujayAssistent = true;

  const isTop = window === window.top;
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => undefined);

  // ============================================================ elementen zoeken
  //
  // Ondersteunde selectors:
  //   #id / .klasse / input[name="x"]  -> gewone CSS
  //   text=Opslaan                     -> klikbaar element met precies deze tekst
  //   label=Ordernummer                -> invoerveld dat bij dit label hoort
  //   field=van_periode                -> eerste invulbare veld ná de tekst "van_periode"
  //                                       (ook als die tekst in een alleen-lezen veld staat)
  //   xpath=//div[@id="x"]             -> XPath
  //   ...>>2                           -> het 3e gevonden element (0-geteld)

  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  function ownText(el) {
    if (el instanceof HTMLInputElement) return norm(el.value || el.getAttribute('aria-label'));
    return norm(el.innerText ?? el.textContent);
  }

  const TEXT_CANDIDATES =
    'button, a, input[type=button], input[type=submit], input[type=reset], [role=button], [role=menuitem], ' +
    '[role=option], [role=tab], [role=link], [role=gridcell], label, li, td, th, span, div, option, h1, h2, h3, h4';

  function findByText(text, root = document) {
    const wanted = norm(text).toLowerCase();
    const hits = [...root.querySelectorAll(TEXT_CANDIDATES)].filter((el) => {
      // Goedkope voorselectie (geen layout nodig) voordat innerText wordt opgevraagd.
      if (!(el instanceof HTMLInputElement) && !norm(el.textContent).toLowerCase().includes(wanted)) return false;
      return ownText(el).toLowerCase() === wanted;
    });
    // Alleen het diepste element houden (niet alle ouders met dezelfde tekst).
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  }

  function findByLabel(text, root = document) {
    const wanted = norm(text).toLowerCase().replace(/[:*]\s*$/, '');
    const out = [];
    for (const lab of root.querySelectorAll('label, th, td, span, div')) {
      const t = ownText(lab).toLowerCase().replace(/[:*]\s*$/, '');
      if (t !== wanted || lab.children.length > 3) continue;
      let field = null;
      if (lab.htmlFor) field = root.getElementById?.(lab.htmlFor) || document.getElementById(lab.htmlFor);
      if (!field && lab.control) field = lab.control;
      if (!field) field = lab.querySelector('input, select, textarea');
      if (!field) {
        // Eerstvolgend invoerveld in de pagina na het label.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        walker.currentNode = lab;
        let n;
        while ((n = walker.nextNode())) {
          if (n.matches('input:not([type=hidden]), select, textarea, [contenteditable=true]')) { field = n; break; }
        }
      }
      if (field && !out.includes(field)) out.push(field);
    }
    for (const el of root.querySelectorAll('[aria-label], [placeholder], [title]')) {
      const t = norm(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title')).toLowerCase();
      if (t === wanted && el.matches('input, select, textarea') && !out.includes(el)) out.push(el);
    }
    return out;
  }

  const EDITABLE =
    'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image])' +
    ':not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled]), [contenteditable=true]';

  function directText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.data + ' ';
    return norm(t);
  }

  function findByField(text) {
    const wanted = norm(text).toLowerCase().replace(/[:*]\s*$/, '');
    const anchors = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.matches('script, style, option')) continue;
      let t;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // Alleen-lezen veld als "label" (komt veel voor in terminal-achtige schermen).
        if (!el.readOnly && !el.disabled && el.type !== 'button') continue;
        t = el.value;
      } else {
        t = directText(el);
      }
      if (t && norm(t).toLowerCase().includes(wanted)) anchors.push(el);
    }
    const out = [];
    for (const a of anchors) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      walker.currentNode = a;
      let n;
      while ((n = walker.nextNode())) {
        if (n.matches(EDITABLE) && isVisible(n)) {
          if (!out.includes(n)) out.push(n);
          break;
        }
      }
    }
    return out;
  }

  function findByXPath(xp) {
    const res = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const out = [];
    for (let i = 0; i < res.snapshotLength; i++) out.push(res.snapshotItem(i));
    return out.filter((n) => n.nodeType === 1);
  }

  function findAll(selector) {
    let sel = String(selector || '').trim();
    let index = null;
    const m = sel.match(/^(.*)>>\s*(\d+)$/s);
    if (m) { sel = m[1].trim(); index = Number(m[2]); }
    let list;
    if (sel.startsWith('text=')) list = findByText(sel.slice(5));
    else if (sel.startsWith('label=')) list = findByLabel(sel.slice(6));
    else if (sel.startsWith('field=')) list = findByField(sel.slice(6));
    else if (sel.startsWith('xpath=')) list = findByXPath(sel.slice(6));
    else list = [...document.querySelectorAll(sel)];
    return { list, index };
  }

  /** Geeft het eerste (bij voorkeur zichtbare) element terug. */
  function find(selector, allowHidden = false) {
    const { list, index } = findAll(selector);
    if (index !== null) {
      const visible = list.filter(isVisible);
      const pool = visible.length > index ? visible : list;
      const el = pool[index];
      return el && (allowHidden || isVisible(el)) ? el : null;
    }
    return list.find(isVisible) || (allowHidden ? list[0] : null) || null;
  }

  // ============================================================ selector maken

  const UNSTABLE_ID = /(^ext-)|(^gen\d)|(-\d{3,})|(\d{4,})|(^[0-9])|(^ui-id-)|(^react-)|(^:)|([a-f0-9]{8}-[a-f0-9]{4})/i;

  function unique(sel, el) {
    try {
      return find(sel, true) === el;
    } catch {
      return false;
    }
  }

  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
      if (cur.id && !UNSTABLE_ID.test(cur.id)) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function selectorFor(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !UNSTABLE_ID.test(el.id)) {
      const s = '#' + CSS.escape(el.id);
      if (unique(s, el)) return s;
    }
    const name = el.getAttribute('name');
    if (name && !UNSTABLE_ID.test(name)) {
      let s = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
      if (el.type === 'radio' || el.type === 'checkbox') s = `${tag}[name="${name}"][value="${el.value}"]`;
      if (unique(s, el)) return s;
    }
    const isField = el.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), select, textarea');
    if (isField) {
      for (const attr of ['aria-label', 'placeholder', 'title']) {
        const v = el.getAttribute(attr);
        if (v && v.length < 60) {
          const s = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
          if (unique(s, el)) return s;
        }
      }
      // Via het zichtbare label
      const labelText = el.labels?.[0] ? ownText(el.labels[0]) : '';
      if (labelText && labelText.length < 60 && unique('label=' + labelText, el)) return 'label=' + labelText;
    } else {
      const text = ownText(el);
      if (text && text.length <= 50) {
        const s = 'text=' + text;
        if (unique(s, el)) return s;
        const { list } = findAll(s);
        const visible = list.filter(isVisible);
        const i = visible.indexOf(el);
        if (i >= 0) return `${s} >> ${i}`;
      }
      for (const attr of ['aria-label', 'title', 'data-qtip', 'alt']) {
        const v = el.getAttribute(attr);
        if (v && v.length < 60) {
          const s = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
          if (unique(s, el)) return s;
        }
      }
    }
    return cssPath(el);
  }

  // ============================================================ uitvoeren

  function flash(el) {
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '3px solid #ff9800';
    el.style.outlineOffset = '1px';
    setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, 500);
  }

  function mouse(el, type) {
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, composed: true, view: window, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    };
    const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, opts));
  }

  function doClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    mouse(el, 'pointerdown');
    mouse(el, 'mousedown');
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    mouse(el, 'pointerup');
    mouse(el, 'mouseup');
    mouse(el, 'click');
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, value);
  }

  const KEYCODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, ' ': 32, F2: 113, F5: 116 };

  function key(el, keyName, type) {
    const code = KEYCODES[keyName] ?? (keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 0);
    const ev = new KeyboardEvent(type, {
      key: keyName,
      code: keyName.length === 1 ? 'Key' + keyName.toUpperCase() : keyName,
      keyCode: code, which: code, charCode: type === 'keypress' ? code : 0,
      bubbles: true, cancelable: true, composed: true,
    });
    return el.dispatchEvent(ev);
  }

  function focusNext(el) {
    const all = [...document.querySelectorAll('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(isVisible);
    const i = all.indexOf(el);
    const next = all[i + 1];
    if (typeof el.blur === 'function') el.blur();
    if (next) next.focus();
  }

  function pressKey(el, keyName) {
    const name = { enter: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', spatie: ' ', space: ' ' }[keyName.toLowerCase()] || keyName;
    if (typeof el.focus === 'function') el.focus();
    const notPrevented = key(el, name, 'keydown');
    if (name === 'Enter' || name.length === 1) key(el, name, 'keypress');
    key(el, name, 'keyup');
    if (name === 'Tab' && notPrevented) focusNext(el);
  }

  async function typeText(el, value, slow) {
    el.scrollIntoView({ block: 'center' });
    if (typeof el.focus === 'function') el.focus();
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      return;
    }
    if (slow) {
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      for (const ch of value) {
        key(el, ch, 'keydown');
        key(el, ch, 'keypress');
        setNativeValue(el, el.value + ch);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
        key(el, ch, 'keyup');
        await new Promise((r) => setTimeout(r, 40));
      }
    } else {
      setNativeValue(el, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      key(el, 'Unidentified', 'keyup');
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectOption(el, value) {
    if (!(el instanceof HTMLSelectElement)) {
      throw new Error('dit is geen standaard keuzelijst; gebruik "Typ tekst" of "Klik" op de optie');
    }
    const wanted = norm(value).toLowerCase();
    const opts = [...el.options];
    const opt =
      opts.find((o) => norm(o.text).toLowerCase() === wanted) ||
      opts.find((o) => String(o.value).toLowerCase() === wanted) ||
      opts.find((o) => norm(o.text).toLowerCase().includes(wanted));
    if (!opt) throw new Error(`optie "${value}" niet gevonden`);
    el.focus();
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function readValue(el) {
    if (el instanceof HTMLSelectElement) return norm(el.options[el.selectedIndex]?.text);
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked ? 'aan' : 'uit';
    if ('value' in el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return el.value;
    return norm(el.innerText ?? el.textContent);
  }

  async function exec(step) {
    const el = find(step.selector, step.type === 'read');
    if (!el) throw new Error(`element niet gevonden: ${step.selector}`);
    if (step.type !== 'read') flash(el);
    switch (step.type) {
      case 'click':
        doClick(el);
        return;
      case 'type':
        await typeText(el, step.value ?? '', !!step.slow);
        return;
      case 'select':
        selectOption(el, step.value);
        return;
      case 'check': {
        const want = !/^(uit|nee|false|0|off|no)$/i.test(String(step.value || 'aan').trim());
        if (!!el.checked !== want) doClick(el);
        return;
      }
      case 'key':
        pressKey(el, step.value || 'Enter');
        return;
      case 'read':
        return readValue(el);
    }
    throw new Error(`onbekende stap: ${step.type}`);
  }

  // ============================================================ opnemen

  let recording = false;
  let ignoreClickOn = null;
  const lastTyped = new Map();

  const isOwnUi = (el) => !!el?.closest?.('[data-blujay-assistent]');
  const isTextField = (el) =>
    el.matches?.('textarea, [contenteditable=true], input:not([type]), input[type=text], input[type=search], input[type=email], input[type=number], input[type=tel], input[type=url], input[type=date], input[type=datetime-local], input[type=time], input[type=password]');

  function record(step) {
    send({ type: 'recordStep', step });
  }

  function onRecClick(e) {
    if (!recording || !e.isTrusted || isOwnUi(e.target)) return;
    let el = e.target;
    if (!(el instanceof Element)) return;
    if (el === ignoreClickOn) { ignoreClickOn = null; return; }
    if (isTextField(el) || el.matches('select, option')) return;
    const lab = el.closest('label');
    if (lab && lab.control && !lab.contains(el.closest('input'))) {
      // Klik op label = klik op het bijbehorende veld
      el = lab.control;
      ignoreClickOn = el;
      setTimeout(() => { ignoreClickOn = null; }, 200);
      if (isTextField(el) || el.matches('select')) return;
    } else {
      el =
        el.closest('button, a, input, [role=button], [role=menuitem], [role=option], [role=tab], [role=checkbox], [role=gridcell], li, td, th') ||
        el;
    }
    record({ type: 'click', selector: selectorFor(el) });
  }

  function onRecChange(e) {
    if (!recording || !e.isTrusted || isOwnUi(e.target)) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el instanceof HTMLSelectElement) {
      record({ type: 'select', selector: selectorFor(el), value: norm(el.options[el.selectedIndex]?.text) });
      return;
    }
    if (el.type === 'password') return; // wachtwoorden nooit opslaan
    if (isTextField(el)) {
      const selector = selectorFor(el);
      if (lastTyped.get(selector) === el.value) return;
      lastTyped.set(selector, el.value);
      record({ type: 'type', selector, value: el.value });
    }
  }

  function onRecKeydown(e) {
    if (!recording || !e.isTrusted || isOwnUi(e.target)) return;
    const el = e.target;
    if (!(el instanceof Element) || !isTextField(el)) return;
    if (!['Enter', 'Tab', 'Escape'].includes(e.key)) return;
    if (el.type === 'password') return;
    const selector = selectorFor(el);
    if (lastTyped.get(selector) !== el.value && 'value' in el) {
      lastTyped.set(selector, el.value);
      record({ type: 'type', selector, value: el.value });
    }
    if (e.key === 'Enter' || e.key === 'Escape') record({ type: 'key', selector, value: e.key });
  }

  function setRecording(active, count) {
    recording = active;
    if (isTop) ui.recIndicator(active, count);
  }

  document.addEventListener('click', onRecClick, true);
  document.addEventListener('change', onRecChange, true);
  document.addEventListener('keydown', onRecKeydown, true);

  // ============================================================ element kiezen

  let picking = false;
  let hoverBox = null;

  function pickerHover(e) {
    if (!picking || isOwnUi(e.target)) return;
    const r = e.target.getBoundingClientRect();
    if (!hoverBox) {
      hoverBox = document.createElement('div');
      hoverBox.setAttribute('data-blujay-assistent', '');
      Object.assign(hoverBox.style, {
        position: 'fixed', zIndex: 2147483646, pointerEvents: 'none',
        border: '2px solid #ff9800', background: 'rgba(255,152,0,.15)', borderRadius: '2px',
      });
      document.documentElement.appendChild(hoverBox);
    }
    Object.assign(hoverBox.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  function copyText(text) {
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }

  function pickerClick(e) {
    if (!picking || isOwnUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = e.target;
    const selector = selectorFor(el);
    copyText(selector);
    send({ type: 'pickerResult', selector, text: ownText(el).slice(0, 80) });
  }

  function pickerKey(e) {
    if (picking && e.key === 'Escape') send({ type: 'pickerCancel' });
  }

  function stopPicker() {
    picking = false;
    hoverBox?.remove();
    hoverBox = null;
    document.documentElement.style.cursor = '';
  }

  document.addEventListener('mouseover', pickerHover, true);
  document.addEventListener('click', pickerClick, true);
  document.addEventListener('mousedown', (e) => { if (picking && !isOwnUi(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('keydown', pickerKey, true);

  // ============================================================ automatische starters

  let triggers = [];
  const firedAppear = new Map(); // trigger key -> WeakSet van elementen
  let observer = null;
  let appearTimer = null;

  function fire(t, value) {
    if (t.confirm && !window.confirm(`Handeling "${t.macroName}" uitvoeren?\n\nWaarde: ${value}`)) return;
    send({ type: 'triggerFired', macroId: t.macroId, vars: { waarde: value } });
  }

  function onTriggerChange(e) {
    if (!e.isTrusted || recording) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    for (const t of triggers) {
      if (t.type !== 'change') continue;
      let list = [];
      try { list = findAll(t.selector).list; } catch { continue; }
      if (!list.includes(el)) continue;
      const value = readValue(el);
      if (BA.checkTriggerCondition(t, value)) fire(t, value);
    }
  }

  function scanAppear() {
    for (const t of triggers) {
      if (t.type !== 'appear') continue;
      const k = `${t.macroId}#${t.index}`;
      if (!firedAppear.has(k)) firedAppear.set(k, new WeakSet());
      const seen = firedAppear.get(k);
      let list = [];
      try { list = findAll(t.selector).list.filter(isVisible); } catch { continue; }
      for (const el of list) {
        if (seen.has(el)) continue;
        seen.add(el);
        const value = readValue(el);
        if (BA.checkTriggerCondition(t, value)) { fire(t, value); break; }
      }
    }
  }

  async function loadTriggers() {
    const res = await send({ type: 'getTriggers' });
    triggers = res?.triggers || [];
    if (triggers.some((t) => t.type === 'appear')) {
      if (!observer) {
        observer = new MutationObserver(() => {
          clearTimeout(appearTimer);
          appearTimer = setTimeout(scanAppear, 300);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
      scanAppear();
    } else if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  document.addEventListener('change', onTriggerChange, true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.macros) loadTriggers();
  });

  // ============================================================ meldingen (alleen bovenste frame)

  const ui = (() => {
    let host, shadow, box, rec;
    function ensure() {
      if (host) return;
      host = document.createElement('div');
      host.setAttribute('data-blujay-assistent', '');
      Object.assign(host.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647 });
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .wrap { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; font: 13px/1.4 system-ui, sans-serif; }
          .t { max-width: 420px; padding: 10px 14px; border-radius: 8px; color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.25); word-break: break-word; }
          .info { background: #1565c0; } .ok { background: #2e7d32; } .error { background: #c62828; }
          .rec { background: #fff; color: #c62828; border: 2px solid #c62828; padding: 6px 12px; border-radius: 999px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
          .dot { display: inline-block; width: 9px; height: 9px; background: #c62828; border-radius: 50%; margin-right: 6px; animation: b 1s infinite; }
          @keyframes b { 50% { opacity: .2; } }
        </style>
        <div class="wrap"></div>`;
      box = shadow.querySelector('.wrap');
      document.documentElement.appendChild(host);
    }
    return {
      toast(text, kind = 'info') {
        ensure();
        const d = document.createElement('div');
        d.className = 't ' + kind;
        d.textContent = text;
        box.prepend(d);
        setTimeout(() => d.remove(), kind === 'error' ? 10000 : 4000);
      },
      recIndicator(active, count) {
        if (!active) { rec?.remove(); rec = null; return; }
        ensure();
        if (!rec) {
          rec = document.createElement('div');
          rec.className = 'rec';
          box.append(rec);
        }
        rec.innerHTML = `<span class="dot"></span>Opname loopt — ${count || 0} stap(pen)`;
      },
    };
  })();

  // ============================================================ berichten

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'probe': {
        try {
          const el = find(msg.selector, msg.allowHidden);
          sendResponse({ found: !!el });
        } catch (e) {
          sendResponse({ found: false, error: `ongeldige selector "${msg.selector}": ${e.message}` });
        }
        return false;
      }
      case 'exec':
        exec(msg.step).then(
          (value) => sendResponse({ ok: true, value }),
          (e) => sendResponse({ ok: false, error: e.message })
        );
        return true;
      case 'toast':
        if (isTop) ui.toast(msg.text, msg.kind);
        return false;
      case 'recordingState':
        setRecording(msg.active, msg.count);
        if (!msg.active) loadTriggers();
        else triggers = [];
        return false;
      case 'startPicker':
        picking = true;
        document.documentElement.style.cursor = 'crosshair';
        if (isTop) ui.toast('Klik op het element dat je wilt kiezen (Esc = annuleren)', 'info');
        return false;
      case 'stopPicker':
        stopPicker();
        return false;
    }
    return false;
  });

  // ============================================================ start

  send({ type: 'getRecordingState' }).then((r) => {
    if (r?.active) setRecording(true, r.count);
    else loadTriggers();
  });
})();
