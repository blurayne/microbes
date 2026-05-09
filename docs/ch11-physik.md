<!-- Kapitel 11 · Physik & Magnetismus
     Extracted verbatim from docs/_source.html (lines 2475-2544).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch11">
    <div class="chapter-header">
      <div class="chapter-num">11</div>
      <div class="chapter-title-block">
        <h2>Physik &<br><em>Magnetismus</em></h2>
        <div class="chapter-subtitle">Drei Kräfte, die emergentes Verhalten erzeugen. Aus dem Live-Simulator übernommen.</div>
      </div>
    </div>

    <div class="principle">
      <div class="principle-symbol">⇌</div>
      <div>
        <h3>Zellen sind keine Türme — sie leben</h3>
        <p><strong>Das ist der Kern des Spiels.</strong> Platzierte Zellen verharren nicht an ihrem Spawn-Punkt; sie reagieren aufeinander mit <strong>Anziehung</strong>, <strong>Abstoßung</strong> oder <strong>neutralem Drift</strong>. RBCs strömen kontinuierlich durch die Blutbahn und schaffen Bewegung im Hintergrund. Aus diesen drei Kräften entstehen organische Formationen — ein Schwarm Neutrophiler, der Pathogene umkreist; eine Mast Cell, die zu einer Toxin-Wolke driftet; ein NK-Trupp, der virusinfizierte Zellen verfolgt. Statisches Tower-Defense-Verhalten ist hier explizit kein Designziel.</p>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">11.1</div>
        <div>
          <div class="section-title">Drei Grundkräfte</div>
          <div class="section-desc">⊕ Anziehung · ⊖ Abstoßung · ∼ Drift</div>
        </div>
      </div>

      <div class="grid-auto col-3 gap-12">
        <div class="card card-accent" style="--card-color: var(--force-attract);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 48px; color: var(--force-attract); line-height: 1; margin-bottom: 14px;">⊕</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--force-attract); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 10px;">Magnetisch</div>
          <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">Anziehung</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Cluster, Bonding, Schwärme. Bond-then-drift.</div>
        </div>
        <div class="card card-accent" style="--card-color: var(--force-repel);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 48px; color: var(--force-repel); line-height: 1; margin-bottom: 14px;">⊖</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--force-repel); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 10px;">Anti-Magnetisch</div>
          <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">Abstoßung</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Patrouille, Spread, Push apart with momentum.</div>
        </div>
        <div class="card card-accent" style="--card-color: var(--force-neutral);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 48px; color: var(--force-neutral); line-height: 1; margin-bottom: 14px;">∼</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--force-neutral); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 10px;">Neutral</div>
          <div style="font-size: 18px; font-weight: 500; margin-bottom: 8px;">Drift</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Brownsche Bewegung. RBCs fließen so durch die Blutbahn.</div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">11.2</div>
        <div>
          <div class="section-title">Physik-Parameter</div>
          <div class="section-desc">Konkrete Zahlen für die Implementierung.</div>
        </div>
      </div>

      <div class="grid-auto col-auto-220 gap-12">
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">Force ⊕</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">+0.3 — +1.5</div><div style="color: var(--ink-dim); font-size: 12px;">Anziehung schwach bis stark.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">Force ⊖</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">−0.2 — −0.8</div><div style="color: var(--ink-dim); font-size: 12px;">Abstoßung sanft bis mittel.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">Reichweite</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">60 — 200 px</div><div style="color: var(--ink-dim); font-size: 12px;">Bond-Range = 60, Aura = 200.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">Friction</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">0.92</div><div style="color: var(--ink-dim); font-size: 12px;">Velocity-Multiplikator pro Frame.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">Max Velocity</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">2.5 px/f</div><div style="color: var(--ink-dim); font-size: 12px;">Hard Cap.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">Bond-Dauer</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">2 — 4 s</div><div style="color: var(--ink-dim); font-size: 12px;">Bevor Zellen wieder driften.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">Min-Distance</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">14 px</div><div style="color: var(--ink-dim); font-size: 12px;">Hard collision.</div></div>
        <div class="card"><div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 6px;">RBC-Stream</div><div style="font-family: 'JetBrains Mono', monospace; font-size: 22px; color: var(--ink); margin-bottom: 4px;">1.2 px/f</div><div style="color: var(--ink-dim); font-size: 12px;">Konstante Strömung in Blutbahn.</div></div>
      </div>
    </section>
  </div>

