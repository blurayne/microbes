<!-- Kapitel 02 · Pathogen-Katalog
     Extracted verbatim from docs/_source.html (lines 953-1320).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch02">
    <div class="chapter-header">
      <div class="chapter-num">02</div>
      <div class="chapter-title-block">
        <h2>Pathogen-<em>Katalog</em></h2>
        <div class="chapter-subtitle">12 Gegnertypen in 5 Kategorien. Viren mit Subtypen. Toxine als neue Kategorie.</div>
      </div>
    </div>

    <!-- VIRUSES -->
    <section>
      <div class="section-head">
        <div class="section-num">2.1</div>
        <div>
          <div class="section-title">🦠 Viren · 5 Subtypen</div>
          <div class="section-desc">Jeder Virus-Subtyp hat eine eigene Mechanik. Standard-Counter ist T-Killer, aber jeder Subtyp braucht eine andere Strategie.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">

        <div class="pathogen-card" style="--enemy-color: var(--p-virus);">
          <div class="pathogen-visual spiky"></div>
          <div class="pathogen-name">Standard-Virus</div>
          <div class="pathogen-type">Spike-Protein · Replikator</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">35</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Schnell</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">8</div></div>
          </div>
          <div class="pathogen-special">Hijackt Zellen, um sich zu replizieren.</div>
          <div class="pathogen-ability">
            <strong>Replikation</strong>
            <span>Infiziert RBCs → spawnt nach 4s einen weiteren Virus-Klon.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-tk);"></span>T-Killer</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-nk);"></span>NK-Zelle</span>
            </div>
          </div>
        </div>

        <div class="pathogen-card" style="--enemy-color: var(--p-corona);">
          <div class="pathogen-visual spiky"></div>
          <div class="pathogen-name">Corona-Virus</div>
          <div class="pathogen-type">Krone · Hochansteckend</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">45</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Mittel</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">10</div></div>
          </div>
          <div class="pathogen-special">Spike-Krone bindet leicht an Zellen. Verbreitet sich rasant.</div>
          <div class="pathogen-ability">
            <strong>Aerosol</strong>
            <span>Infiziert alle 6s eine RBC im Radius. Kann bis zu 3 RBCs gleichzeitig infizieren.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-bz);"></span>B-Zelle (Antikörper)</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-tk);"></span>T-Killer</span>
            </div>
          </div>
        </div>

        <div class="pathogen-card" style="--enemy-color: var(--p-flu);">
          <div class="pathogen-visual spiky"></div>
          <div class="pathogen-name">Influenza</div>
          <div class="pathogen-type">Wandlungsfähig · Mutator</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">30</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Schnell</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">7</div></div>
          </div>
          <div class="pathogen-special">Mutiert ständig. Antikörper greifen nicht zuverlässig.</div>
          <div class="pathogen-ability">
            <strong>Mutation</strong>
            <span>Alle 8s neue Schwäche-Resistenz. Antikörper-Markierungen fallen ab.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-nk);"></span>NK-Zelle</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-tk);"></span>T-Killer</span>
            </div>
          </div>
        </div>

        <div class="pathogen-card" style="--enemy-color: var(--p-phage);">
          <div class="pathogen-visual"></div>
          <div class="pathogen-name">Bakteriophage</div>
          <div class="pathogen-type">Anti-Bakterien · Ironisch</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">25</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Schnell</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">5</div></div>
          </div>
          <div class="pathogen-special">Greift Bakterien an, ist aber selbst ein Eindringling. Allianz-Mechanik!</div>
          <div class="pathogen-ability">
            <strong>Symbiose</strong>
            <span>Ignoriert RBCs. Tötet andere Bakterien-Pathogene auf der Map. Optionaler Verbündeter — wenn du keine Bakterien hast.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-tk);"></span>T-Killer</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-bz);"></span>B-Zelle</span>
            </div>
          </div>
        </div>

        <div class="pathogen-card boss" style="--enemy-color: var(--p-retro);">
          <div class="pathogen-visual spiky"></div>
          <div class="pathogen-name">Retrovirus</div>
          <div class="pathogen-type">Versteckt · Schläfer</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">80</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Langsam</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">12</div></div>
          </div>
          <div class="pathogen-special">Versteckt sich in Körperzellen, lange Inkubation.</div>
          <div class="pathogen-ability">
            <strong>Latenz</strong>
            <span>Wird unsichtbar für 5s nach RBC-Kontakt. Nur NK-Zellen können es während Latenz finden.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-nk);"></span>NK-Zelle</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-tk);"></span>T-Killer</span>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- BACTERIA -->
    <section>
      <div class="section-head">
        <div class="section-num">2.2</div>
        <div>
          <div class="section-title">🧫 Bakterien · 2 Subtypen</div>
          <div class="section-desc">Klassische Schwarm-Gegner. Massen statt Spezialfähigkeiten.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">

        <div class="pathogen-card" style="--enemy-color: var(--p-germ);">
          <div class="pathogen-visual"></div>
          <div class="pathogen-name">Germ</div>
          <div class="pathogen-type">Generischer Mikrobe · Häufig</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">20</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Mittel</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">5</div></div>
          </div>
          <div class="pathogen-special">Opportunistischer Infektor — knubbelig, generisch, Massenware.</div>
          <div class="pathogen-ability">
            <strong>Schwarm</strong>
            <span>Spawnt in Gruppen von 5–8. Niedrige Einzel-Werte, hohe Stückzahl.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-neu);"></span>Neutrophile</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-mac);"></span>Makrophage</span>
            </div>
          </div>
        </div>

        <div class="pathogen-card" style="--enemy-color: var(--p-bact);">
          <div class="pathogen-visual rod"></div>
          <div class="pathogen-name">Bacterium</div>
          <div class="pathogen-type">Stäbchen mit Flagellum · Schnell</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">25</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Sehr schnell</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">6</div></div>
          </div>
          <div class="pathogen-special">Stäbchenförmig, schwimmt mit peitschendem Flagellum.</div>
          <div class="pathogen-ability">
            <strong>Sprint</strong>
            <span>+50% Speed nach 3s, dann 2s Erschöpfung. Ändert Path-Tempo dynamisch.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-neu);"></span>Neutrophile</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-bas);"></span>Basophil (Slow)</span>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- PARASITES -->
    <section>
      <div class="section-head">
        <div class="section-num">2.3</div>
        <div>
          <div class="section-title">🪱 Parasiten · 2 Subtypen</div>
          <div class="section-desc">Groß und zäh. Brauchen Eosinophile oder Antikörper-Markierung.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">

        <div class="pathogen-card" style="--enemy-color: var(--p-amoeba);">
          <div class="pathogen-visual amorph"></div>
          <div class="pathogen-name">Amöbe</div>
          <div class="pathogen-type">Amorph · Engulfer</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">120</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Langsam</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">15</div></div>
          </div>
          <div class="pathogen-special">Kriecht und engulft Gewebe. Zu groß zum Fressen für Phagozyten.</div>
          <div class="pathogen-ability">
            <strong>Engulfen</strong>
            <span>Kann Neutrophile in 30px-Radius "verschlucken" — entfernt sie aus dem Spiel.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-eos);"></span>Eosinophil</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-bz);"></span>B-Zelle (markiert)</span>
            </div>
          </div>
        </div>

        <div class="pathogen-card" style="--enemy-color: var(--p-mite);">
          <div class="pathogen-visual"></div>
          <div class="pathogen-name">Mite</div>
          <div class="pathogen-type">Krabbeltier · Multi-Bein</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">60</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Mittel</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">8</div></div>
          </div>
          <div class="pathogen-special">Winziges huschendes Bug; viele kleine Beine ermöglichen Pfad-Wechsel.</div>
          <div class="pathogen-ability">
            <strong>Pfad-Wechsel</strong>
            <span>Wechselt alle 5s die Bahn. Schwer zu treffen mit fest platzierten Türmen.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-eos);"></span>Eosinophil</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-mast);"></span>Mast Cell (AoE)</span>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- FUNGI -->
    <section>
      <div class="section-head">
        <div class="section-num">2.4</div>
        <div>
          <div class="section-title">🍄 Pilze · 2 Subtypen</div>
          <div class="section-desc">Vermehren sich, hinterlassen Spuren. Müssen schnell eliminiert werden.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">

        <div class="pathogen-card" style="--enemy-color: var(--p-slime);">
          <div class="pathogen-visual amorph"></div>
          <div class="pathogen-name">Slime</div>
          <div class="pathogen-type">Biofilm · Tropfend</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">70</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Sehr langsam</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">12</div></div>
          </div>
          <div class="pathogen-special">Schleimige Biofilm-Kugel; tropft toxischen Schleim aus.</div>
          <div class="pathogen-ability">
            <strong>Schleim-Spur</strong>
            <span>Hinterlässt Toxin-Pfütze, die 6s lang Schaden an deinen Zellen macht.</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-neu);"></span>Neutrophile</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-mac);"></span>Makrophage</span>
            </div>
          </div>
        </div>

        <div class="pathogen-card" style="--enemy-color: var(--p-spore);">
          <div class="pathogen-visual"></div>
          <div class="pathogen-name">Spore</div>
          <div class="pathogen-type">Pilz-Spore · Drift</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">50</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Mittel</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">10</div></div>
          </div>
          <div class="pathogen-special">Driftet auf Strömungen; sät neue Wachstumspunkte.</div>
          <div class="pathogen-ability">
            <strong>Vermehrung</strong>
            <span>Spawnt alle 5s eine neue Spore. Aus 1 wird 2 → 4 → 8. Schnell handeln!</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Schwach gegen</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-neu);"></span>Neutrophile</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-mast);"></span>Mast Cell</span>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- TOXINS -->
    <section>
      <div class="section-head">
        <div class="section-num">2.5</div>
        <div>
          <div class="section-title">☠️ Toxine · Neue Kategorie</div>
          <div class="section-desc">Keine lebenden Gegner. Driften passiv, verursachen AoE-Schaden. Nur Histamin-Zellen helfen.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">

        <div class="pathogen-card" style="--enemy-color: var(--p-toxin);">
          <div class="pathogen-visual crystal"></div>
          <div class="pathogen-name">Toxin</div>
          <div class="pathogen-type">Kristall · Keine HP</div>
          <div class="pathogen-stats">
            <div><div class="stat-label">HP</div><div class="stat-value">∞</div></div>
            <div><div class="stat-label">Speed</div><div class="stat-value">Drift</div></div>
            <div><div class="stat-label">DMG</div><div class="stat-value">3/Sek</div></div>
          </div>
          <div class="pathogen-special">Gezackter Toxin-Kristall driftet und brennt bei Kontakt.</div>
          <div class="pathogen-ability">
            <strong>Neutralisierung</strong>
            <span>Kann nicht "getötet" werden. Nur <strong>Mast Cell</strong> oder <strong>Basophil</strong> können Toxin per Histamin auflösen (3 Sek Kontakt).</span>
          </div>
          <div class="weakness-row">
            <div class="weakness-label">Auflösbar durch</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <span class="weakness-chip"><span class="dot" style="background: var(--c-mast);"></span>Mast Cell</span>
              <span class="weakness-chip"><span class="dot" style="background: var(--c-bas);"></span>Basophil</span>
            </div>
          </div>
        </div>

      </div>

      <div class="callout callout-warn">
        <strong>Wichtig:</strong> Toxine machen das Spiel taktisch komplexer. Wenn der Spieler Mast Cells und Basophile nicht in seinem Roster hat, akkumulieren Toxine und vergiften das Schlachtfeld.
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 03: DIAGRAMS                            -->
  <!-- =============================================== -->
