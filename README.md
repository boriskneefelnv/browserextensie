# BluJay Assistent

Browserextensie (Chrome / Edge) die vaste handelingen voor je uitvoert in BluJay:
klikken, velden invullen, toetsen indrukken, wachten — op basis van wat jij invult in de extensie.

## Ingebouwde handeling: Dossiermutaties draaien

1. Open BluJay.
2. Klik op het extensie-icoon (of druk **Alt+B**). Rechts opent het **zijpaneel**; dat blijft open terwijl je werkt.
3. Kies bij **Dossiermutaties draaien**:
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

## Installeren (eenmalig)

1. Download deze map (*Code → Download ZIP*) en pak hem uit, bijv. naar `Documenten\blujay-assistent`.
2. Ga in Chrome naar `chrome://extensions` (Edge: `edge://extensions`).
3. Zet rechtsboven **Ontwikkelaarsmodus** aan.
4. Klik **Uitgepakte extensie laden** en kies de map (de map waar `manifest.json` in staat).
5. Pin de extensie vast via het puzzelstukje in de werkbalk.
6. Klik op het icoon: rechts opent het zijpaneel van BluJay Assistent.

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

## Ontwikkelen / testen

```bash
npm install
npm test
```

De tests laden de extensie in Chromium en draaien alle functies (ook *Dossiermutaties draaien*) op nagebouwde
testpagina's in `test/`.
