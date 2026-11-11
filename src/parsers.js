/*
 * Paklijst-lezers per klant. Elke lezer:
 *   - herken(tekst)  → true als de PDF van deze klant is
 *   - lees(tekst, regels) → waarden voor het dossier (namen = invoervelden van de handeling)
 *
 * Nieuwe klant toevoegen = nieuw blok in KLANTEN hieronder.
 */
// eslint-disable-next-line no-unused-vars
var BAParsers = (() => {
  const first = (text, re) => {
    const m = text.match(re);
    return m ? (m[1] ?? m[0]).trim() : '';
  };
  const cols = (line) => line.split(/\s{3,}/).map((s) => s.trim()).filter(Boolean);


  /** Landnaam → landcode (voor Bestemmingscode/Land in BluJay). */
  const LANDEN = {
    netherlands: 'NL', nederland: 'NL', holland: 'NL', 'the netherlands': 'NL',
    belgium: 'BE', belgie: 'BE', 'belgië': 'BE', belgique: 'BE',
    germany: 'DE', deutschland: 'DE', duitsland: 'DE',
    france: 'FR', frankrijk: 'FR', luxembourg: 'LU', luxemburg: 'LU',
    'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB',
    austria: 'AT', 'österreich': 'AT', poland: 'PL', polen: 'PL', spain: 'ES', italy: 'IT', denmark: 'DK',
  };
  const landcode = (naam) => LANDEN[String(naam || '').trim().toLowerCase()] || (/^[A-Z]{2}$/.test(String(naam || '').trim()) ? naam.trim() : '');

  /** Postcode + plaats uit één regel ("2405 XX ALPHEN AAN DEN RIJN", "68647 Biblis"). */
  function postcodePlaats(regel) {
    let m = String(regel || '').match(/^(\d{4})\s?([A-Z]{2})\s+(.+)$/);
    if (m) return { postcode: m[1] + m[2], plaats: m[3].trim() };
    m = String(regel || '').match(/^(\d{4,5})\s+(.+)$/);
    if (m) return { postcode: m[1], plaats: m[2].trim() };
    return null;
  }

  /** Afleveradres-blok: regels na het klantnummer bovenaan (linkerkolom). */
  function addressBlock(lines, klantnummer) {
    const start = lines.findIndex((l) => klantnummer && cols(l)[0] === klantnummer);
    if (start < 0) return {};
    const left = [];
    for (let i = start + 1; i < Math.min(lines.length, start + 8); i++) {
      const c = cols(lines[i])[0] || '';
      if (/^(customer number|your reference|date\b)/i.test(c)) break;
      // Regels die alleen uit de rechterkolom bestaan (bank, telefoon, …) overslaan.
      if (/^(bank|phone|fax|vat|account|iban|swift|tel|e-?mail)\b/i.test(c)) continue;
      left.push(c);
    }
    const pcIdx = left.findIndex((c) => /^\d{4,5}\s+\S/.test(c) || /^\d{4}\s?[A-Z]{2}\s+\S/.test(c));
    const pc = pcIdx >= 0 ? left[pcIdx].match(/^(\d{4,5}|\d{4}\s?[A-Z]{2})\s+(.+)$/) : null;
    return {
      naam: left[0] || '',
      straat: left[1] || '',
      postcode: pc ? pc[1] : '',
      plaats: pc ? pc[2] : '',
      land: pcIdx >= 0 ? left[pcIdx + 1] || '' : '',
    };
  }

  const KLANTEN = [
    {
      id: 'topbrands',
      naam: 'Top Brands',
      module: 'uitslag_topbrands', // eigen klant-module (velden + stappen)
      // Ontvanger-codes in BluJay per klantnummer van de afnemer (aanvulbaar vanuit het paneel)
      ontvangers: {
        K1300650: 'ACTIOBIB', // Action Service & Distribution B.V. (DE), Biblis
      },
      herken: (t) => /top\s?brands/i.test(t),
      lees(text, lines) {
        const klantnummer = first(text, /Customer number:?\s+([A-Z]?\d{4,})/i);
        const adres = addressBlock(lines, klantnummer);
        return {
          opdrachtgever: 'TOPBROUD',
          laadadres: 'NEELEMAA3',
          konditie: 'DDP',
          plaats: adres.plaats,
          referentie: first(text, /Order\s*No\.?:?\s+([A-Z0-9][A-Z0-9-/]+)/i),
          losref: first(text, /SHIP\s*ID:?\s*(\d+)/i),
          pallets: first(text, /(\d+)\s*pallets?\b/i),
          palletsoort: 'EP',
          klantnummer,
          afnemer: [adres.naam, adres.plaats].filter(Boolean).join(', '),
        };
      },
    },
    {
      id: 'maxell',
      naam: 'Maxell',
      module: 'uitslag_maxell', // eigen klant-module (velden + stappen, incl. nieuw adres)
      ontvangers: {},
      herken: (t) => /maxell europe/i.test(t) && /picking list/i.test(t),
      lees(text, lines, bestandsnaam = '') {
        // Afleveradres: linkerkolom onder "Customer" tot "Item number"; rechterkolom-labels overslaan.
        const start = lines.findIndex((l) => /^customer\b/i.test(cols(l)[0] || ''));
        const RECHTS = /^(picking route|orderer|activation date|end date|mode of delivery|delivery terms|page)\b/i;
        const blok = [];
        for (let i = start + 1; start >= 0 && i < lines.length; i++) {
          const c = cols(lines[i])[0] || '';
          if (/^item number/i.test(c)) break;
          if (!c || RECHTS.test(c)) continue;
          blok.push(c);
        }
        const pcIdx = blok.findIndex((r) => postcodePlaats(r));
        const pc = pcIdx >= 0 ? postcodePlaats(blok[pcIdx]) : { postcode: '', plaats: '' };
        const straat = pcIdx > 0 ? blok[pcIdx - 1] : '';
        const namen = pcIdx > 1 ? blok.slice(0, pcIdx - 1) : blok.slice(0, 1);
        const land = landcode(pcIdx >= 0 ? blok[pcIdx + 1] : '') || 'NL';
        // Leverdatum staat niet in de PDF, wel in de bestandsnaam: "..._Delivery_18.11.26.pdf"
        const lev = String(bestandsnaam).match(/Delivery[_ -]?(\d{1,2})[.-](\d{1,2})[.-](\d{2,4})/i);
        const losdatum = lev ? `${lev[1].padStart(2, '0')}-${lev[2].padStart(2, '0')}-${lev[3].length === 2 ? '20' + lev[3] : lev[3]}` : '';
        const telefoon = first(text, /\bPh:?\s*(\+?[\d ()-]{6,}\d)/i);
        const email = first(text, /\bE-?mail:?\s*([\w.+-]+@[\w.-]+\.\w+)/i);
        return {
          opdrachtgever: 'VAT-MAAS', // Maxell heeft (nog) geen eigen relatie in BluJay
          laadadres: 'NEELEMAA3',
          konditie: first(text, /Delivery terms\s+([A-Z]{3})\b/i) || 'DDP',
          plaats: pc.plaats,
          referentie: first(text, /Picking List\s+([A-Z]{2,}-[A-Z]{2,}\d+)/i),
          losref: '',
          pallets: '',
          palletsoort: 'EP',
          losdatum,
          klantnummer: `${namen[0] || ''}|${pc.postcode}`, // geen klantnummer in de PDF: naam + postcode
          afnemer: [namen[0], pc.plaats].filter(Boolean).join(', '),
          adres_naam1: namen[0] || '',
          adres_naam2: namen[1] || '',
          adres_straat: straat,
          adres_postcode: pc.postcode,
          adres_land: land,
          adres_plaats: pc.plaats,
          adres_contact: email,
          adres_telefoon: telefoon,
          adres_email: email,
        };
      },
    },
  ];

  /**
   * Herkent de klant en leest de waarden met de module van die klant.
   * Geeft { klant: { id, naam, module }, waarden } of { klant: null }.
   * Onthouden ontvanger-codes zijn per klant-module ("topbrands:K1300650"), zodat klanten elkaar nooit beïnvloeden.
   */
  function parse(text, lines, geleerdeOntvangers = {}, bestandsnaam = '') {
    const klant = KLANTEN.find((k) => k.herken(text));
    if (!klant) return { klant: null, waarden: {} };
    const waarden = klant.lees(text, lines || text.split('\n'), bestandsnaam);
    if (waarden.klantnummer) {
      waarden.klantsleutel = `${klant.id}:${waarden.klantnummer}`;
      const code = geleerdeOntvangers[waarden.klantsleutel] || (klant.ontvangers || {})[waarden.klantnummer];
      if (code) {
        waarden.ontvanger = code;
        waarden.losadres = code;
      }
    }
    return { klant: { id: klant.id, naam: klant.naam, module: klant.module }, waarden };
  }

  return { parse, KLANTEN };
})();
if (typeof module !== 'undefined') module.exports = BAParsers;
