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
          <div class="pathogen-relations"
               data-friends="corona,influenza,bacteriophage,retrovirus"
               data-prey="rbc"
               data-foes="nk,tcell,bcell,macrophage,monocyte,dendritic">
            <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Andere Viren (Corona, Influenza, Phage, Retro)</span></div>
            <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Erythrozyten (Membran-Hijacking)</span></div>
            <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">NK, T-Killer, B-Zelle, Makrophage, Monozyt, Dendritische</span></div>
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
          <div class="pathogen-relations"
               data-friends="virus,influenza,bacteriophage,retrovirus"
               data-prey="rbc"
               data-foes="nk,tcell,bcell,macrophage,monocyte,dendritic">
            <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Andere Viren</span></div>
            <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Erythrozyten</span></div>
            <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">NK, T-Killer, B-Zelle, Makrophage</span></div>
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
            <div class="pathogen-relations"
                 data-friends="virus,corona,bacteriophage,retrovirus"
                 data-prey="rbc"
                 data-foes="nk,tcell,bcell,macrophage,monocyte,dendritic">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Andere Viren</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Erythrozyten</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">NK, T-Killer, B-Zelle, Makrophage</span></div>
            </div>
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
            <div class="pathogen-relations"
                 data-friends="virus,corona,influenza,retrovirus"
                 data-prey=""
                 data-foes="nk,tcell,bcell,macrophage">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Andere Viren</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list rel-empty">—</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">NK, T-Killer, B-Zelle, Makrophage</span></div>
            </div>
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
            <div class="pathogen-relations"
                 data-friends="virus,corona,influenza,bacteriophage"
                 data-prey="rbc"
                 data-foes="nk,tcell,bcell,macrophage,monocyte,dendritic">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Andere Viren</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Erythrozyten · genom-Integration</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">NK, T-Killer, B-Zelle, Makrophage</span></div>
            </div>
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
          <div class="pathogen-relations"
               data-friends="bacterium"
               data-prey=""
               data-foes="neutrophil,macrophage,monocyte,bcell,dendritic">
            <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Bakterium</span></div>
            <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list rel-empty">—</span></div>
            <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">Neutrophile, Makrophage, Monozyt, B-Zelle</span></div>
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
          <div class="pathogen-relations"
               data-friends="germ"
               data-prey=""
               data-foes="neutrophil,macrophage,monocyte,bcell,dendritic">
            <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Keim</span></div>
            <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list rel-empty">—</span></div>
            <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">Neutrophile, Makrophage, Monozyt, B-Zelle</span></div>
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
            <div class="pathogen-relations"
                 data-friends="mite"
                 data-prey="rbc"
                 data-foes="nk,basophil,mast,eosinophil,tcell,bcell,macrophage,monocyte,dendritic">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Milbe</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Erythrozyten (DPS 6)</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">NK, Basophile, Mastzelle, Eosinophile, T-Killer, B-Zelle, Makrophage</span></div>
            </div>
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
          <div class="pathogen-relations"
               data-friends="amoebaP"
               data-prey="rbc"
               data-foes="nk,basophil,tcell,eosinophil,mast,bcell,macrophage,monocyte,dendritic">
            <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Amöbe</span></div>
            <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list">Erythrozyten (DPS 4)</span></div>
            <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">Basophile (DPS 11), Eosinophile, NK, T-Killer, Mastzelle, B-Zelle, Makrophage</span></div>
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
          <div class="pathogen-relations"
               data-friends="spore"
               data-prey=""
               data-foes="neutrophil,macrophage,monocyte,bcell,dendritic">
            <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Spore</span></div>
            <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list rel-empty">—</span></div>
            <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">Neutrophile (DPS 4), Makrophage, Monozyt, B-Zelle, Dendritische</span></div>
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
            <div class="pathogen-relations"
                 data-friends="slime"
                 data-prey=""
                 data-foes="neutrophil,macrophage,monocyte,bcell,dendritic">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">Schleimpilz</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list rel-empty">—</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">Neutrophile (DPS 4), Makrophage, Monozyt, B-Zelle, Dendritische</span></div>
            </div>
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
            <div class="pathogen-relations"
                 data-friends=""
                 data-prey=""
                 data-foes="bcell,mast,basophil">
              <div class="rel-row"><span class="rel-label">Freunde</span><span class="rel-list">— (Sekretion, nicht Zelle)</span></div>
              <div class="rel-row"><span class="rel-label">Beute</span><span class="rel-list rel-empty">—</span></div>
              <div class="rel-row"><span class="rel-label">Feinde</span><span class="rel-list">B-Zelle (Antikörper), Mastzelle, Basophile</span></div>
            </div>
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

    <section class="tier-group" style="margin-top: 40px;">
      <h2 class="tier-title" style="margin-bottom: 6px;">§02.6 Übersichtstabelle — Pathogene</h2>
      <p style="color: var(--ink-dim); font-size: 12px; line-height: 1.5; margin-bottom: 12px; max-width: 700px;">
        Kompakte Liste der spielrelevanten Erreger mit Counter-Empfehlung. Detail-Karten + Schwächen siehe §02.1–§02.5. Die <code>data-foes</code>-Listen der Karten oben sind die kanonische Quelle für die <code>CELL_RELATIONS</code>-Tabelle in <code>assets/core/cell-relations.js</code>.
      </p>
      <div class="speed-table">
        <table>
          <thead>
            <tr><th>Pathogen</th><th>Klasse</th><th>Größe</th><th>Geschwindigkeit</th><th>Hauptkonter</th></tr>
          </thead>
          <tbody>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-virus);"></span>Standard-Virus</span></td><td><span class="badge badge-pathogen">Virus</span></td><td>0.02–0.3 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span><span></span></span></td><td>NK · T-Killer · B-Zelle (Antikörper)</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-corona);"></span>Coronavirus</span></td><td><span class="badge badge-pathogen">Virus</span></td><td>0.1 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span><span></span></span></td><td>B-Zelle (Spike-Antikörper) · NK</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-flu);"></span>Influenza</span></td><td><span class="badge badge-pathogen">Virus</span></td><td>0.08–0.12 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span><span class="active"></span></span></td><td>T-Killer · NK</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-phage);"></span>Bacteriophage</span></td><td><span class="badge badge-pathogen">Virus</span></td><td>0.05 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span></span><span></span></span></td><td>Macrophage · Neutrophil (frisst die Wirtsbakterien)</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-retro);"></span>Retrovirus (Boss)</span></td><td><span class="badge badge-boss">Boss</span></td><td>0.1 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span class="active"></span><span></span><span></span></span></td><td>T-Killer · B-Zelle · Dendritic (Memory)</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-germ);"></span>Germ</span></td><td><span class="badge badge-pathogen">Bakterium</span></td><td>1–2 μm</td><td><span class="speed-bar"><span class="active"></span><span></span><span></span><span></span><span></span></span></td><td>Neutrophil · Macrophage</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-bact);"></span>Bacterium</span></td><td><span class="badge badge-pathogen">Bakterium</span></td><td>1–5 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span></span><span></span><span></span></span></td><td>Neutrophil · Macrophage · B-Zelle</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-amoeba);"></span>Amoeba</span></td><td><span class="badge badge-pathogen">Parasit</span></td><td>10–50 μm</td><td><span class="speed-bar"><span class="active"></span><span></span><span></span><span></span><span></span></span></td><td>Macrophage · Eosinophil</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-mite);"></span>Mite</span></td><td><span class="badge badge-pathogen">Parasit</span></td><td>200–400 μm</td><td><span class="speed-bar"><span class="active"></span><span></span><span></span><span></span><span></span></span></td><td>Eosinophil · Mast Cell</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-slime);"></span>Slime Mold</span></td><td><span class="badge badge-pathogen">Pilz</span></td><td>1–100 mm Kolonie</td><td><span class="speed-bar"><span class="active"></span><span></span><span></span><span></span><span></span></span></td><td>Neutrophil · Macrophage · Eosinophil</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-spore);"></span>Spore</span></td><td><span class="badge badge-pathogen">Pilz</span></td><td>2–10 μm</td><td><span class="speed-bar"><span class="active"></span><span class="active"></span><span></span><span></span><span></span></span></td><td>Neutrophil · Eosinophil · B-Zelle</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--p-toxin);"></span>Toxin</span></td><td><span class="badge badge-pathogen">Toxin</span></td><td>—</td><td><span class="speed-bar"><span class="active"></span><span></span><span></span><span></span><span></span></span></td><td>B-Zelle (neutralisierende AK) · Mast · Basophil</td></tr>
          </tbody>
        </table>
      </div>
      <div class="callout">Counter-Empfehlungen folgen den <code>data-foes</code>-Listen der Detail-Karten — siehe §10 für die genauen DPS-Werte und §12 für eine Quick-Reference nach Phase.</div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 03: DIAGRAMS                            -->
  <!-- =============================================== -->
