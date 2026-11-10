/*
 * Vaste handelingen die bij installatie worden toegevoegd.
 * Verwijder je er een, dan komt hij niet terug (zie background.js).
 */
// eslint-disable-next-line no-unused-vars
const PRESETS = [
  {
    id: 'dossiermutaties',
    name: 'Dossiermutaties draaien',
    description: 'Menu → keuze cq0579 → selectie invullen. Klantcode leeg = alle klanten.',
    urlPattern: '',
    inputs: [
      { name: 'van', label: 'Van periode', type: 'month', default: '{{jaar}}-01', required: true },
      { name: 'tot', label: 'T/m periode', type: 'month', default: '{{jaar}}-12', required: true },
      { name: 'klant', label: 'Klantcode (leeg = alle klanten)', type: 'text', default: '' },
    ],
    triggers: [],
    steps: [
      // Klantcode bepalen: leeg → van = leeg, t/m = ZZZ. Ingevuld → beide de klantcode.
      { type: 'setVar', variable: 'klant_van', value: '{{klant|hoofdletters}}' },
      { type: 'setVar', variable: 'klant_tot', value: '{{klant|hoofdletters}}' },
      { type: 'setVar', variable: 'klant_tot', value: 'ZZZ', when: '{{klant}} == ' },

      // 1. Menu in de zijbalk
      { type: 'click', selector: 'text=Menu' },
      { type: 'wait', value: '1500' },

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

      // 4. Bevestigen — staat uit tot bekend is welke toets BluJay hier verwacht.
      { type: 'key', selector: 'field=excel', value: 'Enter', disabled: true },
    ],
  },
];
