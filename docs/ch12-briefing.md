<!-- Kapitel 12 · Briefing (NEU)
     Eingeführt in v10.x als Reaktion auf das neue "lebende Zellen"-
     Designziel: Wenn Zellen autonom jagen, muss der Spieler vor und
     während des Levels wissen, gegen wen sein Roster antritt und mit
     welchen Mitteln. Das Briefing ist die Single-Source-of-Truth dafür.
     md2book passes raw HTML through; styling comes from style.css. -->

  <div class="chapter" id="ch12">
    <div class="chapter-header">
      <div class="chapter-num">12</div>
      <div class="chapter-title-block">
        <h2>Briefing &<br><em>Konter-Quickref</em></h2>
        <div class="chapter-subtitle">Vor jedem Level: Wer kommt, wie schlagen wir sie. Während des Levels: jederzeit per HUD-Button aufrufbar. Single-Source-of-Truth zwischen Codex (§5) und Schadens-Matrix (§10).</div>
      </div>
    </div>

    <div class="principle">
      <div class="principle-symbol">i</div>
      <div>
        <h3>Lebende Zellen brauchen klare Erwartungen</h3>
        <p>Da platzierte Zellen autonom agieren (siehe §11), kann der Spieler nicht durch Mikro-Management einen falschen Konter ausgleichen. Das Briefing setzt vor jedem Level <strong>klare Erwartungen</strong>: welche Pathogen-Subtypen erscheinen, welche bereits im Codex erschlossen sind und welche Helden des aktuellen Rosters sie schlagen. Der Spieler entscheidet vor dem Start; das Spiel respektiert die Entscheidung.</p>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">12.1</div>
        <div>
          <div class="section-title">Pre-Level Briefing-Karte</div>
          <div class="section-desc">Erscheint nach Roster-Wahl, vor dem ersten Spawn. Spielzeit pausiert.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.15em; margin-bottom: 8px;">SEKTION 1</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Erwartete Gegner</div>
          <div style="color: var(--ink-dim); font-size: 13px;">3–6 Pathogen-Subtypen mit Icon, 1-Zeilen-Rolle und Wave-Reihenfolge. Bekannte Subtypen voll sichtbar; im Codex unbekannte als „?" mit Tier-Hinweis.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent-warm);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-warm); letter-spacing: 0.15em; margin-bottom: 8px;">SEKTION 2</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Wie schlägt man sie</div>
          <div style="color: var(--ink-dim); font-size: 13px;">Pro Pathogen: 1–2 empfohlene Helden + Synergie-Hinweis. Quelle: Schadens-Matrix (§10) gefiltert auf das aktuelle Roster.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent-cool);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-cool); letter-spacing: 0.15em; margin-bottom: 8px;">SEKTION 3</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Dein Roster</div>
          <div style="color: var(--ink-dim); font-size: 13px;">Die 6 gewählten Helden mit Tier-Badge und Phase-Verfügbarkeit (innate · adaptive · utility). Visueller Abgleich gegen Sektion 1.</div>
        </div>
      </div>

      <div class="callout" style="margin-top: 16px;">
        <strong>Wichtig:</strong> Das Briefing zeigt <em>nicht</em> exakte Spawn-Positionen oder Wave-Counts — der Spieler bekommt eine strategische Übersicht, kein Lösungsbuch. Mikro-Variation bleibt erhalten.
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">12.2</div>
        <div>
          <div class="section-title">In-Level Briefing-Button</div>
          <div class="section-desc">Permanent auf dem HUD. Pausiert die Sim auf Klick.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› HUD</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Briefing-Button (i)</div><div style="color: var(--ink-dim); font-size: 13px;">Oben rechts neben den drei Lebensbalken (siehe §8.2 HUD).</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› Klick</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Sim pausiert</div><div style="color: var(--ink-dim); font-size: 13px;">Sim-Tick auf 0; Animationen einfrieren. Briefing-Karte slidet ein.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› Update</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Codex-live</div><div style="color: var(--ink-dim); font-size: 13px;">Schwächen, die der Spieler bereits entdeckt hat (§5 Codex), werden im Briefing nachträglich enthüllt.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› Schließen</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">ESC / klick außerhalb</div><div style="color: var(--ink-dim); font-size: 13px;">Sim läuft weiter ab dem pausierten Tick. Keine Strafe für Aufrufe.</div></div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">12.3</div>
        <div>
          <div class="section-title">Datenquelle</div>
          <div class="section-desc">Briefing ist eine View — keine eigene Datenhaltung.</div>
        </div>
      </div>

      <table class="matrix-table">
        <thead>
          <tr>
            <th>Briefing-Sektion</th>
            <th>Quelle</th>
            <th>Filter / Logik</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Erwartete Gegner</td>
            <td>§6 Level-Definition (Pathogen-Liste pro Level)</td>
            <td>Subtypen aus Wave-Schedule extrahieren; Reihenfolge erhalten</td>
          </tr>
          <tr>
            <td>Konter pro Gegner</td>
            <td>§10 Schadens-Matrix</td>
            <td>Beste 1–2 Helden ∩ aktuelles 6er-Roster (§4.1)</td>
          </tr>
          <tr>
            <td>Konter-Subtyp / Tier-Hinweis</td>
            <td>§5 Adaptiver Codex (Discovery-State)</td>
            <td>Discovery=true → voll · Discovery=false → „?" mit Tier-Badge</td>
          </tr>
          <tr>
            <td>Roster-Sektion</td>
            <td>§4.1 Roster-System (6er-Loadout)</td>
            <td>Helden mit Phase-Status (innate / adaptive / utility)</td>
          </tr>
          <tr>
            <td>Synergie-Hinweis</td>
            <td>§10 Schadens-Matrix (Synergie-Spalte)</td>
            <td>Nur Synergien anzeigen, deren beide Teile im Roster sind</td>
          </tr>
        </tbody>
      </table>

      <div class="callout" style="margin-top: 16px;">
        <strong>Implementierungs-Hinweis:</strong> Da Briefing ein reiner View-Layer auf bestehende Daten ist, kann es ohne neue Game-Tables ausgeliefert werden. Einzige neue State-Komponente: ein <code>briefingOpen</code>-Flag plus die Sim-Pause-Hook.
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">12.4</div>
        <div>
          <div class="section-title">Beispiel: Lvl 7 (Akt 2, Komplikation)</div>
          <div class="section-desc">Wie ein konkretes Briefing für ein Mid-Game-Level aussieht.</div>
        </div>
      </div>

      <div class="diagram-card">
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.15em; margin-bottom: 12px;">BRIEFING · LVL 7 · KOMPLIKATION</div>

        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-warm); letter-spacing: 0.15em; margin-bottom: 6px;">ERWARTETE GEGNER</div>
        <ul style="margin-bottom: 16px;">
          <li><strong>Influenza</strong> · Virus, mutiert je Welle. <em>Konter:</em> NK + Antikörper-Synergie</li>
          <li><strong>Streptococcus</strong> · Bakterie, Schwarm. <em>Konter:</em> Neutrophil-Welle + MAC</li>
          <li><strong>Toxin-Wolke (Tier 3)</strong> · <em>Konter:</em> ? — Subtyp im Codex unentdeckt</li>
        </ul>

        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-cool); letter-spacing: 0.15em; margin-bottom: 6px;">DEIN ROSTER (6/12)</div>
        <ul style="margin-bottom: 16px;">
          <li><strong>MAC</strong> · Core · sofort verfügbar</li>
          <li><strong>NEU</strong> · Core · sofort verfügbar</li>
          <li><strong>DC</strong> · Core · sofort verfügbar</li>
          <li><strong>NK</strong> · Special · sofort verfügbar (Ausnahme)</li>
          <li><strong>T-Helfer</strong> · Special · adaptive (nach DC)</li>
          <li><strong>Mast Cell</strong> · Utility · sofort verfügbar</li>
        </ul>

        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.15em; margin-bottom: 6px;">SYNERGIEN IM ROSTER</div>
        <ul>
          <li>T-Helfer-Aura + Antikörper + Schwarm = <strong>4× DMG</strong> (siehe §10)</li>
          <li>Mast Cell vorhalten für Tier-3-Toxin (Konter „?" — nach Kontakt enthüllt)</li>
        </ul>
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- END OF DOCUMENT                                 -->
  <!-- =============================================== -->
