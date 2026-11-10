# Neele-Vat BluJay Assistent

Browserextensie (Chrome / Edge) die vaste handelingen voor je uitvoert in BluJay:
klikken, velden invullen, toetsen indrukken, wachten — op basis van wat jij invult in de extensie.

## Ingebouwde handeling: Dossiermutaties draaien

1. Open BluJay.
2. Klik op het extensie-icoon (**NV**, of druk **Alt+B**). Rechts opent het **zijpaneel** met het overzicht van acties.
3. Klik op **Dossiermutaties draaien** en kies:
   - **Van periode** en **T/m periode** (maand + jaar) — standaard januari t/m december van dit jaar
   - **Klantcode** — leeg laten = alle klanten
4. Klik **▶ Uitvoeren**. In het zijpaneel en rechtsonder in BluJay zie je bij welke stap hij is.

De extensie doet dan:

| Stap | Wat |
|---|---|
| 1 | Klikt op **Menu** in de zijbalk |
| 2 | Vervangt bij *Uw keuze* de waarde door `cq0579` en drukt **Tab** |
| 3 | Vult het selectiescherm in (en drukt Tab na elk veld): |

| # | Veld | Waarde |
|---|---|---|
| 1 | van_activiteit | 1 |
| 2 | t/m_activiteit | 99999 |
| 3 | van_omzetcode | 1 |
| 4 | t/m_omzetcode | 99 |
| 5 | van_afdeling | 60WH |
| 6 | t/m_afdeling | 60WH |
| 7 | van_periode | gekozen van-periode als `JJ/MM` (bijv. 26/01) |
| 8 | t/m_periode | gekozen t/m-periode als `JJ/MM` (bijv. 26/12) |
| 9 | van_opdrachtgever | leeg, of de klantcode |
| 10 | t/m_opdrachtgever | `ZZZ`, of de klantcode |
| 11 | van_dossiernr | 1 |
| 12 | t/m_dossiernr | 999999999999999 |
| 13 | excel | J |

Daarna bevestigt hij:

| Stap | Wat |
|---|---|
| 4 | Drukt **Enter** in het veld *excel* |
| 5 | Wacht tot onderin *Uw keuze : 99 — ( 99/ok = Akkoord, 00 = Afbreken )* verschijnt |
| 6 | Zet daar `99` en drukt nog eens **Enter** — klaar |

## Ingebouwde handeling: Uitslagdossier aanmaken (vanuit paklijst-PDF)

1. Open BluJay en het zijpaneel (⚡ of **Alt+B**).
2. Klik op **Uitslagdossier aanmaken** en sleep de **paklijst (PDF)** in het vak (of klik erop om te kiezen).
   De klant wordt herkend (nu: **Top Brands → TOPBROUD**) en de velden worden ingevuld.
3. Vul **laaddatum + laadtijd** en **losdatum + lostijd** in (tijd *tot* leeg = zelfde als *van*). Controleer de rest.
   Snel typen kan: datum `11` + Tab → `11-<deze maand>-<dit jaar>`, `11-12` → `11-12-<dit jaar>`;
   tijd `8` → `08:00`, `17` → `17:00`, `830` → `08:30`.
4. Klik **▶ Uitvoeren**. Hij doet dan:
   Uitslag → Uitslagorders → Zending `60WH` Tab Tab → Afh.code → `u` → Tab tot Opdrachtgever → Tab Tab (dossier wordt gemaakt)
   → Referentie, Laadadres, Laaddatum/-tijden, Konditie + plaats, **Laadref = nieuw dossiernummer**, Ontvanger, Losadres,
   Losdatum/-tijden, Losref → Enter → Stapelbaar uit → Aantal pallets aanklikken (bijv. 33 EP) → Enter → Menu → Omschrijvingen → Instructies uitslag
   → "Laden in de lengte" + Enter.

| Uit de paklijst (Top Brands) | Dossierveld |
|---|---|
| *Order No.* | Referentie |
| *SHIP ID* | Losref |
| "33 pallets" | Aantal pallets (33 + EP) |
| plaats van de afnemer | plaats achter Konditie |
| klantnummer afnemer (bijv. K1300650) | Ontvanger/Losadres (bijv. ACTIOBIB) |
| vast voor Top Brands | Laadadres NEELEMAA3, Konditie DDP, instructie "Laden in de lengte" |

Kent hij de ontvanger-code van een afnemer nog niet, dan blijft dat veld leeg (rood). Vul hem één keer in;
daarna onthoudt hij hem voor dat klantnummer.

