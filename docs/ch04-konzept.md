<!-- Kapitel 04 · Spielkonzept & Tiers
     Extracted verbatim from docs/_source.html (lines 1449-1518).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch04">
    <div class="chapter-header">
      <div class="chapter-num">04</div>
      <div class="chapter-title-block">
        <h2>Spielkonzept &<br><em>Tiers</em></h2>
        <div class="chapter-subtitle">Lebende Zellen + Roguelike-Memory. Keine statischen Türme — Zellen bewegen sich, jagen, sterben. Komposition und Timing zählen mehr als Position.</div>
      </div>
    </div>

    <div class="principle">
      <div class="principle-symbol">A+B</div>
      <div>
        <h3>Lebendes Schlachtfeld mit Roguelike-Memory</h3>
        <p>Platzierte Zellen sind keine Türme — sie <strong>leben, jagen und sterben autonom</strong> (siehe §11 Physik). Der Spieler entscheidet, <em>welche</em> Zellen im Roster sind und <em>wann</em> sie auf das Feld kommen, nicht wo sie stehen sollen. Der Tower-Defense-Anker bleibt nur in der Aktivierungskaskade: angeborene Zellen → DC → adaptive Zellen → Memory. Mit 12 Helden und 12 Pathogenen wird die <strong>Roster-Wahl vor jedem Kampf</strong> zur strategischen Kernentscheidung; die Briefing-Karte vor jedem Level zeigt, wogegen das Roster greift (siehe §12).</p>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">4.1</div>
        <div>
          <div class="section-title">Roster-System (NEU)</div>
          <div class="section-desc">Vor jeder Welle wählt der Spieler 6 von 12 Helden. Niemand hat alles dabei — Synergien wählen!</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.15em; margin-bottom: 8px;">SLOT 1–3</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Pflicht: Core-Zellen</div>
          <div style="color: var(--ink-dim); font-size: 13px;">Mindestens eine Zelle aus Tier 1 als Grundgerüst. Empfohlen: MAC, NEU, DC.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent-violet);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-violet); letter-spacing: 0.15em; margin-bottom: 8px;">SLOT 4–5</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Spezialisten</div>
          <div style="color: var(--ink-dim); font-size: 13px;">Tier 2 wählen je nach Welle. NK gegen Viren, EOS gegen Parasiten, MAST gegen Toxine.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--c-plt);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--c-plt); letter-spacing: 0.15em; margin-bottom: 8px;">SLOT 6</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Utility</div>
          <div style="color: var(--ink-dim); font-size: 13px;">Optional: Monocyte für günstige Konvertierung oder Platelet für Heilung/Barriere.</div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">4.2</div>
        <div>
          <div class="section-title">Was der Spieler tut</div>
          <div class="section-desc">Die 6 Kern-Handlungen aus v8 plus 2 neue.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 01</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Roster wählen</div><div style="color: var(--ink-dim); font-size: 13px;">6 von 12 Helden vor jeder Welle.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 02</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Zellen entsenden</div><div style="color: var(--ink-dim); font-size: 13px;">Energie ausgeben — danach jagen sie autonom.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 03</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Phasen beachten</div><div style="color: var(--ink-dim); font-size: 13px;">Adaptive Zellen erst nach DC verfügbar.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 04</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Pathogen-Subtyp lesen</div><div style="color: var(--ink-dim); font-size: 13px;">Corona, Influenza, Retrovirus — verschiedene Konter!</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 05</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Toxine neutralisieren</div><div style="color: var(--ink-dim); font-size: 13px;">Mast Cell oder Basophil bereithalten.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 06</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Synergien nutzen</div><div style="color: var(--ink-dim); font-size: 13px;">T-Helfer-Aura + Antikörper + Schwarm = 4× DMG.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 07</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Entzündung managen</div><div style="color: var(--ink-dim); font-size: 13px;">Zu viele Zellen → eigene Schäden.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 08</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Memory aufbauen</div><div style="color: var(--ink-dim); font-size: 13px;">Memory-Zellen über Runs hinweg sammeln.</div></div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">4.3</div>
        <div>
          <div class="section-title">Spielmodi</div>
          <div class="section-desc">Zwei Modi mit demselben Kern — autonome Zellen, lebendes Schlachtfeld. Roster, Progression und Win/Lose-Bedingungen unterscheiden sich.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-280">
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.15em; margin-bottom: 8px;">MODUS A</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Kampagne</div>
          <div style="color: var(--ink-dim); font-size: 13px; margin-bottom: 10px;">18 Levels in 3 Akten (siehe §6). Jedes Level mit Pre-Level-Briefing (§12).</div>
          <ul style="color: var(--ink-dim); font-size: 12px; line-height: 1.5; padding-left: 18px;">
            <li>Roster-Wahl: 6 von 12 Helden (§4.1)</li>
            <li>Phase-Sperre: adaptive Zellen erst nach DC</li>
            <li>Energy-Cost pro Spawn (15–80⚡)</li>
            <li>Codex-Discovery aktiv (§5)</li>
            <li>Memory-Zellen über Runs hinweg</li>
            <li>Win/Lose-Conditions je Level (§8.1)</li>
          </ul>
        </div>
        <div class="card card-side" style="--card-color: var(--accent-cool);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent-cool); letter-spacing: 0.15em; margin-bottom: 8px;">MODUS B</div>
          <div style="font-size: 17px; font-weight: 500; margin-bottom: 6px;">Free Game <span class="badge badge-tier-utility">Sandbox</span></div>
          <div style="color: var(--ink-dim); font-size: 13px; margin-bottom: 10px;">Endlos-Sandbox. Spieler spawnt jede Zelle und jedes Pathogen frei und beobachtet, wie das System reagiert.</div>
          <ul style="color: var(--ink-dim); font-size: 12px; line-height: 1.5; padding-left: 18px;">
            <li><strong>Spawning</strong>: alle Helden, Pathogen-Subtypen und RBC-Filler — kein Roster-Limit, keine Phase-Sperre</li>
            <li><strong>Energy</strong>: optional aus (default) oder per Slider auf Kampagnen-Werte</li>
            <li><strong>Progression</strong>: keine — Codex zeigt alles offen, keine Memory-Zellen</li>
            <li><strong>Win/Lose</strong>: keine — Sim läuft endlos</li>
            <li><strong>Briefing-Karte (§12.1–§12.4)</strong>: deaktiviert (kein Level)</li>
            <li><strong>Status-Line (§12.5)</strong>: bleibt aktiv und zeigt Konter für die fokussierte Pathogen-Instanz</li>
          </ul>
        </div>
      </div>

      <div class="callout" style="margin-top: 16px;">
        <strong>Designziel:</strong> Free Game ist <em>kein</em> separates Code-Pfad-Projekt — die Kern-Sim (§11 Physik) läuft in beiden Modi gleich. Modus-Spezifika sind <em>Restriktionen</em>, die in Free Game schlicht abgeschaltet werden. Der bereits existierende Live-Simulator <em>ist</em> de facto Free Game.
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 05: ADAPTIVE CODEX                      -->
  <!-- =============================================== -->
