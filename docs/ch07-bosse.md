<!-- Kapitel 07 · Boss-Katalog
     Extracted verbatim from docs/_source.html (lines 1994-2228).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch07">
    <div class="chapter-header">
      <div class="chapter-num">07</div>
      <div class="chapter-title-block">
        <h2>Boss-<em>Katalog</em></h2>
        <div class="chapter-subtitle">Sieben Bosse, vier mit eigenen Themes. Jeder Boss prüft eine spezifische Lektion.</div>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">7.1</div>
        <div>
          <div class="section-title">Boss-Übersicht</div>
          <div class="section-desc">2 Mini-Bosse · 2 Major-Bosse · 1 Final Boss. Pro Akt mindestens einer.</div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Level</th><th>Boss</th><th>Typ</th><th>Akt</th><th>Lehre</th><th>Difficulty</th></tr>
          </thead>
          <tbody>
            <tr><td>06</td><td><span style="color: var(--accent-warm); font-weight: 500;">Pyogenes Streptococcus</span></td><td>Mini-Boss</td><td>1</td><td>Bakterien-Schwärme stoppen</td><td>★★☆☆☆</td></tr>
            <tr><td>12</td><td><span style="color: var(--accent-warm); font-weight: 500;">Plasmodium Quartet</span></td><td>Major-Boss</td><td>2</td><td>Phasen-Wechsel managen</td><td>★★★★☆</td></tr>
            <tr><td>14</td><td><span style="color: var(--danger); font-weight: 500;">Aspergillus Fungus King</span></td><td>Mini-Boss</td><td>3</td><td>Vermehrung kontrollieren</td><td>★★★☆☆</td></tr>
            <tr><td>17</td><td><span style="color: var(--danger); font-weight: 500;">Sepsis Cascade</span></td><td>Major-Boss</td><td>3</td><td>Eigene Entzündung managen</td><td>★★★★★</td></tr>
            <tr style="background: rgba(200, 255, 90, 0.04);"><td><strong>18</strong></td><td><strong style="color: var(--accent);">★ Pandemic Hydra</strong></td><td><strong>FINAL</strong></td><td>3</td><td>Alles vereint anwenden</td><td>★★★★★</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">7.2</div>
        <div>
          <div class="section-title">Boss-Profile</div>
          <div class="section-desc">Detaillierte Beschreibung jedes Bosses mit Mechaniken und Konter-Strategie.</div>
        </div>
      </div>

      <div class="stack" style="gap: 20px;">

        <!-- BOSS 1 -->
        <div class="pathogen-card boss" style="--enemy-color: var(--accent-warm);">
          <div style="display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: start;">
            <div>
              <div class="pathogen-visual" style="width: 80px; height: 80px;"></div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent-warm); letter-spacing: 0.15em; text-transform: uppercase; margin-top: 8px;">Level 06</div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-dim); letter-spacing: 0.1em;">MINI-BOSS</div>
            </div>
            <div>
              <div class="pathogen-name" style="font-size: 24px;">Pyogenes Streptococcus</div>
              <div class="pathogen-type">Bakterien-Königin · Akt 1 Finale</div>
              <div class="pathogen-stats" style="grid-template-columns: repeat(4, 1fr);">
                <div><div class="stat-label">HP</div><div class="stat-value">300</div></div>
                <div><div class="stat-label">Speed</div><div class="stat-value">Mittel</div></div>
                <div><div class="stat-label">DMG</div><div class="stat-value">15</div></div>
                <div><div class="stat-label">Phasen</div><div class="stat-value">2</div></div>
              </div>
              <div class="pathogen-special">Massiver Bakterien-Schwarm-Boss. Spawnt unaufhörlich kleine Germs als Diener.</div>
              <div class="pathogen-ability">
                <strong>Schwarm-Mutter</strong>
                <span>Spawnt alle 4s 2 Germs. Bei 50% HP: spawnt alle 2s einen Bacterium. Heilt sich um 5 HP/Sek wenn Diener leben.</span>
              </div>
              <div class="weakness-row">
                <div class="weakness-label">Konter-Strategie</div>
                <div style="font-size: 13px; color: var(--ink); line-height: 1.5; margin-top: 6px;">Diener priorisieren! Wenn Schwarm dünn, konzentrieren. <strong>Mast Cell AoE</strong> ist ideal. Eosinophil hilft nicht (kein Parasit).</div>
              </div>
            </div>
          </div>
        </div>

        <!-- BOSS 2 -->
        <div class="pathogen-card boss" style="--enemy-color: var(--accent-warm);">
          <div style="display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: start;">
            <div>
              <div class="pathogen-visual amorph" style="width: 80px; height: 80px;"></div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent-warm); letter-spacing: 0.15em; text-transform: uppercase; margin-top: 8px;">Level 12</div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-dim); letter-spacing: 0.1em;">MAJOR-BOSS</div>
            </div>
            <div>
              <div class="pathogen-name" style="font-size: 24px;">Plasmodium Quartet</div>
              <div class="pathogen-type">4-Phasen-Parasit · Akt 2 Finale</div>
              <div class="pathogen-stats" style="grid-template-columns: repeat(4, 1fr);">
                <div><div class="stat-label">HP</div><div class="stat-value">600</div></div>
                <div><div class="stat-label">Speed</div><div class="stat-value">Variabel</div></div>
                <div><div class="stat-label">DMG</div><div class="stat-value">20</div></div>
                <div><div class="stat-label">Phasen</div><div class="stat-value">4</div></div>
              </div>
              <div class="pathogen-special">Wechselt zyklisch durch 4 Lebensphasen — jede mit anderen Schwächen. Inspired by Malaria.</div>
              <div class="pathogen-ability">
                <strong>Lebenszyklus</strong>
                <span>Phase 1 (RBC-Schwärmer): Anti-Virus-Schwäche. Phase 2 (Leberform): tankig, B-Zell-Schwäche. Phase 3 (Sporozoit): schnell, Slow nötig. Phase 4 (Gametozyt): Heilt sich, MUSS in &lt;15s zerstört werden.</span>
              </div>
              <div class="weakness-row">
                <div class="weakness-label">Konter-Strategie</div>
                <div style="font-size: 13px; color: var(--ink); line-height: 1.5; margin-top: 6px;">Diverses Roster Pflicht: <strong>NK + BZ + EOS + BAS</strong>. Phasen-Wechsel im HUD beobachten. Antikörper im Voraus aufbauen.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- BOSS 3 -->
        <div class="pathogen-card boss" style="--enemy-color: var(--danger);">
          <div style="display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: start;">
            <div>
              <div class="pathogen-visual" style="width: 80px; height: 80px; background: var(--p-spore); box-shadow: 0 0 20px var(--p-spore);"></div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--danger); letter-spacing: 0.15em; text-transform: uppercase; margin-top: 8px;">Level 14</div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-dim); letter-spacing: 0.1em;">MINI-BOSS</div>
            </div>
            <div>
              <div class="pathogen-name" style="font-size: 24px;">Aspergillus Fungus King</div>
              <div class="pathogen-type">Pilz-Boss · Sporen-Master</div>
              <div class="pathogen-stats" style="grid-template-columns: repeat(4, 1fr);">
                <div><div class="stat-label">HP</div><div class="stat-value">450</div></div>
                <div><div class="stat-label">Speed</div><div class="stat-value">Langsam</div></div>
                <div><div class="stat-label">DMG</div><div class="stat-value">12</div></div>
                <div><div class="stat-label">Phasen</div><div class="stat-value">3</div></div>
              </div>
              <div class="pathogen-special">Riesiger Pilz, der unkontrollierte Sporen-Wolken erzeugt. Vermehrungs-Druck.</div>
              <div class="pathogen-ability">
                <strong>Sporen-Sturm</strong>
                <span>Alle 8s eine Welle von 6 Sporen. Phase 2 (50% HP): Sporen werden zu Mini-Slimes. Phase 3 (20% HP): Toxin-Spuren überall — MAST/BAS jetzt entscheidend.</span>
              </div>
              <div class="weakness-row">
                <div class="weakness-label">Konter-Strategie</div>
                <div style="font-size: 13px; color: var(--ink); line-height: 1.5; margin-top: 6px;">Crowd-Control Pflicht: <strong>MAST + NEU-Schwarm + BAS</strong>. Sporen schnell platt machen, sonst exponentielle Vermehrung.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- BOSS 4 -->
        <div class="pathogen-card boss" style="--enemy-color: var(--danger);">
          <div style="display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: start;">
            <div>
              <div class="pathogen-visual" style="width: 80px; height: 80px; background: var(--danger); box-shadow: 0 0 24px var(--danger); border-radius: 30%;"></div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--danger); letter-spacing: 0.15em; text-transform: uppercase; margin-top: 8px;">Level 17</div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-dim); letter-spacing: 0.1em;">MAJOR-BOSS</div>
            </div>
            <div>
              <div class="pathogen-name" style="font-size: 24px;">Sepsis Cascade</div>
              <div class="pathogen-type">System-Boss · Cytokine-Storm</div>
              <div class="pathogen-stats" style="grid-template-columns: repeat(4, 1fr);">
                <div><div class="stat-label">HP</div><div class="stat-value">800</div></div>
                <div><div class="stat-label">Speed</div><div class="stat-value">—</div></div>
                <div><div class="stat-label">DMG</div><div class="stat-value">Indirekt</div></div>
                <div><div class="stat-label">Phasen</div><div class="stat-value">3</div></div>
              </div>
              <div class="pathogen-special"><strong>Stationärer System-Boss.</strong> Greift nicht direkt an, aber lässt deine Entzündung explodieren. Du musst dein eigenes Immunsystem managen!</div>
              <div class="pathogen-ability">
                <strong>Cytokine-Storm</strong>
                <span>Verdoppelt alle Entzündungs-Werte. Pro getöteter Zelle: +5% Entzündung. Heilt sich um 10 HP wenn Entzündung &gt;75%. <strong>Du kannst dich selbst zu Tode kämpfen!</strong></span>
              </div>
              <div class="weakness-row">
                <div class="weakness-label">Konter-Strategie</div>
                <div style="font-size: 13px; color: var(--ink); line-height: 1.5; margin-top: 6px;">Anti-Inflammation: <strong>BAS + PLT + minimale Truppen</strong>. T-Killer für Präzision. NEU-Spam = Game Over. Memory-Zellen aus früheren Runs spielen die Rolle ihres Lebens.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- FINAL BOSS -->
        <div class="pathogen-card boss" style="--enemy-color: var(--accent); border: 2px solid var(--accent); background: linear-gradient(135deg, rgba(200, 255, 90, 0.05), var(--bg-elev));">
          <div style="display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: start;">
            <div>
              <div class="pathogen-visual spiky" style="width: 96px; height: 96px; background: var(--accent); box-shadow: 0 0 32px var(--accent);"></div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-top: 8px;">★ Level 18</div>
              <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.1em; font-weight: 700;">FINAL BOSS</div>
            </div>
            <div>
              <div class="pathogen-name" style="font-size: 28px; color: var(--accent);">Pandemic Hydra</div>
              <div class="pathogen-type" style="color: var(--accent);">Mehrkopf-Mutant · Endgame</div>
              <div class="pathogen-stats" style="grid-template-columns: repeat(4, 1fr);">
                <div><div class="stat-label">HP</div><div class="stat-value">1500</div></div>
                <div><div class="stat-label">Speed</div><div class="stat-value">Variabel</div></div>
                <div><div class="stat-label">DMG</div><div class="stat-value">25</div></div>
                <div><div class="stat-label">Phasen</div><div class="stat-value">5</div></div>
              </div>
              <div class="pathogen-special" style="color: var(--ink); font-style: normal; font-size: 14px;">Der ultimative Test. Ein 5-köpfiger Pathogen, der zwischen <strong>allen 5 Kategorien</strong> wechselt: Virus → Bakterium → Parasit → Pilz → Toxin. Jeder Kopf hat eigene HP-Bar.</div>
              <div class="pathogen-ability">
                <strong>Hydra-Mechanik</strong>
                <span>Aktive Phase = Schwäche dieser Kategorie. Tot geschlagener Kopf wächst nach 30s nach. Bei 30% Total-HP: alle 5 Köpfe gleichzeitig aktiv. Spieler muss <strong>jede Lektion aus den vorherigen 17 Levels</strong> anwenden.</span>
              </div>
              <div class="weakness-row">
                <div class="weakness-label">Konter-Strategie</div>
                <div style="font-size: 14px; color: var(--ink); line-height: 1.5; margin-top: 6px;">Vollroster mit Memory-Bonus: <strong>NK + TK + BZ + MAST + BAS + EOS</strong>. Köpfe in optimaler Reihenfolge töten (Toxin zuletzt, da unsterblich aber heilbar). Der Boss <strong>kennt</strong> deine Strategie aus den vorherigen Bossen — er schaltet schneller.</div>
              </div>
              <div style="margin-top: 14px; padding: 12px 14px; background: rgba(200, 255, 90, 0.08); border-left: 2px solid var(--accent); border-radius: 0 3px 3px 0;">
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 4px;">★ Belohnung</div>
                <div style="font-size: 13px; color: var(--ink);">Bei Sieg: <strong>Permanente Memory-Zelle "Hydra-Killer"</strong> — gibt allen Helden +20% Schaden in zukünftigen Runs.</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">7.3</div>
        <div>
          <div class="section-title">Boss-Design-Philosophie</div>
          <div class="section-desc">Was macht einen guten Boss in diesem Spiel aus?</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">1. Lehrt eine Lektion</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Jeder Boss prüft eine spezifische Mechanik des Akts. Streptococcus = Schwärme. Plasmodium = Phasenwechsel. Sepsis = Selbst-Management.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">2. Mehrere Phasen</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Bei HP-Schwellen ändert sich Verhalten. Spieler muss nachdenken, nicht nur DPS pumpen.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">3. Klares Schwäche-Profil</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Codex-Eintrag macht Strategie klar. Boss-Phasen werden im HUD angekündigt mit ihren Schwächen.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">4. Persistente Belohnung</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Jeder Boss-Kill = Memory-Zelle für zukünftige Runs. Roguelike-Element wird greifbar.</div>
        </div>
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 08: RULES                               -->
  <!-- =============================================== -->
