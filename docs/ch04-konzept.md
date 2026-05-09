<!-- Kapitel 04 · Spielkonzept & Tiers
     Extracted verbatim from docs/_source.html (lines 1449-1518).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch04">
    <div class="chapter-header">
      <div class="chapter-num">04</div>
      <div class="chapter-title-block">
        <h2>Spielkonzept &<br><em>Tiers</em></h2>
        <div class="chapter-subtitle">Tower Defense + Roguelike-Memory. Mit erweitertem Roster wird die Komposition zur Schlüsselentscheidung.</div>
      </div>
    </div>

    <div class="principle">
      <div class="principle-symbol">A+B</div>
      <div>
        <h3>Tower Defense mit Roguelike-Memory</h3>
        <p>Der Tower-Defense-Teil macht die Aktivierungskaskade <strong>sichtbar</strong>. Memory-Zellen aus dem Roguelike-Teil belohnen den Spieler über mehrere Wellen hinweg. Mit 12 Helden und 12 Pathogenen wird die <strong>Roster-Wahl vor jedem Kampf</strong> zur strategischen Kernentscheidung.</p>
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
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 02</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Zellen platzieren</div><div style="color: var(--ink-dim); font-size: 13px;">Energie ausgeben, Zellen positionieren.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 03</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Phasen beachten</div><div style="color: var(--ink-dim); font-size: 13px;">Adaptive Zellen erst nach DC verfügbar.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 04</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Pathogen-Subtyp lesen</div><div style="color: var(--ink-dim); font-size: 13px;">Corona, Influenza, Retrovirus — verschiedene Konter!</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 05</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Toxine neutralisieren</div><div style="color: var(--ink-dim); font-size: 13px;">Mast Cell oder Basophil bereithalten.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 06</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Synergien nutzen</div><div style="color: var(--ink-dim); font-size: 13px;">T-Helfer-Aura + Antikörper + Schwarm = 4× DMG.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 07</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Entzündung managen</div><div style="color: var(--ink-dim); font-size: 13px;">Zu viele Zellen → eigene Schäden.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); margin-bottom: 8px;">› 08</div><div style="font-size: 16px; font-weight: 500; margin-bottom: 6px;">Memory aufbauen</div><div style="color: var(--ink-dim); font-size: 13px;">Memory-Zellen über Runs hinweg sammeln.</div></div>
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 05: ADAPTIVE CODEX                      -->
  <!-- =============================================== -->
