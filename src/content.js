/*
 * Content script (draait in elk frame): zoekt elementen, voert stappen uit,
 * neemt handelingen op, element-kiezer en automatische starters.
 */
(() => {
  // Niet dubbel laden — tenzij de vorige versie van de extensie niet meer bestaat (na update/herladen).
  if (window.__blujayAssistentAlive && window.__blujayAssistentAlive()) return;
  window.__blujayAssistentAlive = () => {
    try { return !!chrome.runtime?.id; } catch { return false; }
  };

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
  //   contains=Akkoord                 -> element waarvan de tekst "Akkoord" bevat
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

  // Pijltjes/tekens aan begin en eind negeren ("Menu ▾", "Omschrijvingen ▸", "» Uitslag").
  const core = (s) => norm(s).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)]+$/gu, '');

  function findByText(text, root = document) {
    const wanted = core(text);
    if (!wanted) return [];
    const hits = [...root.querySelectorAll(TEXT_CANDIDATES)].filter((el) => {
      // Goedkope voorselectie (geen layout nodig) voordat innerText wordt opgevraagd.
      if (!(el instanceof HTMLInputElement) && !norm(el.textContent).toLowerCase().includes(wanted)) return false;
      return core(ownText(el)) === wanted || (!(el instanceof HTMLInputElement) && core(directText(el)) === wanted);
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

  /** Elementen waarvan de eigen tekst (of de waarde van een alleen-lezen veld) de tekst bevat. */
  function findTextAnchors(text) {
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
    return anchors;
  }

  /** Rechthoek van de labeltekst zelf (niet van een brede tabelcel eromheen). */
  function labelRect(a, wantedLower) {
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return a.getBoundingClientRect();
    for (const n of a.childNodes) {
      if (n.nodeType === 3 && norm(n.data).toLowerCase().includes(wantedLower)) {
        const r = document.createRange();
        r.selectNodeContents(n);
        const rr = r.getBoundingClientRect();
        if (rr.width) return rr;
      }
    }
    return a.getBoundingClientRect();
  }

  /** Rechthoek van zichtbare tekst in een element (of van een alleen-lezen veld met waarde). */
  function textRect(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return (el.readOnly || el.disabled) && el.value ? el.getBoundingClientRect() : null;
    }
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && norm(n.data)) {
        const r = document.createRange();
        r.selectNodeContents(n);
        const rr = r.getBoundingClientRect();
        if (rr.width) return rr;
      }
    }
    return null;
  }

  /**
   * Invulvelden RECHTS NAAST het label op dezelfde regel (zoals je ze op het scherm ziet),
   * tot aan de volgende tekst op die regel (bijv. "Laaddatum [datum] [van] [tot] | Losadres").
   */
  function fieldsRightOf(a, wantedLower) {
    const L = labelRect(a, wantedLower);
    if (!L.height) return [];
    const cy = L.top + L.height / 2;
    const sameLine = (r) => r && r.height > 0 && Math.abs(r.top + r.height / 2 - cy) <= Math.max(L.height, r.height) / 2 + 1;
    let boundary = Infinity;
    for (const el of document.querySelectorAll('body *')) {
      if (el === a || el.contains(a) || el.matches('script, style, option, select, textarea, button')) continue;
      const r = textRect(el);
      if (sameLine(r) && r.left >= L.right + 1 && r.left < boundary) boundary = r.left;
    }
    return [...document.querySelectorAll(EDITABLE)]
      .filter(isVisible)
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => sameLine(r) && r.left >= L.right - 2 && r.left < boundary)
      .sort((x, y) => x.r.left - y.r.left)
      .map(({ e }) => e);
  }

  /**
   * field=Laaddatum → het invulveld rechts naast "Laaddatum"; field=Laaddatum [2] → het 2e (bijv. begintijd).
   * Staat er niets rechts naast, dan het eerstvolgende veld in de pagina.
   */
  function findByField(text) {
    let nth = 1;
    const m = text.match(/^(.*?)\s*\[(\d+)\]\s*$/);
    if (m) { text = m[1]; nth = Math.max(1, Number(m[2])); }
    const out = [];
    // Alleen zichtbare labels; een label dat precies de tekst is gaat voor ("Opdrachtgever" vóór "Master opdrachtgever").
    const wanted = core(text);
    const wantedLower = norm(text).toLowerCase().replace(/[:*]\s*$/, '');
    const anchors = findTextAnchors(text).filter(isVisible);
    const exact = (a) => core(a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement ? a.value : directText(a)).replace(/^\d+\s+/, '') === wanted;
    anchors.sort((a, b) => exact(b) - exact(a));
    for (const a of anchors) {
      const right = fieldsRightOf(a, wantedLower);
      if (right.length >= nth) {
        if (!out.includes(right[nth - 1])) out.push(right[nth - 1]);
        continue;
      }
      if (right.length) continue; // er staan wel velden naast, maar niet genoeg: niet gokken
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      walker.currentNode = a;
      let n;
      let count = 0;
      while ((n = walker.nextNode())) {
        if (n.matches(EDITABLE) && isVisible(n) && ++count === nth) {
          if (!out.includes(n)) out.push(n);
          break;
        }
      }
    }
    return out;
  }

  const focusIds = new WeakMap();
  let focusSeq = 0;

  // Wanneer werd in dit frame voor het laatst een veld actief? (om tussen frames het juiste te kiezen)
  let lastFocusAt = 0;
  document.addEventListener('focusin', () => { lastFocusAt = Date.now(); }, true);

  /** Element met de cursor, ook als het een alleen-lezen veld of knop is. */
  /**
   * BluJay zet de cursor na elke Tab heel even in een onzichtbaar vakje (1x1 pixel) voordat het volgende
   * veld actief wordt. Zulke "tussenvakjes" tellen niet als veld.
   */
  function isTiny(el) {
    const r = el.getBoundingClientRect();
    return r.width < 4 || r.height < 4;
  }

  function findFocusedAny() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement || /^(IFRAME|FRAME)$/.test(el.tagName) || isTiny(el)) return [];
    return [el];
  }

  /** Het veld waar de cursor nu staat (in dit frame). */
  function findFocused() {
    const el = document.activeElement;
    if (!el || !el.matches(EDITABLE) || isTiny(el)) return [];
    return [el];
  }

  const alnum = (s) => norm(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  /** focus:Referentie → het actieve veld, maar alleen als het label links ervan "Referentie" is. */
  function findFocusedWithLabel(text) {
    const [el] = findFocusedAny();
    if (!el) return [];
    return alnum(labelFor(el)) === alnum(text) ? [el] : [];
  }

  /**
   * box=Zending → het vakje rechts naast het label (ook als het geen invoerveld is, zoals in BluJay
   * waar een veld pas een invoerveld wordt als je erop klikt). box=Laaddatum [2] → het 2e vakje.
   */
  function findBoxes(text) {
    let nth = 1;
    const m = text.match(/^(.*?)\s*\[(\d+)\]\s*$/);
    if (m) { text = m[1]; nth = Math.max(1, Number(m[2])); }
    const wanted = core(text);
    const wantedLower = norm(text).toLowerCase().replace(/[:*]\s*$/, '');
    const anchors = findTextAnchors(text).filter(isVisible);
    const exact = (a) => core(a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement ? a.value : directText(a)) === wanted;
    anchors.sort((a, b) => exact(b) - exact(a));
    for (const a of anchors) {
      const L = labelRect(a, wantedLower);
      if (!L.height) continue;
      const cy = L.top + L.height / 2;
      const boxes = [...document.querySelectorAll('body *')]
        .filter((e) => e !== a && !e.contains(a) && !a.contains(e) && !e.closest('[data-blujay-assistent]')
          && (e.children.length === 0 || e.matches('input, select, textarea')) && isVisible(e))
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width >= 6 && r.height >= 6 && r.left >= L.right - 2
          && Math.abs(r.top + r.height / 2 - cy) <= Math.max(L.height, r.height) / 2 + 1)
        .sort((x, y) => x.r.left - y.r.left);
      if (boxes.length >= nth) return [boxes[nth - 1].e];
    }
    return [];
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
    if (/^(focus|actief veld|cursor)$/i.test(sel)) list = findFocused();
    else if (sel === 'focus-any') list = findFocusedAny();
    else if (sel.startsWith('text=')) list = findByText(sel.slice(5));
    else if (sel.startsWith('label=')) list = findByLabel(sel.slice(6));
    else if (sel.startsWith('field=')) list = findByField(sel.slice(6));
    else if (sel.startsWith('focus:')) list = findFocusedWithLabel(sel.slice(6));
    else if (sel.startsWith('box=')) list = findBoxes(sel.slice(4));
    else if (sel.startsWith('contains=')) list = findTextAnchors(sel.slice(9));
    else if (sel.startsWith('xpath=')) list = findByXPath(sel.slice(6));
    else list = [...document.querySelectorAll(sel)];
    return { list, index };
  }

  /** Geeft het eerste (bij voorkeur zichtbare) element terug. */
  function find(selector, allowHidden = false, near = '') {
    let { list, index } = findAll(selector);
    if (near) {
      // Kies het element dat het dichtst bij de tekst "near" staat (bijv. Menu naast Artikelregels).
      const anchors = findTextAnchors(near).filter(isVisible);
      if (!anchors.length) return null;
      const center = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      const dist = (e) => {
        const [x, y] = center(e);
        return Math.min(...anchors.map((a) => { const [ax, ay] = center(a); return Math.hypot(ax - x, ay - y); }));
      };
      list = list.filter(isVisible).sort((a, b) => dist(a) - dist(b));
    }
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

  /** Zet de cursor in het veld (en selecteert de inhoud) zodat de achtergrond echte toetsaanslagen kan sturen. */
  function focusForKeys(el, selectAll) {
    el.scrollIntoView({ block: 'center' });
    if (document.activeElement !== el && typeof el.focus === 'function') el.focus();
    if (selectAll) {
      if (typeof el.select === 'function') el.select();
      else if (el.isContentEditable) document.getSelection()?.selectAllChildren(el);
    }
    return { __real: true, focused: document.activeElement === el, hadValue: 'value' in el ? el.value !== '' : !!el.textContent };
  }

  async function exec(step) {
    if (step.type === 'read' && step.pattern) {
      let re = null;
      try { re = new RegExp(step.pattern); } catch { /* achtergrond meldt dit */ }
      const { list } = findAll(step.selector);
      const ordered = [...list.filter(isVisible), ...list.filter((e) => !isVisible(e))];
      const hit = re && ordered.find((e) => re.test(readValue(e)));
      if (hit) return readValue(hit);
    }
    const el = find(step.selector, step.type === 'read', step.near);
    if (!el) throw new Error(`element niet gevonden: ${step.selector}`);
    if (step.type !== 'read') flash(el);
    switch (step.type) {
      case 'click': {
        // De klik zelf gebeurt via de achtergrond in de pagina-context ("MAIN world"),
        // zodat ook links met href="javascript:..." werken. Hier alleen markeren.
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const tag = Math.random().toString(36).slice(2);
        el.setAttribute('data-ba-click', tag);
        setTimeout(() => el.removeAttribute('data-ba-click'), 5000);
        return { __clickTag: tag };
      }
      case 'type':
        if (step.realKeys) return focusForKeys(el, true);
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
        if (step.realKeys) return focusForKeys(el, false);
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

  // ============================================================ schermopbouw

  /** Opbouw van het zichtbare scherm (teksten en velden met positie), om bij problemen mee te sturen. */
  function screenDump(maxLines = 600) {
    const items = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[data-blujay-assistent]') || !isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (el.matches('input, select, textarea, button, [contenteditable=true]')) {
        const v = el instanceof HTMLSelectElement ? el.options[el.selectedIndex]?.text : el.type === 'password' ? '***' : el.value;
        items.push({ y: r.top, x: r.left, s: `${el === document.activeElement ? '► ' : ''}[${el.tagName.toLowerCase()}${el.type ? ' ' + el.type : ''}] name=${el.name || '-'} id=${el.id || '-'} tab=${el.tabIndex}${el.readOnly ? ' alleen-lezen' : ''}${el.disabled ? ' uit' : ''}${el.type === 'checkbox' ? (el.checked ? ' AAN' : ' UIT') : ''} ${Math.round(r.width)}x${Math.round(r.height)} waarde="${String(v ?? '').slice(0, 40)}"` });
      } else {
        const t = directText(el);
        if (t) items.push({ y: r.top, x: r.left, s: `"${t.slice(0, 50)}" <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}>` });
      }
    }
    if (!items.length) return { text: '' };
    items.sort((a, b) => Math.round(a.y / 5) - Math.round(b.y / 5) || a.x - b.x);
    const a = document.activeElement;
    const head = `actief element: ${a ? a.tagName.toLowerCase() + (a.name ? ' name=' + a.name : '') + (a.id ? ' id=' + a.id : '') : '-'}`;
    return { hasFocus: document.hasFocus(), text: head + '\n' + items.slice(0, maxLines).map((i) => `${Math.round(i.y)},${Math.round(i.x)}  ${i.s}`).join('\n') };
  }

  // ============================================================ nauwkeurige opname (diagnose)
  //
  // Legt elke toets, klik, cursorverplaatsing, waardewijziging en paginalading vast, met het veld
  // waar het om gaat (naam, label ernaast, waarde, positie). Bedoeld om BluJay-schermen te analyseren.

  let diag = false;
  let diagBuf = [];
  let diagTimer = null;

  /** Tekst die links op dezelfde regel staat (het label), anders de laatste tekst ervoor. */
  function labelFor(el) {
    const r = el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    let best = null;
    let bestDx = Infinity;
    for (const t of document.querySelectorAll('body *')) {
      if (t === el || t.contains(el) || el.contains(t) || t.closest('[data-blujay-assistent]')) continue;
      const tr = textRect(t);
      if (!tr || Math.abs(tr.top + tr.height / 2 - cy) > Math.max(tr.height, r.height) / 2 + 1) continue;
      const dx = r.left - tr.right;
      if (dx >= -2 && dx < bestDx) { bestDx = dx; best = t; }
    }
    if (best) {
      const v = best instanceof HTMLInputElement || best instanceof HTMLTextAreaElement ? best.value : directText(best);
      return norm(v).slice(0, 40);
    }
    let label = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break;
      if (norm(n.data)) label = norm(n.data);
    }
    return label.slice(0, 40);
  }

  function describeEl(el) {
    if (!el || el === document.body || el === document.documentElement) return { tag: '(geen)' };
    const r = el.getBoundingClientRect();
    const isField = el.matches('input, select, textarea');
    let value;
    if (el instanceof HTMLSelectElement) value = el.options[el.selectedIndex]?.text;
    else if (el.type === 'password') value = '***';
    else if (el.type === 'checkbox' || el.type === 'radio') value = el.checked ? 'AAN' : 'UIT';
    else if (isField) value = el.value;
    return {
      tag: el.tagName.toLowerCase(),
      type: el.type || undefined,
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      tab: el.tabIndex,
      ro: el.readOnly || undefined,
      dis: el.disabled || undefined,
      label: isField ? labelFor(el) : undefined,
      text: isField ? undefined : norm(el.innerText || el.textContent).slice(0, 40) || undefined,
      value: value === undefined ? undefined : String(value).slice(0, 60),
      pos: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
    };
  }

  function dlog(kind, data = {}, now = false) {
    if (!diag) return;
    diagBuf.push({ t: Date.now(), kind, ...data });
    // Klikken/Tab/Enter direct doorsturen: ze kunnen meteen een nieuw scherm laden.
    if (now) flushDiag();
    else if (!diagTimer) diagTimer = setTimeout(flushDiag, 200);
  }

  function flushDiag() {
    clearTimeout(diagTimer);
    diagTimer = null;
    if (!diagBuf.length) return;
    const events = diagBuf;
    diagBuf = [];
    send({ type: 'diagEvents', events, url: location.href, title: document.title });
  }

  const KEYNAMES = { ' ': 'Spatie' };
  document.addEventListener('keydown', (e) => {
    if (!diag || isOwnUi(e.target)) return;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && e.key.length > 1 && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
    const key = mods.concat(KEYNAMES[e.key] || e.key).join('+');
    const el = document.activeElement;
    dlog('toets', { key, trusted: e.isTrusted, el: describeEl(el) }, ['Tab', 'Enter', 'Escape'].includes(e.key) || e.key.startsWith('F'));
    if (['Tab', 'Enter'].includes(e.key)) {
      // Controleren of de cursor verplaatst (bij een verplicht leeg veld blijft hij staan).
      const before = el;
      const beforeVal = 'value' in (el || {}) ? el.value : null;
      setTimeout(() => {
        if (!diag) return;
        if (document.activeElement === before && document.hasFocus()) {
          dlog('blijft', { key: e.key, el: describeEl(before), changed: 'value' in before && before.value !== beforeVal });
        }
      }, 500);
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!diag || isOwnUi(e.target) || !(e.target instanceof Element)) return;
    dlog('klik', { button: ['links', 'midden', 'rechts'][e.button] || e.button, x: Math.round(e.clientX), y: Math.round(e.clientY), el: describeEl(e.target) }, true);
  }, true);

  document.addEventListener('focusin', (e) => {
    if (!diag || isOwnUi(e.target)) return;
    dlog('cursor', { el: describeEl(e.target) });
  }, true);

  const valueAtFocus = new WeakMap();
  document.addEventListener('focusin', (e) => {
    if (e.target && 'value' in e.target) valueAtFocus.set(e.target, e.target.value);
  }, true);

  document.addEventListener('change', (e) => {
    if (!diag || isOwnUi(e.target)) return;
    const el = e.target;
    dlog('wijziging', { from: el.type === 'password' ? '***' : valueAtFocus.get(el), el: describeEl(el) });
    if ('value' in el) valueAtFocus.set(el, el.value);
  }, true);

  window.addEventListener('beforeunload', () => { if (diag) dlog('verlaten', {}, true); });
  window.addEventListener('pagehide', () => { if (diag) flushDiag(); });

  function setDiag(active) {
    if (active && !diag) {
      diag = true;
      dlog('geladen', { dump: screenDump(300).text });
    } else if (!active && diag) {
      flushDiag();
      diag = false;
    }
  }

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
    let host, shadow, box, rec, prog, dg;
    function ensure() {
      if (host) return;
      host = document.createElement('div');
      host.setAttribute('data-blujay-assistent', '');
      Object.assign(host.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647 });
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .wrap { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; font: 11px/1.45 Verdana, Geneva, Tahoma, sans-serif; }
          .t { max-width: 420px; padding: 0; border: 1px solid #174a7c; background: #fff; color: #222; box-shadow: 0 3px 10px rgba(0,0,0,.25); word-break: break-word; }
          .t::before { content: 'Neele-Vat BluJay Assistent'; display: block; padding: 3px 8px; color: #fff; font-weight: bold; background: linear-gradient(#2f6fab, #1f5c97); }
          .t { padding-bottom: 6px; } .t { text-indent: 0; }
          .t > span { display: block; padding: 5px 8px 0; }
          .info { } .ok::before { background: linear-gradient(#57b45b, #2e7d32); } .error::before { background: linear-gradient(#d84a4a, #b52a2a); }
          .prog > span { font-family: Consolas, 'Courier New', monospace; }
          .rec { background: #fff; color: #b52a2a; border: 1px solid #b52a2a; padding: 4px 10px; font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
          .dot { display: inline-block; width: 8px; height: 8px; background: #c62828; border-radius: 50%; margin-right: 6px; animation: b 1s infinite; }
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
        d.append(Object.assign(document.createElement('span'), { textContent: text }));
        d.title = 'Klik om te sluiten';
        d.style.cursor = 'pointer';
        d.addEventListener('click', () => d.remove());
        box.prepend(d);
        setTimeout(() => d.remove(), kind === 'error' ? 10000 : 4000);
      },
      progress(text) {
        if (!text) { prog?.remove(); prog = null; return; }
        ensure();
        if (!prog) {
          prog = document.createElement('div');
          prog.className = 't info prog';
          box.append(prog);
        }
        prog.replaceChildren(Object.assign(document.createElement('span'), { textContent: text }));
      },
      diagIndicator(active, count) {
        if (!active) { dg?.remove(); dg = null; return; }
        ensure();
        if (!dg) {
          dg = document.createElement('div');
          dg.className = 'rec';
          box.append(dg);
        }
        dg.innerHTML = `<span class="dot"></span>Nauwkeurige opname — ${count || 0} gebeurtenissen`;
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
          if (msg.frameText && !norm(document.body?.innerText).toLowerCase().includes(norm(msg.frameText).toLowerCase())) {
            sendResponse({ found: false });
            return false;
          }
          let el = find(msg.selector, msg.allowHidden, msg.near);
          if (el && msg.pattern) {
            // Alleen "gevonden" als een van de elementen een waarde heeft die bij het patroon past.
            let re = null;
            try { re = new RegExp(msg.pattern); } catch { /* ongeldig patroon */ }
            el = re ? findAll(msg.selector).list.find((e) => re.test(readValue(e))) || null : el;
          }
          sendResponse({ found: !!el, focusAt: el && document.activeElement === el ? (document.hasFocus() ? Date.now() + 1e9 : lastFocusAt) : 0 });
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
      case 'progress':
        if (isTop) ui.progress(msg.text);
        return false;
      case 'readField': {
        try {
          const el = find(msg.selector, true);
          sendResponse({ ok: !!el, value: el ? readValue(el) : null, isCheckbox: el?.type === 'checkbox' });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return false;
      }
      case 'dumpScreen': {
        sendResponse(screenDump());
        return false;
      }
      case 'diagState':
        setDiag(msg.active);
        if (isTop) ui.diagIndicator(msg.active, msg.count);
        return false;
      case 'focusToken': {
        const a = document.activeElement;
        if (!a || a === document.body) { sendResponse({ token: 'geen' }); return false; }
        if (isTiny(a)) { sendResponse({ token: 'tussen' }); return false; }
        if (!focusIds.has(a)) focusIds.set(a, ++focusSeq);
        sendResponse({ token: focusIds.get(a) });
        return false;
      }
      case 'isFocused': {
        // Staat de cursor in (een van) de velden die bij deze selector horen?
        try {
          const { list } = findAll(msg.selector);
          sendResponse({ focused: list.includes(document.activeElement) });
        } catch {
          sendResponse({ focused: false });
        }
        return false;
      }
      case 'describeFocus': {
        const a = document.activeElement;
        if (!a || a === document.body) { sendResponse({ text: '(niets)' }); return false; }
        if (isTiny(a)) { sendResponse({ text: '(tussenvakje)' }); return false; }
        const v = 'value' in a && a.value ? ` (waarde "${String(a.value).slice(0, 20)}")` : '';
        sendResponse({ text: `veld "${labelFor(a)}"${v}` });
        return false;
      }
      case 'clickTagged': {
        // Reserve: klikken vanuit het content script als de pagina-context niet bereikbaar is.
        const el = document.querySelector(`[data-ba-click="${msg.tag}"]`);
        if (el) { el.removeAttribute('data-ba-click'); doClick(el); }
        sendResponse({ ok: !!el });
        return false;
      }
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

  send({ type: 'getDiagState' }).then((r) => {
    if (r?.active) {
      setDiag(true);
      if (isTop) ui.diagIndicator(true, r.count);
    }
  });

  send({ type: 'getRecordingState' }).then((r) => {
    if (r?.active) setRecording(true, r.count);
    else loadTriggers();
  });
})();
