/*
 * End-to-end test: laadt de extensie in Chromium en test uitvoeren,
 * frames, variabelen, automatische starters en opnemen op test/demo.html.
 *
 *   npm install && npm test
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(__dirname) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('  ✔', name);
  } catch (e) {
    failures++;
    console.log('  ✖', name, '\n     ', e.message);
  }
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-test-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');

  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/demo.html`);
  await page.frameLocator('#detail').locator('#ref').waitFor();
  await page.waitForTimeout(300);

  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${base}/demo.html`);
  const setMacros = (macros) => sw.evaluate((m) => chrome.storage.local.set({ macros: m, settings: { stepDelay: 50, timeout: 3000 } }), macros);
  const run = (macroId, vars) => sw.evaluate(({ tabId, macroId, vars }) => runMacro(tabId, macroId, vars, 'test'), { tabId, macroId, vars });
  const frame = page.frameLocator('#detail');

  console.log('BluJay Assistent — tests');

  await test('handeling met invoer, wachten, lezen, frame en voorwaarden', async () => {
    await setMacros([{
      id: 'm1', name: 'Order afhandelen', urlPattern: `${base}/*`,
      inputs: [{ name: 'order', label: 'Ordernummer' }],
      steps: [
        { type: 'type', selector: 'label=Ordernummer', value: '{{order}}' },
        { type: 'click', selector: 'text=Zoeken' },
        { type: 'waitGone', selector: '#loading' },
        { type: 'read', selector: '#klant', variable: 'klant' },
        { type: 'select', selector: '#status', value: 'Geleverd' },
        { type: 'type', selector: 'input[name="opmerking"]', value: 'Klant {{klant}}' },
        { type: 'type', selector: 'input[placeholder="dd-mm-jjjj"]', value: '{{vandaag}}' },
        { type: 'check', selector: 'label=POD ontvangen', value: 'aan' },
        { type: 'type', selector: '#ref', value: 'REF-{{order}}' },
        { type: 'click', selector: 'text=Opslaan' },
        { type: 'stop', when: '{{klant}} == Jansen Transport' },
        { type: 'type', selector: 'input[name="snelcode"]', value: 'NIET UITGEVOERD' },
      ],
    }]);
    const res = await run('m1', { order: '123' });
    assert.ok(res.ok, res.error);
    assert.strictEqual(await page.inputValue('#orderNr'), '123');
    assert.strictEqual(await page.textContent('#klant'), 'Jansen Transport');
    assert.strictEqual(await page.inputValue('#status'), 'G');
    assert.strictEqual(await page.inputValue('input[name="opmerking"]'), 'Klant Jansen Transport');
    assert.match(await page.inputValue('input[name="leverdatum"]'), /^\d\d-\d\d-\d{4}$/);
    assert.strictEqual(await page.isChecked('#pod'), true);
    assert.strictEqual(await frame.locator('#result').textContent(), 'Opgeslagen: REF-123');
    assert.strictEqual(await page.inputValue('input[name="snelcode"]'), '', 'stop-stap werd genegeerd');
  });

  await test('foutmelding als element niet bestaat; optionele stap wordt overgeslagen', async () => {
    await setMacros([{
      id: 'm2', name: 'Fout', urlPattern: '',
      steps: [
        { type: 'click', selector: 'text=Bestaat niet', optional: true, timeout: 500 },
        { type: 'click', selector: '#bestaatNiet', timeout: 500 },
      ],
    }]);
    const res = await run('m2', {});
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /stap 2 .*niet gevonden/);
  });

  await test('automatisch starten bij wijzigen van een veld', async () => {
    await setMacros([{
      id: 'm3', name: 'Snelcode', urlPattern: `${base}/*`,
      triggers: [{ type: 'change', selector: 'input[name="snelcode"]', condition: 'startsWith', value: 'L' }],
      steps: [{ type: 'type', selector: 'input[name="opmerking"]', value: 'Snelcode {{waarde}} verwerkt' }],
    }]);
    await page.waitForTimeout(300); // content script laadt starters opnieuw
    await page.fill('input[name="snelcode"]', 'X1');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(800);
    assert.notStrictEqual(await page.inputValue('input[name="opmerking"]'), 'Snelcode X1 verwerkt', 'starter ging af terwijl voorwaarde niet klopte');
    await page.fill('input[name="snelcode"]', 'L42');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.querySelector('input[name="opmerking"]').value === 'Snelcode L42 verwerkt', null, { timeout: 5000 });
  });

  await test('opnemen van klikken en invoer (ook in frame)', async () => {
    await setMacros([]);
    await page.reload();
    await page.frameLocator('#detail').locator('#ref').waitFor();
    await page.waitForTimeout(300);
    const start = await sw.evaluate((tabId) => handleMessage({ type: 'startRecording', tabId }, {}), tabId);
    assert.ok(start.ok, start.error);
    await page.waitForTimeout(200);
    await page.fill('#orderNr', '777');
    await page.click('#search-btn-48213');
    await page.click('text=POD ontvangen');
    await frame.locator('#ref').fill('ABC');
    await frame.locator('text=Opslaan').click();
    await page.waitForTimeout(400);
    const stop = await sw.evaluate(() => handleMessage({ type: 'stopRecording', save: true, name: 'Opgenomen' }, {}));
    assert.ok(stop.ok, stop.error);
    const macros = await sw.evaluate(async () => (await chrome.storage.local.get('macros')).macros);
    const steps = macros[0].steps;
    const summary = steps.map((s) => `${s.type}:${s.selector}${s.value != null ? '=' + s.value : ''}${s.frame ? ' @' + s.frame : ''}`);
    console.log('       opgenomen:', summary.join(' | '));
    assert.ok(summary.includes('type:#orderNr=777'));
    assert.ok(summary.includes('click:text=Zoeken'));
    assert.ok(summary.some((s) => s.startsWith('click:#pod')));
    assert.ok(summary.includes('type:#ref=ABC @/demo-frame.html'));
    assert.ok(summary.includes('click:text=Opslaan @/demo-frame.html'));

    // Opgenomen handeling afspelen op een verse pagina
    await page.reload();
    await page.frameLocator('#detail').locator('#ref').waitFor();
    await page.waitForTimeout(300);
    const res = await run(macros[0].id, {});
    assert.ok(res.ok, res.error);
    assert.strictEqual(await page.inputValue('#orderNr'), '777');
    assert.strictEqual(await frame.locator('#result').textContent(), 'Opgeslagen: ABC');
  });

  // ------------------------------------------------------------ Dossiermutaties
  const dossierPage = await context.newPage();
  const dossierTab = async () => sw.evaluate(async (url) => (await chrome.tabs.query({ url: url + '*' })).find((t) => !t.url.endsWith('menu.html')).id, `${base}/dossier/`);
  const openDossier = async (variant = 'index.html') => {
    await dossierPage.goto(`${base}/dossier/${variant}`);
    await dossierPage.frameLocator('#side').locator('text=Menu').waitFor();
    await dossierPage.frameLocator('#main').locator('#k').waitFor();
    await dossierPage.waitForTimeout(300);
  };
  const dossierValues = async () => {
    const f = context.pages().flatMap((pg) => pg.frames()).find((fr) => fr.url().endsWith('/cq0579.html'));
    return f.evaluate(() => [...document.querySelectorAll('input.v')].map((i) => i.value).concat(document.getElementById('status').textContent));
  };
  const runDossier = async (vars) => {
    await sw.evaluate((presets) => chrome.storage.local.set({ macros: presets, settings: { stepDelay: 30, timeout: 5000 } }), await sw.evaluate(() => PRESETS));
    const id = await dossierTab();
    await sw.evaluate((id) => chrome.tabs.setZoom(id, 0.9), id); // zoom 90%, zoals bij de gebruiker
    await dossierPage.waitForTimeout(300);
    return sw.evaluate(({ id, vars }) => runMacro(id, 'dossiermutaties', vars, 'test'), { id, vars });
  };

  await test('Dossiermutaties draaien — zonder klantcode (exact zoals screenshot)', async () => {
    const installed = await sw.evaluate(async () => (await chrome.storage.local.get('presetVersions')).presetVersions);
    assert.ok(installed && installed.dossiermutaties >= 1, 'preset niet geïnstalleerd bij installatie');
    await openDossier();
    const res = await runDossier({ van: '2026-01', tot: '2026-12', klant: '' });
    assert.ok(res.ok, res.error);
    assert.deepStrictEqual(await dossierValues(), ['1', '99999', '1', '99', '60WH', '60WH', '26/01', '26/12', '', 'ZZZ', '1', '999999999999999', 'J', 'Klaar']);
  });

  await test('Dossiermutaties draaien — met klantcode en andere periode', async () => {
    await openDossier();
    const res = await runDossier({ van: '2025-03', tot: '2026-02', klant: 'hen01' });
    assert.ok(res.ok, res.error);
    assert.deepStrictEqual(await dossierValues(), ['1', '99999', '1', '99', '60WH', '60WH', '25/03', '26/02', 'HEN01', 'HEN01', '1', '999999999999999', 'J', 'Klaar']);
  });

  await test('Dossiermutaties — Menu-link met javascript: (zoals oudere BluJay-schermen)', async () => {
    await openDossier('index-js.html');
    const res = await runDossier({ van: '2026-01', tot: '2026-12', klant: '' });
    assert.ok(res.ok, res.error);
    assert.deepStrictEqual(await dossierValues(), ['1', '99999', '1', '99', '60WH', '60WH', '26/01', '26/12', '', 'ZZZ', '1', '999999999999999', 'J', 'Klaar']);
  });

  await test('Dossiermutaties — "Uw keuze" via onzichtbaar tussenvakje (zoals in BluJay)', async () => {
    await openDossier('index-blujay.html');
    const res = await runDossier({ van: '2026-01', tot: '2026-12', klant: '' });
    assert.ok(res.ok, res.error);
    assert.deepStrictEqual(await dossierValues(), ['1', '99999', '1', '99', '60WH', '60WH', '26/01', '26/12', '', 'ZZZ', '1', '999999999999999', 'J', 'Klaar']);
  });

  await test('Dossiermutaties — Menu opent een nieuw venster', async () => {
    await openDossier('index-popup.html');
    const res = await runDossier({ van: '2026-01', tot: '2026-12', klant: 'X1' });
    assert.ok(res.ok, res.error);
    assert.deepStrictEqual(await dossierValues(), ['1', '99999', '1', '99', '60WH', '60WH', '26/01', '26/12', 'X1', 'X1', '1', '999999999999999', 'J', 'Klaar']);
  });

  // ------------------------------------------------------------ Uitslagdossier (PDF)
  await test('Paklijst (PDF) inlezen in het paneel: klant herkennen en velden vullen', async () => {
    await sw.evaluate((presets) => chrome.storage.local.set({ macros: presets, settings: { stepDelay: 30, timeout: 5000 } }), await sw.evaluate(() => PRESETS));
    const extId = new URL(sw.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extId}/src/popup/popup.html`);
    // Overzicht: de klant-modules staan er niet los in, alleen het startpunt
    await panel.locator('#macroList .item', { hasText: 'Uitslagdossier aanmaken' }).waitFor(); // eerst wachten tot de lijst er staat
    const items = await panel.locator('#macroList .item').allTextContents();
    assert.ok(items.some((t) => t.includes('Uitslagdossier aanmaken')));
    assert.ok(!items.some((t) => /Uitslag – (Top Brands|Maxell)/.test(t)), 'klant-modules horen niet los in het overzicht');
    await panel.locator('#macroList .item', { hasText: 'Uitslagdossier aanmaken' }).click();
    const card = panel.locator('#detail');
    assert.strictEqual(await card.locator('input[data-name]').count(), 0, 'vóór het inlezen van de pakbon horen er geen velden te zijn');
    await card.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/paklijst-topbrands-test.pdf'));
    await card.locator('.pdfstatus.ok').waitFor({ timeout: 15000 });
    assert.match(await card.locator('.modkop').textContent(), /Klant-module: Top Brands/);
    assert.strictEqual(await card.locator('input[data-name^="adres_"]').count(), 0, 'Top Brands hoort geen adresvelden te tonen');
    const val = (n) => card.locator(`input[data-name="${n}"]`).inputValue();
    assert.match(await card.locator('.pdfstatus').textContent(), /Top Brands → Voorbeeld Retail GmbH \(DE\), Teststadt/);
    assert.strictEqual(await val('opdrachtgever'), 'TOPBROUD');
    assert.strictEqual(await val('referentie'), '26SO999-000123');
    assert.strictEqual(await val('losref'), '7654321');
    assert.strictEqual(await val('pallets'), '21');
    assert.strictEqual(await val('palletsoort'), 'EP');
    assert.strictEqual(await val('plaats'), 'Teststadt');
    assert.strictEqual(await val('konditie'), 'DDP');
    assert.strictEqual(await val('laadadres'), 'NEELEMAA3');
    assert.strictEqual(await val('ontvanger'), '', 'onbekende afnemer hoort leeg te zijn');
    // Ontbrekende ontvanger-code wordt na invullen onthouden voor dit klantnummer
    await card.locator('input[data-name="ontvanger"]').fill('testontv');
    // Snelle invoer: "11" → 11-<deze maand>-<dit jaar>, "8" → 08:00, "17" → 17:00, "830" → 08:30
    const nu = new Date();
    const mmjjjj = `${String(nu.getMonth() + 1).padStart(2, '0')}-${nu.getFullYear()}`;
    const quick = [['laaddatum', '11', `11-${mmjjjj}`], ['laadtijd_van', '8', '08:00'], ['laadtijd_tot', '17', '17:00'],
      ['losdatum', '3-12', `03-12-${nu.getFullYear()}`], ['lostijd_van', '830', '08:30']];
    for (const [n, v, expect] of quick) {
      const inp = card.locator(`input[data-name="${n}"]`);
      await inp.fill(v);
      await inp.press('Tab');
      assert.strictEqual(await inp.inputValue(), expect, `snelle invoer ${n}: "${v}"`);
    }
    await card.locator('.actions button', { hasText: 'Uitvoeren' }).click();
    await panel.waitForTimeout(500);
    const codes = await sw.evaluate(async () => (await chrome.storage.local.get('ontvangerCodes')).ontvangerCodes);
    assert.deepStrictEqual(codes, { 'topbrands:K9999999': 'TESTONTV' });
    await sw.evaluate(() => { for (const c of running.values()) c.stopped = true; });
    await panel.waitForTimeout(500);
    // Tweede keer: code wordt automatisch ingevuld
    await panel.reload();
    await panel.locator('#macroList .item', { hasText: 'Uitslagdossier aanmaken' }).click();
    const card2 = panel.locator('#detail');
    await card2.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/paklijst-topbrands-test.pdf'));
    await card2.locator('.pdfstatus.ok').waitFor({ timeout: 15000 });
    assert.strictEqual(await card2.locator('input[data-name="ontvanger"]').inputValue(), 'TESTONTV');
    // Daarna een Maxell-pakbon in hetzelfde scherm: de Top Brands-velden verdwijnen, de Maxell-module verschijnt
    await card2.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/Test_Picking_List_MEL-PL009999_Delivery_18.11.26.pdf'));
    await card2.locator('.modkop', { hasText: 'Maxell' }).waitFor({ timeout: 15000 });
    assert.ok(await card2.locator('input[data-name="adres_naam1"]').count() === 1, 'Maxell hoort het adresblok te tonen');
    assert.strictEqual(await card2.locator('input[data-name="ontvanger"]').inputValue(), '', 'Top Brands-code mag niet bij Maxell terechtkomen');
    await panel.close();
  });

  // ------------------------------------------------------------ Uitslagdossier op het BluJay-achtige testscherm
  const uitslagVars = {
    laaddatum: '11-09-2026', laadtijd_van: '08:00', laadtijd_tot: '16:00', losdatum: '14-09-2026', lostijd_van: '14:00', lostijd_tot: '',
    opdrachtgever: 'TOPBROUD', referentie: '26SO270-011129', extraref: '', laadadres: 'NEELEMAA3', konditie: 'DDP', plaats: 'Biblis',
    ontvanger: 'ACTIOBIB', losadres: '', losref: '2031479', pallets: '33', palletsoort: 'EP',
  };
  const runUitslag = async (hash = '') => {
    const up = await context.newPage();
    await up.goto(`${base}/blujay/index.html${hash}`);
    await up.waitForTimeout(500);
    await sw.evaluate((presets) => chrome.storage.local.set({ macros: presets, settings: { stepDelay: 30, timeout: 5000 } }), await sw.evaluate(() => PRESETS));
    const id = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, `${base}/blujay/index.html${hash}`);
    await sw.evaluate((id) => chrome.tabs.setZoom(id, 0.9), id); // zoals bij de gebruiker: niet op 100%
    await up.waitForTimeout(300);
    const res = await sw.evaluate(({ id, vars }) => runMacro(id, 'uitslag_topbrands', vars, 'test'), { id, vars: uitslagVars });
    const model = await up.evaluate(() => ({ ...window.model }));
    const logText = await up.textContent('#log');
    const instr = await up.textContent('#instrSaved');
    const trace = (await sw.evaluate(async () => (await chrome.storage.local.get('log')).log[0])).trace || [];
    return { up, res, model, logText, instr, trace };
  };

  await test('Uitslagdossier aanmaken — BluJay-achtig scherm (div-velden, tussenvakje, Tab-volgorde)', async () => {
    const { up, res, model, logText, instr, trace } = await runUitslag();
    if (!res.ok) console.log('       stappenverslag:\n         ' + trace.join('\n         '));
    assert.ok(res.ok, res.error + ' | ' + logText);
    const m = model;
    assert.deepStrictEqual(
      [m.zafd, m.afh, m.soort, m.opdr, m.ref, m.extra, m.afz, m.laadadres, m.laaddat, m.laadvan, m.laadtot, m.kond, m.kondplaats, m.verv,
        m.laadref, m.ontv, m.losadres, m.losdat, m.losvan, m.lostot, m.losref, m.pal, m.palsoort, m.stapel],
      ['60WH', 'u', 'd', 'TOPBROUD', '26SO270-011129', '', 'TOPBROUD', 'NEELEMAA3', '11-09-26', '08:00', '16:00', 'DDP', 'Biblis', '',
        '60123456', 'ACTIOBIB', 'ACTIOBIB', '14-09-26', '14:00', '14:00', '2031479', '33', 'EP', false]
    );
    assert.deepStrictEqual([m.verwdat, m.verwtijd, m.wn], ['10-11-26', '07:59', 'BKN'], 'velden aangeraakt die niet aangeraakt mochten worden');
    assert.match(logText, /dossier aangemaakt\]\[opgeslagen\]/);
    assert.doesNotMatch(logText, /WAREHOUSE|ZOEKSCHERM|NIET/);
    assert.strictEqual(instr, '', 'het menu/instructies hoort niet meer gebruikt te worden');
    await up.close();
  });

  await test('Uitslagdossier — cursor springt naar "Neele-Vat Warehouse": stoppen zonder te typen', async () => {
    const { up, res, model } = await runUitslag('#valkuil');
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /Laaddatum|Konditie|cursor/);
    assert.strictEqual(await up.inputValue('#wh'), 'Neele-Vat Warehouse 6.34', 'er is in het warehouse-vak getypt');
    assert.deepStrictEqual([model.laadtot, model.verwdat], ['16:01', '10-11-26']);
    await up.close();
  });

  await test('Maxell-pakbon inlezen: VAT-MAAS, leverdatum uit bestandsnaam, adresgegevens, Ontvanger leeg', async () => {
    await sw.evaluate((presets) => chrome.storage.local.set({ macros: presets, ontvangerCodes: {} }), await sw.evaluate(() => PRESETS));
    const extId = new URL(sw.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extId}/src/popup/popup.html`);
    await panel.locator('#macroList .item', { hasText: 'Uitslagdossier aanmaken' }).click();
    const card = panel.locator('#detail');
    await card.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/Test_Picking_List_MEL-PL009999_Delivery_18.11.26.pdf'));
    await card.locator('.pdfstatus.ok').waitFor({ timeout: 15000 });
    const val = (n) => card.locator(`input[data-name="${n}"]`).inputValue();
    assert.match(await card.locator('.pdfstatus').textContent(), /Maxell → TESTWINKEL Supers B\.V, PROEFSTAD/);
    assert.match(await card.locator('.modkop').textContent(), /Klant-module: Maxell/);
    assert.deepStrictEqual(
      await Promise.all(['opdrachtgever', 'referentie', 'konditie', 'plaats', 'losdatum', 'ontvanger', 'adres_naam1', 'adres_naam2', 'adres_straat', 'adres_postcode', 'adres_land', 'adres_plaats', 'adres_contact', 'adres_telefoon', 'adres_email'].map(val)),
      ['VAT-MAAS', 'MEL-PL009999', 'DDP', 'PROEFSTAD', '18-11-2026', '', 'TESTWINKEL Supers B.V', 'Goederenontvangst', 'Proefstraat 7', '1234AB', 'NL', 'PROEFSTAD', 'verkoop@example.com', '+00 44 1000 200300', 'verkoop@example.com']
    );
    await panel.close();
  });

  await test('Uitslagdossier met NIEUW adres (Ctrl+K, meldingen OK/Bevestigen/OK, code onthouden)', async () => {
    const up = await context.newPage();
    await up.goto(`${base}/blujay/index.html`);
    await up.waitForTimeout(500);
    await sw.evaluate((presets) => chrome.storage.local.set({ macros: presets, ontvangerCodes: {}, settings: { stepDelay: 30, timeout: 5000 } }), await sw.evaluate(() => PRESETS));
    const id = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, `${base}/blujay/index.html`);
    const vars = {
      ...uitslagVars, opdrachtgever: 'VAT-MAAS', referentie: 'MEL-PL009999', ontvanger: '', losadres: '', losref: '', pallets: '', plaats: 'ALPHEN AAN DEN RIJN',
      klantnummer: 'maxell:TESTWINKEL Supers B.V|1234AB', adres_naam1: 'TESTWINKEL Supers B.V', adres_naam2: 'Goederenontvangst', adres_straat: 'Proefstraat 7',
      adres_postcode: '1234AB', adres_land: 'NL', adres_plaats: 'PROEFSTAD', adres_contact: 'verkoop@example.com', adres_telefoon: '+00 44 1000 200300', adres_email: 'verkoop@example.com',
    };
    const res = await sw.evaluate(({ id, vars }) => runMacro(id, 'uitslag_maxell', vars, 'test'), { id, vars });
    const m = await up.evaluate(() => ({ ...window.model }));
    const logText = await up.textContent('#log');
    if (!res.ok) {
      const log = await sw.evaluate(async () => (await chrome.storage.local.get('log')).log[0]);
      console.log('       stappenverslag:\n         ' + (log.trace || []).slice(-25).join('\n         '));
    }
    assert.ok(res.ok, res.error + ' | ' + logText);
    assert.deepStrictEqual(
      [m.a_n1, m.a_n2, m.a_n3, m.a_a1, m.a_pc, m.a_best, m.a_pl1, m.a_pl2, m.a_land, m.a_naam, m.a_tel, m.a_mail, m.a_web],
      ['TESTWINKEL Supers B.V', 'Goederenontvangst', '', 'Proefstraat 7', '1234AB', 'NL', 'ZONE NL', 'PROEFSTAD', 'NL', 'verkoop@example.com', '+00 44 1000 200300', 'verkoop@example.com', '']
    );
    // plaats achter Konditie kan maar 15 tekens bevatten (zoals in BluJay)
    assert.deepStrictEqual([m.opdr, m.ref, m.ontv, m.losadres, m.kond, m.kondplaats], ['VAT-MAAS', 'MEL-PL009999', 'TESTZON00', 'TESTZON00', 'DDP', 'ALPHEN AAN DEN ']);
    assert.match(logText, /dossier aangemaakt\]\[adres bewaard\]\[opgeslagen\]/);
    assert.doesNotMatch(logText, /GEANNULEERD|WAREHOUSE|ZOEKSCHERM|CTRL-K MET WAARDE|CTRL-K ZONDER CTRL-TOETS/);
    const codes = await sw.evaluate(async () => (await chrome.storage.local.get('ontvangerCodes')).ontvangerCodes);
    assert.deepStrictEqual(codes, { 'maxell:TESTWINKEL Supers B.V|1234AB': 'TESTZON00' }, 'nieuwe code niet onthouden');
    await up.close();
  });

  await test('Dossiermutaties — klik op Menu zonder effect geeft een duidelijke melding', async () => {
    const pg = await context.newPage();
    await pg.goto(`${base}/blujay/index.html`); // hier opent "Menu" niets
    await pg.waitForTimeout(400);
    await sw.evaluate((presets) => chrome.storage.local.set({ macros: presets, settings: { stepDelay: 30, timeout: 3000 } }), await sw.evaluate(() => PRESETS));
    const id = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, `${base}/blujay/index.html`);
    const res = await sw.evaluate((id) => runMacro(id, 'dossiermutaties', { van: '2026-01', tot: '2026-12', klant: '' }, 'test'), id);
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /klik op "text=Menu" had geen effect/);
    const log = await sw.evaluate(async () => (await chrome.storage.local.get('log')).log[0]);
    assert.ok(log.trace.some((l) => /klik op span "Menu"/.test(l)), 'verslag noemt het geklikte element niet:\n' + log.trace.join('\n'));
    await pg.close();
  });

  await test('Nauwkeurige opname: elke toets, klik, cursor en "bleef staan" in het rapport', async () => {
    const up = await context.newPage();
    await up.goto(`${base}/uitslag/index.html`);
    await up.frameLocator('#side').locator('text=Inslag').waitFor();
    await up.waitForTimeout(400);
    const id = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, `${base}/uitslag/index.html`);
    const st = await sw.evaluate((id) => handleMessage({ type: 'diagStart', tabId: id }, {}), id);
    assert.ok(st.ok, st.error);
    await up.waitForTimeout(300);
    const side = up.frameLocator('#side');
    await side.getByText('Uitslag', { exact: true }).click();
    await side.getByText('Uitslagorders').click();
    const main = up.frameLocator('#main');
    await main.locator('#afd').waitFor();
    await up.waitForTimeout(300);
    await up.keyboard.type('60WH');
    await up.keyboard.press('Tab');
    await up.keyboard.press('Tab');
    await main.locator('#afh').waitFor({ state: 'visible' });
    await up.waitForTimeout(200);
    await up.keyboard.type('u');
    for (let i = 0; i < 4; i++) await up.keyboard.press('Tab');
    await up.keyboard.type('TOPBROUD');
    await up.keyboard.press('Tab');
    await up.keyboard.press('Tab');
    await main.locator('#ref').waitFor({ state: 'visible' });
    await up.waitForTimeout(900);
    await up.keyboard.press('Tab'); // Opdrachtgever → Referentie
    await up.keyboard.press('Tab'); // Referentie leeg → blijft staan
    await up.waitForTimeout(700);
    await up.keyboard.type('REF1');
    await up.keyboard.press('Tab');
    await up.waitForTimeout(500);
    const stop = await sw.evaluate(() => handleMessage({ type: 'diagStop', save: true }, {}));
    assert.ok(stop.ok, stop.error);
    const rep = await sw.evaluate(() => handleMessage({ type: 'diagReport' }, {}));
    const t = rep.text;
    for (const needle of ['KLIK      links', 'TOETS     Tab', 'CURSOR    → input', 'label "Afh.code"', 'label "Opdrachtgever"',
      'BLIJFT    cursor bleef staan na Tab in input', 'label "Referentie"', 'WIJZIGING', 'SCHERM', '=========== SCHERMOPBOUW', 'TOETS     u ']) {
      if (!t.includes(needle)) console.log(t.split("\n").slice(0, 45).join("\n"));
      assert.ok(t.includes(needle), `rapport mist "${needle}"`);
    }
    fs.writeFileSync(path.join(os.tmpdir(), 'diag-rapport-test.txt'), t);
    console.log(`       rapport: ${t.split('\n').length} regels (voorbeeld in ${path.join(os.tmpdir(), 'diag-rapport-test.txt')})`);
    await up.close();
  });

  await context.close();
  server.close();
  console.log(failures ? `\n${failures} test(s) mislukt` : '\nAlle tests geslaagd');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
