/*
 * Vaste handelingen die bij installatie worden toegevoegd.
 * Verwijder je er een, dan komt hij niet terug (zie background.js).
 */
// eslint-disable-next-line no-unused-vars
const PRESETS = [
  {
    id: 'dossiermutaties',
    version: 5,
    realKeys: true,
    stepDelay: 30,
    name: 'Dossiermutaties draaien',
    description: 'Menu → keuze cq0579 → selectie invullen. Klantcode leeg = alle klanten.',
    urlPattern: '',
    inputs: [
      { section: 'Selectie', name: 'van', label: 'Van periode', type: 'month', default: '{{jaar}}-01', required: true },
      { section: 'Selectie', name: 'tot', label: 'T/m periode', type: 'month', default: '{{jaar}}-12', required: true },
      { section: 'Selectie', name: 'klant', label: 'Klantcode', placeholder: 'leeg = alle klanten', type: 'text', default: '' },
    ],
    triggers: [],
    steps: [
      // Klantcode bepalen: leeg → van = leeg, t/m = ZZZ. Ingevuld → beide de klantcode.
      { type: 'setVar', variable: 'klant_van', value: '{{klant|hoofdletters}}' },
      { type: 'setVar', variable: 'klant_tot', value: '{{klant|hoofdletters}}' },
      { type: 'setVar', variable: 'klant_tot', value: 'ZZZ', when: '{{klant}} == ' },

      // 1. Menu in de zijbalk
      { type: 'click', selector: 'text=Menu' },
      { type: 'wait', value: '300' },

      // 2. "Uw keuze": ts4117 vervangen door cq0579 en Tab
      { type: 'type', selector: 'field=Uw keuze', value: 'cq0579' },
      { type: 'key', selector: 'field=Uw keuze', value: 'Tab' },

      // 3. Selectiescherm invullen
      { type: 'waitFor', selector: 'field=van_activiteit', timeout: 20000 },
      { type: 'type', selector: 'field=van_activiteit', value: '1' },
      { type: 'key', selector: 'field=van_activiteit', value: 'Tab' },
      { type: 'type', selector: 'field=t/m_activiteit', value: '99999' },
      { type: 'key', selector: 'field=t/m_activiteit', value: 'Tab' },
      { type: 'type', selector: 'field=van_omzetcode', value: '1' },
      { type: 'key', selector: 'field=van_omzetcode', value: 'Tab' },
      { type: 'type', selector: 'field=t/m_omzetcode', value: '99' },
      { type: 'key', selector: 'field=t/m_omzetcode', value: 'Tab' },
      { type: 'type', selector: 'field=van_afdeling', value: '60WH' },
      { type: 'key', selector: 'field=van_afdeling', value: 'Tab' },
      { type: 'type', selector: 'field=t/m_afdeling', value: '60WH' },
      { type: 'key', selector: 'field=t/m_afdeling', value: 'Tab' },
      { type: 'type', selector: 'field=van_periode', value: '{{van|JJ/MM}}' },
      { type: 'key', selector: 'field=van_periode', value: 'Tab' },
      { type: 'type', selector: 'field=t/m_periode', value: '{{tot|JJ/MM}}' },
      { type: 'key', selector: 'field=t/m_periode', value: 'Tab' },
      { type: 'type', selector: 'field=van_opdrachtgever', value: '{{klant_van}}' },
      { type: 'key', selector: 'field=van_opdrachtgever', value: 'Tab' },
      { type: 'type', selector: 'field=t/m_opdrachtgever', value: '{{klant_tot}}' },
      { type: 'key', selector: 'field=t/m_opdrachtgever', value: 'Tab' },
      { type: 'type', selector: 'field=van_dossiernr', value: '1' },
      { type: 'key', selector: 'field=van_dossiernr', value: 'Tab' },
      { type: 'type', selector: 'field=t/m_dossiernr', value: '999999999999999' },
      { type: 'key', selector: 'field=t/m_dossiernr', value: 'Tab' },
      { type: 'type', selector: 'field=excel', value: 'J' },

      // 4. Bevestigen: Enter → onderin verschijnt "Uw keuze : 99 (99/ok = Akkoord, 00 = Afbreken)" → Enter.
      { type: 'key', selector: 'field=excel', value: 'Enter' },
      { type: 'waitFor', selector: 'contains=99/ok = Akkoord', timeout: 20000 },
      { type: 'type', selector: 'field=Uw keuze', value: '99' },
      { type: 'key', selector: 'field=Uw keuze', value: 'Enter' },
    ],
  },
  {
    id: 'uitslagdossier',
    version: 7,
    stepDelay: 60,
    name: 'Uitslagdossier aanmaken',
    description: 'Sleep de paklijst (PDF) hierheen. De klant wordt herkend en het dossier wordt helemaal ingevuld.',
    urlPattern: '',
    pdf: true,
    realKeys: true,
    inputs: [
      { section: 'Laden en lossen', row: 'laad', rowLabel: 'Laaddatum / tijd', name: 'laaddatum', label: 'Laaddatum', type: 'date', required: true },
      { section: 'Laden en lossen', row: 'laad', name: 'laadtijd_van', label: 'Laadtijd van', type: 'time', placeholder: 'van', required: true },
      { section: 'Laden en lossen', row: 'laad', name: 'laadtijd_tot', label: 'Laadtijd tot (leeg = zelfde)', type: 'time', placeholder: 'tot' },
      { section: 'Laden en lossen', row: 'los', rowLabel: 'Losdatum / tijd', name: 'losdatum', label: 'Losdatum', type: 'date', required: true },
      { section: 'Laden en lossen', row: 'los', name: 'lostijd_van', label: 'Lostijd van', type: 'time', placeholder: 'van', required: true },
      { section: 'Laden en lossen', row: 'los', name: 'lostijd_tot', label: 'Lostijd tot (leeg = zelfde)', type: 'time', placeholder: 'tot' },
      { section: 'Uit de paklijst', name: 'opdrachtgever', label: 'Opdrachtgever', required: true },
      { section: 'Uit de paklijst', name: 'referentie', label: 'Referentie', required: true },
      { section: 'Uit de paklijst', name: 'extraref', label: 'Extra ref.', placeholder: 'optioneel' },
      { section: 'Uit de paklijst', name: 'laadadres', label: 'Laadadres' },
      { section: 'Uit de paklijst', row: 'kond', rowLabel: 'Konditie', name: 'konditie', label: 'Konditie' },
      { section: 'Uit de paklijst', row: 'kond', name: 'plaats', label: 'Konditie plaats' },
      { section: 'Uit de paklijst', name: 'ontvanger', label: 'Ontvanger', required: true },
      { section: 'Uit de paklijst', name: 'losadres', label: 'Losadres', placeholder: 'leeg = ontvanger' },
      { section: 'Uit de paklijst', name: 'losref', label: 'Losref' },
      { section: 'Uit de paklijst', row: 'pal', rowLabel: 'Aantal Pallets', name: 'pallets', label: 'Aantal pallets' },
      { section: 'Uit de paklijst', row: 'pal', name: 'palletsoort', label: 'Palletsoort', default: 'EP' },
      { section: 'Uit de paklijst', name: 'instructie', label: 'Instructies uitslag' },
    ],
    triggers: [],
    steps: [
      { type: 'setVar', variable: 'laadtijd_tot', value: '{{laadtijd_van}}', when: '{{laadtijd_tot}} == ' },
      { type: 'setVar', variable: 'lostijd_tot', value: '{{lostijd_van}}', when: '{{lostijd_tot}} == ' },
      { type: 'setVar', variable: 'losadres', value: '{{ontvanger}}', when: '{{losadres}} == ' },

      // 1. Uitslag → Uitslagorders (Uitslag alleen openklappen als hij nog dicht is)
      { type: 'click', selector: 'text=Uitslag', when: '!bestaat: text=Uitslagorders' },
      { type: 'click', selector: 'text=Uitslagorders' },
      { type: 'wait', value: '500' },

      // 2. Aanmaken nieuw dossier — alles via Tab, in de volgorde van BluJay (nooit naar andere velden springen).
      // Scherm "Uitslag dossiers": Zending 60WH, Tab, nogmaals Tab → scherm "Aanmaken nieuw dossier" opent.
      { type: 'type', selector: 'focus || field=Zending', value: '60WH', timeout: 20000 },
      { type: 'key', selector: 'focus', value: 'Tab' },
      { type: 'key', selector: 'focus', value: 'Tab' },
      { type: 'tabTo', selector: 'field=Afh.code', value: '4', timeout: 20000 },
      { type: 'type', selector: 'field=Afh.code', value: 'u' },
      { type: 'tabTo', selector: 'field=Opdrachtgever', value: '8' },
      { type: 'type', selector: 'field=Opdrachtgever', value: '{{opdrachtgever}}' },
      { type: 'key', selector: 'focus', value: 'Tab' },
      { type: 'key', selector: 'focus', value: 'Tab' },
      { type: 'read', selector: 'contains=Dossiernummer', pattern: 'Dossiernummer\\D*(\\d{6,})', variable: 'dossiernr', timeout: 20000 },
      { type: 'notify', value: 'Dossier {{dossiernr}} aangemaakt — gegevens invullen…' },

      // 3. Kop van het dossier: ALLEEN Tab en typen, precies in de volgorde van BluJay (cursor start in Opdrachtgever).
      // → Referentie
      { type: 'key', selector: 'focus', value: 'Tab' },
      { type: 'type', selector: 'focus', value: '{{referentie}}', stayInFrame: true },
      // → Extra ref.
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{extraref}}', when: '{{extraref}} != ', stayInFrame: true },
      // → Afzender (neemt opdrachtgever over) → Laadadres
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{laadadres}}', when: '{{laadadres}} != ', stayInFrame: true },
      // → Laaddatum, begintijd, eindtijd
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{laaddatum|DD-MM-JJ}}', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{laadtijd_van}}', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{laadtijd_tot}}', stayInFrame: true },
      // → Konditie (+ plaats; zonder konditie slaat BluJay de plaats over)
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{konditie}}', when: '{{konditie}} != ', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', when: '{{konditie}} != ', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{plaats}}', when: '{{konditie}} != ', stayInFrame: true },
      // → Vervoerder → Laadref (= nieuw dossiernummer)
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{dossiernr}}', stayInFrame: true },
      // → Ontvanger → Losadres
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{ontvanger}}', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{losadres}}', stayInFrame: true },
      // → Losdatum, begintijd, eindtijd
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{losdatum|DD-MM-JJ}}', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{lostijd_van}}', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{lostijd_tot}}', stayInFrame: true },
      // → Losref, daarna Enter = dossier opslaan
      { type: 'key', selector: 'focus', value: 'Tab', stayInFrame: true },
      { type: 'type', selector: 'focus', value: '{{losref}}', when: '{{losref}} != ', stayInFrame: true },
      { type: 'key', selector: 'focus', value: 'Enter', stayInFrame: true },
      { type: 'wait', value: '1500' },

      // 5. Stapelbaar mag niet aangevinkt zijn (pas ná de Tab-reeks, omdat de muis de Tab-volgorde kan veranderen).
      { type: 'check', selector: 'field=Stapelbaar', value: 'uit', optional: true, timeout: 3000 },

      // 6. Aantal pallets (bijv. 33 EP): na de Enter moet je eerst weer een veld aanklikken; na afloop Enter.
      { type: 'click', selector: 'field=Aantal Pallets', when: '{{pallets}} != ' },
      { type: 'type', selector: 'field=Aantal Pallets', value: '{{pallets}}', when: '{{pallets}} != ' },
      { type: 'key', selector: 'focus', value: 'Tab', when: '{{pallets}} != ' },
      { type: 'type', selector: 'field=Aantal Pallets [2]', value: '{{palletsoort}}', when: '{{pallets}} != ' },
      { type: 'key', selector: 'focus', value: 'Enter', when: '{{pallets}} != ' },
      { type: 'wait', value: '1000', when: '{{pallets}} != ' },

      // 7. Menu → Omschrijvingen → Instructies uitslag → tekst + Enter
      { type: 'click', selector: 'text=Menu', near: 'Artikelregels', when: '{{instructie}} != ' },
      { type: 'click', selector: 'text=Omschrijvingen', when: '{{instructie}} != ' },
      { type: 'click', selector: 'text=Instructies uitslag', when: '{{instructie}} != ' },
      { type: 'type', selector: 'focus', value: '{{instructie}}', timeout: 15000, when: '{{instructie}} != ' },
      { type: 'key', selector: 'focus', value: 'Enter', when: '{{instructie}} != ' },
      { type: 'notify', value: 'Dossier {{dossiernr}} is klaar.' },
    ],
  },
];
