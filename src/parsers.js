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

  /** Ontvanger-codes in BluJay per klantnummer van de afnemer (aanvulbaar vanuit het paneel). */
  const ONTVANGERS = {
    K1300650: 'ACTIOBIB', // Action Service & Distribution B.V. (DE), Biblis
  };

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
          instructie: 'Laden in de lengte',
          klantnummer,
          afnemer: [adres.naam, adres.plaats].filter(Boolean).join(', '),
        };
      },
    },
  ];

  /** Herkent de klant en leest de waarden. Geeft { klant, waarden } of { klant: null }. */
  function parse(text, lines, geleerdeOntvangers = {}) {
    const klant = KLANTEN.find((k) => k.herken(text));
    if (!klant) return { klant: null, waarden: {} };
    const waarden = klant.lees(text, lines || text.split('\n'));
    const codes = { ...ONTVANGERS, ...geleerdeOntvangers };
    if (waarden.klantnummer && codes[waarden.klantnummer]) {
      waarden.ontvanger = codes[waarden.klantnummer];
      waarden.losadres = codes[waarden.klantnummer];
    }
    return { klant: { id: klant.id, naam: klant.naam }, waarden };
  }

  return { parse, KLANTEN, ONTVANGERS };
})();
if (typeof module !== 'undefined') module.exports = BAParsers;
