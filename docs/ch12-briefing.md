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
        <div class="chapter-subtitle">Vor jedem Level, während des Levels — und permanent als Status-Line. Single-Source-of-Truth zwischen Codex (§5) und Schadens-Matrix (§10), modus-übergreifend (Kampagne &amp; Free Game).</div>
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

    <section>
      <div class="section-head">
        <div class="section-num">12.5</div>
        <div>
          <div class="section-title">Permanente Status-Line</div>
          <div class="section-desc">Echtzeit-Hinweis am HUD: aktueller Gegner + Konter. Modus-unabhängig. Sim läuft weiter.</div>
        </div>
      </div>

      <div class="principle">
        <div class="principle-symbol">›</div>
        <div>
          <h3>Briefing für den nächsten Atemzug</h3>
          <p>Während die Briefing-Karte (§12.1–§12.4) <em>strategisch</em> wirkt — pausiert das Spiel, gibt einen Überblick — wirkt die Status-Line <em>taktisch</em>: eine Zeile am HUD, die den aktuell relevanten Gegner und seinen Konter zeigt, ohne das Spiel zu unterbrechen. Sie läuft <strong>in Kampagne und Free Game gleich</strong>.</p>
        </div>
      </div>

      <div class="grid-auto col-auto-280" style="margin-top: 16px;">
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› POSITION</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Unterer HUD-Rand</div><div style="color: var(--ink-dim); font-size: 13px;">Screen-fixed, oberhalb der drei Lebensbalken (§8.2).</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› LAYOUT</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Icon · Name → Konter</div><div style="color: var(--ink-dim); font-size: 13px;">Pathogen am Anfang der Zeile, Pfeil, Konter-Hinweis. JetBrains Mono.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› FOKUS</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Auswahl-Logik</div><div style="color: var(--ink-dim); font-size: 13px;">Hover/Tap → diese Instanz. Sonst: nächstgelegener Gegner. Sonst: Idle-Zeile.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› CODEX</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Discovery-Aware</div><div style="color: var(--ink-dim); font-size: 13px;">Kampagne: unentdeckte Schwächen als „?". Free Game: immer voll enthüllt.</div></div>
      </div>

      <div class="diagram-card" style="margin-top: 16px;">
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.15em; margin-bottom: 12px;">STATUS-LINE · BEISPIELE</div>

        <div style="font-family: 'JetBrains Mono', monospace; font-size: 14px; padding: 10px 14px; background: rgba(255,255,255,0.04); border-left: 3px solid var(--p-flu); margin-bottom: 8px;">
          <span style="color: var(--p-flu);">🦠 Influenza</span>
          <span style="color: var(--ink-dim);"> · Wandlungsfähig · 14 HP</span>
          <span style="color: var(--accent);"> &nbsp;→&nbsp; NK + Antikörper-Synergie</span>
        </div>

        <div style="font-family: 'JetBrains Mono', monospace; font-size: 14px; padding: 10px 14px; background: rgba(255,255,255,0.04); border-left: 3px solid var(--p-bact); margin-bottom: 8px;">
          <span style="color: var(--p-bact);">🧫 Bacterium</span>
          <span style="color: var(--ink-dim);"> · Stäbchen · 22 HP</span>
          <span style="color: var(--accent);"> &nbsp;→&nbsp; Neutrophil-Schwarm</span>
        </div>

        <div style="font-family: 'JetBrains Mono', monospace; font-size: 14px; padding: 10px 14px; background: rgba(255,255,255,0.04); border-left: 3px solid var(--p-toxin); margin-bottom: 8px;">
          <span style="color: var(--p-toxin);">☠️ Toxin (?)</span>
          <span style="color: var(--ink-dim);"> · Tier 3 · ?? HP</span>
          <span style="color: var(--accent-warm);"> &nbsp;→&nbsp; Konter unbekannt — Mast Cell vorhalten</span>
        </div>

        <div style="font-family: 'JetBrains Mono', monospace; font-size: 14px; padding: 10px 14px; background: rgba(255,255,255,0.04); border-left: 3px solid var(--ink-dim);">
          <span style="color: var(--ink-dim);">◆ Keine aktive Bedrohung — Patrouille läuft</span>
        </div>
      </div>

      <table class="matrix-table" style="margin-top: 16px;">
        <thead>
          <tr>
            <th>Status-Line-Sektion</th>
            <th>Quelle</th>
            <th>Logik</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Pathogen-Icon + Name</td>
            <td>fokussierte Instanz aus Sim-Loop</td>
            <td>Hover &gt; nächstgelegener Gegner &gt; Idle</td>
          </tr>
          <tr>
            <td>Sub-Stats (HP, Tier)</td>
            <td>Live aus Sim-State</td>
            <td>Aktualisiert mit Tick-Rate des Renderers</td>
          </tr>
          <tr>
            <td>Konter-Hinweis</td>
            <td>§10 Schadens-Matrix</td>
            <td>Beste 1-Zeilen-Empfehlung; Synergien wenn beide Teile im Roster (Kampagne) bzw. spawnable (Free Game)</td>
          </tr>
          <tr>
            <td>„?"-Maskierung</td>
            <td>§5 Codex Discovery-State</td>
            <td>Nur in Kampagne. Free Game: immer voll enthüllt.</td>
          </tr>
        </tbody>
      </table>

      <div class="callout" style="margin-top: 16px;">
        <strong>Modus-Unabhängigkeit:</strong> Status-Line ist die einzige Briefing-UX, die in <em>jedem</em> Spielmodus erscheint. Briefing-Karte (§12.1–§12.4) ist Kampagne-spezifisch (kein Level → kein Briefing); Status-Line lebt von Sim-State allein und braucht keinen Wave-Schedule.
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- END OF DOCUMENT                                 -->
  <!-- =============================================== -->
