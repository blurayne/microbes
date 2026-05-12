<!-- Kapitel 01 · Die 12 Immunzellen + Filler
     Extracted verbatim from docs/_source.html (lines 701-952).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch01">
    <div class="chapter-header">
      <div class="chapter-num">01</div>
      <div class="chapter-title-block">
        <h2>Die 12 <em>Immunzellen</em><br>+ 1 Filler</h2>
        <div class="chapter-subtitle">Drei Tiers: Core (die Säulen), Special (Spezialisten), Utility (Support). Plus Red Blood Cells als atmosphärischer NPC.</div>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">1.1</div>
        <div>
          <div class="section-title">Tier-System</div>
          <div class="section-desc">Drei Klassen mit klarer Rolle. Core = Hauptkampf. Special = Nischen-Konter. Utility = Support.</div>
        </div>
      </div>

      <!-- TIER: CORE -->
      <div class="tier-group">
        <div class="tier-header">
          <div class="tier-name">Tier 1 · Core <span class="badge badge-tier-core">Säulen</span></div>
          <div class="tier-count">6 Einheiten</div>
        </div>
        <div class="grid-auto col-auto-280">

          <div class="card cell-card" style="--cell-color: var(--c-mac);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Makrophage</div>
                <div class="cell-role">Angeboren · Wachposten</div>
              </div>
            </div>
            <div class="cell-desc">"Big eater" — langlebiger Phagozyt, frisst Pathogene und präsentiert Antigene an T-Zellen.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Patrouille · Spawnt Neutrophile · Aktiviert DC</div>
            <div class="cell-relations"
                 data-friends="dendritic,neutrophil,monocyte"
                 data-prey="virus,germ,bacterium,amoebaP,slime,mite,spore,toxin"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Dendritische, Neutrophile, Monozyten</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Alle Pathogene (DPS 5)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-neu);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Neutrophile</div>
                <div class="cell-role">Angeboren · Soldat</div>
              </div>
            </div>
            <div class="cell-desc">First Responder; engulft Bakterien per Phagozytose. Häufigste weiße Blutzelle.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Billig · Schwarm · Stirbt schnell</div>
            <div class="cell-relations"
                 data-friends="macrophage,monocyte,bcell"
                 data-prey="germ,bacterium,slime,spore"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Makrophage, Monozyt, B-Zelle</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Bakterien (DPS 6) · Pilze (DPS 4)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-dc);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Dendritische Zelle</div>
                <div class="cell-role">Brücke · Bote</div>
              </div>
            </div>
            <div class="cell-desc">Antigen-präsentierender Kurier; sammelt Eindringlinge und zeigt sie T-Zellen im Lymphknoten.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Schaltet Phase 3 frei · Lymphknoten-Pull</div>
            <div class="cell-relations"
                 data-friends="macrophage,tcell,bcell"
                 data-prey="virus,germ,bacterium,amoebaP,slime,mite,spore,toxin"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Makrophage, T-Zelle, B-Zelle</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Alle Pathogene (DPS 2) · markiert für T- und B-Zellen</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-th);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">T-Helferzelle</div>
                <div class="cell-role">Adaptiv · General</div>
              </div>
            </div>
            <div class="cell-desc">Adaptiver Koordinator; aktiviert und befehligt andere Einheiten via Zytokine.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Buff-Aura +50% · Klont sich · Aktiviert TK/B</div>
            <div class="cell-relations"
                 data-friends="dendritic,bcell,tcell"
                 data-prey="virus,amoebaP,mite"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Dendritische, B-Zelle, T-Killer</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Virus (DPS 12) · Viral &amp; Parasit. (DPS 8)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-tk);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">T-Killerzelle</div>
                <div class="cell-role">Adaptiv · Scharfschütze</div>
              </div>
            </div>
            <div class="cell-desc">Adaptiver Killer; erkennt spezifische Antigene und tötet infizierte Zellen gezielt.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Hoher DMG · Klont sich · Anti-Virus</div>
            <div class="cell-relations"
                 data-friends="dendritic,tcell,nk"
                 data-prey="virus,amoebaP,mite"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Dendritische, T-Helfer, NK</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Virus (DPS 12) · Viral &amp; Parasit. (DPS 8)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-bz);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">B-Zelle</div>
                <div class="cell-role">Adaptiv · Waffenfabrik</div>
              </div>
            </div>
            <div class="cell-desc">Adaptive Antikörper-Fabrik; produziert pathogen-spezifische Antikörper.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Markiert Pathogene +75% DMG · Differenziert zu Plasmazelle</div>
            <div class="cell-relations"
                 data-friends="tcell,macrophage,dendritic"
                 data-prey="virus,germ,bacterium,amoebaP,slime,mite,spore,toxin"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">T-Helfer, Makrophage, Dendritische</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Alle Pathogene (Antikörper) · neutralisiert Toxine</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

        </div>
      </div>

      <!-- TIER: SPECIAL -->
      <div class="tier-group">
        <div class="tier-header">
          <div class="tier-name">Tier 2 · Special <span class="badge badge-tier-special">Spezialisten</span></div>
          <div class="tier-count">4 Einheiten</div>
        </div>
        <div class="grid-auto col-auto-280">

          <div class="card cell-card" style="--cell-color: var(--c-nk);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Natural Killer</div>
                <div class="cell-role">Angeboren · Anti-Virus-Spezialist</div>
              </div>
            </div>
            <div class="cell-desc">Patrouilliert für virus-infizierte und Tumor-Zellen; tötet bei Kontakt ohne Sensibilisierung.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Sofort verfügbar · Anti-Virus ohne Phase 3 · "Missing-Self"-Erkennung</div>
            <div class="cell-relations"
                 data-friends="macrophage,dendritic,tcell"
                 data-prey="virus,amoebaP,mite"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Makrophage, Dendritische, T-Killer</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Virus &amp; Parasiten (DPS 10)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-mast);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Mast Cell</div>
                <div class="cell-role">Angeboren · Histamin-Werfer</div>
              </div>
            </div>
            <div class="cell-desc">Tissue-resident Sentinel; setzt Histamin frei zur Entzündung und allergischen Reaktion.</div>
            <div class="cell-spec"><strong>Spiel:</strong> AoE-Histamin · Neutralisiert Toxine · Boost für nahe Phagozyten</div>
            <div class="cell-relations"
                 data-friends="basophil,eosinophil"
                 data-prey="amoebaP,mite"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Basophile, Eosinophile</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Parasiten (DPS 6) · Histamin-Burst</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-eos);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Eosinophil</div>
                <div class="cell-role">Angeboren · Anti-Parasit</div>
              </div>
            </div>
            <div class="cell-desc">Anti-Parasit-Spezialist; Schlüssel bei allergischen Reaktionen, setzt giftige Granula frei.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Massive DMG vs Parasiten/Mites · Schwach gegen alles andere</div>
            <div class="cell-relations"
                 data-friends="mast,basophil"
                 data-prey="amoebaP,mite"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Mastzelle, Basophile</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Parasiten (DPS 12)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-bas);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Basophil</div>
                <div class="cell-role">Angeboren · Granulozyt</div>
              </div>
            </div>
            <div class="cell-desc">Zirkulierender Granulozyt; setzt Histamin und Heparin frei zur Verstärkung der Entzündung.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Slow-Field (Pathogene 50% langsamer) · Anti-Allergen</div>
            <div class="cell-relations"
                 data-friends="mast,eosinophil"
                 data-prey="amoebaP,mite"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Mastzelle, Eosinophile</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Parasiten (DPS 9) · Milbe (DPS 11)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

        </div>
      </div>

      <!-- TIER: UTILITY -->
      <div class="tier-group">
        <div class="tier-header">
          <div class="tier-name">Tier 3 · Utility <span class="badge badge-tier-utility">Support</span></div>
          <div class="tier-count">2 Einheiten</div>
        </div>
        <div class="grid-auto col-auto-280">

          <div class="card cell-card" style="--cell-color: var(--c-mon);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Monocyte</div>
                <div class="cell-role">Angeboren · Rekrut</div>
              </div>
            </div>
            <div class="cell-desc">Zirkulierender Sentinel; reift im Gewebe zu Makrophagen oder Dendritischen Zellen.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Verwandelt sich nach 8s in MAC oder DC (Spielerwahl) · Günstige Investition</div>
            <div class="cell-relations"
                 data-friends="macrophage,neutrophil"
                 data-prey="virus,germ,bacterium,amoebaP,slime,mite,spore,toxin"
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Makrophage, Neutrophile</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Alle Pathogene (DPS 4) · reift zu Makrophagen</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

          <div class="card cell-card" style="--cell-color: var(--c-plt);">
            <div class="cell-icon-wrap">
              <div class="cell-icon"></div>
              <div>
                <div class="cell-name">Platelet</div>
                <div class="cell-role">Hilfszelle · Blutplättchen</div>
              </div>
            </div>
            <div class="cell-desc">Winziges Zellfragment; gerinnt Blut bei Verletzungen und rekrutiert Immunzellen.</div>
            <div class="cell-spec"><strong>Spiel:</strong> Baut Barrieren auf der Blutbahn · Verlangsamt durchkommende Pathogene · Heilt Organ-HP</div>
            <div class="cell-relations"
                 data-friends="rbc,neutrophil"
                 data-prey=""
                 data-foes="">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Erythrozyt, Neutrophile</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">kein Direktangriff · stoppt Blutungen</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list rel-empty">—</span></div>
            </div>
          </div>

        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">1.2</div>
        <div>
          <div class="section-title">Filler: Red Blood Cell</div>
          <div class="section-desc">Passive Filler, visuell und mechanisch wichtig. Sie machen die Blutbahn lebendig.</div>
        </div>
      </div>

      <div class="filler-note">
        <div class="filler-icon"></div>
        <div>
          <h4>Red Blood Cell <span class="badge badge-filler">FILLER</span></h4>
          <p>Erythrozyten — bikonkave Scheiben voller Hämoglobin, transportieren Sauerstoff. Sie strömen <strong>passiv durch die Blutbahn</strong> als atmosphärische Hintergrund-Animation. Aber: <strong>Pathogene können sie infizieren</strong> (Viren) oder beschädigen (Toxine). Sichtbarer Schaden = Spielfeedback. Außerdem: jede tote RBC = +1 Energie für den Spieler (Hämoglobin-Boost).</p>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">1.3</div>
        <div>
          <div class="section-title">Vergleichstabelle (alle 12)</div>
          <div class="section-desc">Größe, System, Geschwindigkeit, Kosten, Aufgabe.</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Zelle</th><th>Tier</th><th>System</th><th>Größe</th><th>Speed</th><th>Kosten</th><th>Aufgabe</th></tr>
          </thead>
          <tbody>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-neu);"></span>Neutrophile</span></td><td><span class="badge badge-tier-core">Core</span></td><td><span class="badge badge-innate">Angeboren</span></td><td>10–12 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span></span></td><td>15 ⚡</td><td>Bakterien fressen</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-mac);"></span>Makrophage</span></td><td><span class="badge badge-tier-core">Core</span></td><td><span class="badge badge-innate">Angeboren</span></td><td>20–30 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span></span><span></span><span></span></span></td><td>30 ⚡</td><td>Patrouille, Alarm</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-dc);"></span>Dendritische Zelle</span></td><td><span class="badge badge-tier-core">Core</span></td><td><span class="badge badge-bridge">Brücke</span></td><td>15–20 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span></span><span></span></span></td><td>50 ⚡</td><td>Info-Transport</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-th);"></span>T-Helferzelle</span></td><td><span class="badge badge-tier-core">Core</span></td><td><span class="badge badge-adaptive">Adaptiv</span></td><td>7–12 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span></span><span></span></span></td><td>60 ⚡</td><td>Befehlen + Buff</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-tk);"></span>T-Killerzelle</span></td><td><span class="badge badge-tier-core">Core</span></td><td><span class="badge badge-adaptive">Adaptiv</span></td><td>7–12 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span></span><span></span></span></td><td>70 ⚡</td><td>Gezielt töten</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-bz);"></span>B-Zelle</span></td><td><span class="badge badge-tier-core">Core</span></td><td><span class="badge badge-adaptive">Adaptiv</span></td><td>7–8 μm</td><td><span class="speed-bar"><span class="active"></span><span></span><span></span><span></span><span></span></span></td><td>80 ⚡</td><td>Antikörper bauen</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-nk);"></span>Natural Killer</span></td><td><span class="badge badge-tier-special">Special</span></td><td><span class="badge badge-innate">Angeboren</span></td><td>10–15 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span><span></span></span></td><td>45 ⚡</td><td>Anti-Virus (sofort!)</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-mast);"></span>Mast Cell</span></td><td><span class="badge badge-tier-special">Special</span></td><td><span class="badge badge-innate">Angeboren</span></td><td>13–20 μm</td><td><span class="speed-bar"><span class="active"></span><span></span><span></span><span></span><span></span></span></td><td>40 ⚡</td><td>Histamin-AoE</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-eos);"></span>Eosinophil</span></td><td><span class="badge badge-tier-special">Special</span></td><td><span class="badge badge-innate">Angeboren</span></td><td>12–17 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span></span><span></span></span></td><td>55 ⚡</td><td>Anti-Parasit</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-bas);"></span>Basophil</span></td><td><span class="badge badge-tier-special">Special</span></td><td><span class="badge badge-innate">Angeboren</span></td><td>10–14 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span></span><span></span><span></span></span></td><td>35 ⚡</td><td>Slow-Field</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-mon);"></span>Monocyte</span></td><td><span class="badge badge-tier-utility">Utility</span></td><td><span class="badge badge-innate">Angeboren</span></td><td>15–22 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span></span><span></span></span></td><td>20 ⚡</td><td>Wandelt zu MAC/DC</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-plt);"></span>Platelet</span></td><td><span class="badge badge-tier-utility">Utility</span></td><td><span class="badge badge-innate">Hilfszelle</span></td><td>2–4 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span><span></span></span></td><td>25 ⚡</td><td>Barriere + Heilung</td></tr>
            <tr style="opacity: 0.7;"><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-rbc);"></span>Red Blood Cell</span></td><td><span class="badge badge-filler">Filler</span></td><td><span class="badge badge-filler">Erythrozyt</span></td><td>6–8 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span></span></td><td>—</td><td>Atmosphäre + Energie-Drop</td></tr>
          </tbody>
        </table>
      </div>
      <div class="callout">Größenvergleich: RBC = 7 μm. Makrophagen sind also fast 4× so groß. Plättchen sind <strong>winzig</strong> — sie passen zu fünft in eine RBC.</div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 02: PATHOGENS                           -->
  <!-- =============================================== -->