**Echte toetsaanslagen:** deze handelingen typen zoals jij dat doet (ook Tab en Enter). De browser toont tijdens
de handeling een balk *"Neele-Vat BluJay Assistent is foutopsporing gestart"*. Dat is normaal en verdwijnt als hij klaar is
(niet op *Annuleren* klikken, dan stopt hij met echte toetsaanslagen).

## Installeren (eenmalig)

1. Download deze map (*Code → Download ZIP*) en pak hem uit, bijv. naar `Documenten\blujay-assistent`.
2. Ga in Chrome naar `chrome://extensions` (Edge: `edge://extensions`).
3. Zet rechtsboven **Ontwikkelaarsmodus** aan.
4. Klik **Uitgepakte extensie laden** en kies de map (de map waar `manifest.json` in staat).
5. Pin de extensie vast via het puzzelstukje in de werkbalk.
6. Klik op het icoon (NV): rechts opent het zijpaneel van Neele-Vat BluJay Assistent.

Na een update van de bestanden: klik op ↻ bij de extensie in `chrome://extensions` en herlaad BluJay.
De ingebouwde handeling *Dossiermutaties draaien* wordt dan automatisch bijgewerkt naar de nieuwste versie
(eigen aanpassingen daaraan worden dan overschreven).

## Zelf handelingen maken

- **Opnemen:** popup → *Nieuwe handeling opnemen* → voer de handeling één keer zelf uit → *Stoppen & opslaan*.
- **Bewerken:** ⚙ in de popup. Per stap kies je de soort (Klik, Typ tekst, Toets, Wacht, …), het element en de waarde.
- **Invoer vragen:** voeg bij *Invoervelden* een veld toe (tekst, maand+jaar of datum) en gebruik het in stappen als `{{naam}}`.
  Opmaak: `{{van|JJ/MM}}` → `26/01`, `{{klant|hoofdletters}}`.
- **Voorwaarden:** *Alleen als* bij een stap, bijv. `{{klant}} == ` (klant is leeg) of `{{status}} != Geleverd`.
- **Automatisch starten:** laat een handeling vanzelf starten als een veld in BluJay een bepaalde waarde krijgt.
- **Elementen aanwijzen:** `text=Menu`, `field=van_periode` (eerste invulveld ná die tekst), `contains=…` (element waarvan de tekst dit bevat), `label=…`, CSS (`#id`) of `xpath=…`.
  Met *🎯 Element kiezen* in de popup klik je een element aan en wordt de selector gekopieerd.
- **Delen:** via *Exporteren* / *Importeren* (JSON) kun je handelingen met collega's delen.

## Lukt een stap niet?

- Er verschijnt rechtsonder een rode melding met het **stapnummer**; het logboek staat bij ⚙ → *Logboek*.
- BluJay traag? Verhoog bij ⚙ → *Instellingen* de wachttijd en time-out, of de *Wacht*-stap na *Menu* (nu 1,5 s).
- Neemt BluJay een ingevulde waarde niet over? Zet bij die stap (⋯) **Letter voor letter typen** aan.

In het dossier gebruikt hij **alleen Tab en typen**, in de vaste volgorde van BluJay (Opdrachtgever → Referentie →
Extra ref. → Afzender → Laadadres → Laaddatum/van/tot → Konditie(/plaats) → Vervoerder → Laadref → Ontvanger → Losadres
→ Losdatum/van/tot → Losref → Enter). Springt de cursor uit het dossierscherm, dan stopt hij zonder te typen.
Na elk veld controleert hij of de waarde er goed in staat.

**Nauwkeurige opname (voor analyse):** *Extra → Nauwkeurige opname*. Werk daarna gewoon in BluJay; elke toets, klik,
cursorverplaatsing (met het label van het veld), waardewijziging en elk geladen scherm wordt vastgelegd, ook
"cursor bleef staan" na een Tab bij een verplicht veld. Klik *Stoppen & rapport maken* en kies *Downloaden (.txt)*.

**Hulp nodig?** Na een mislukte actie: *📋 Details kopiëren* in het paneel. Voor de opbouw van een scherm:
*Extra → Schermopbouw kopiëren*. Plak het resultaat in de chat met de ontwikkelaar.

## Ontwikkelen / testen

```bash
npm install
npm test
```

De tests laden de extensie in Chromium en draaien alle functies (ook *Dossiermutaties draaien*) op nagebouwde
testpagina's in `test/`.
