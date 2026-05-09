<!-- Kapitel 10 · Schadens-Matrix
     Extracted verbatim from docs/_source.html (lines 2357-2474).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch10">
    <div class="chapter-header">
      <div class="chapter-num">10</div>
      <div class="chapter-title-block">
        <h2>Schadens-<em>Matrix</em></h2>
        <div class="chapter-subtitle">Wer macht wie viel Schaden gegen welchen Pathogen-Subtyp? Erweitert auf alle 12 Helden × alle Pathogene.</div>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">10.1</div>
        <div>
          <div class="section-title">Schadens-Matrix · Helden vs Pathogene</div>
          <div class="section-desc">★★★ Hoch · ★★ Mittel · ★ Schwach · — Keine Wirkung · ✕ Verboten/sinnlos</div>
        </div>
      </div>

      <div class="table-wrap">
        <table class="matrix-table">
          <thead>
            <tr>
              <th>Held ↓ / Pathogen →</th>
              <th>Germ</th>
              <th>Bact.</th>
              <th>Virus</th>
              <th>Corona</th>
              <th>Flu</th>
              <th>Phage</th>
              <th>Retro</th>
              <th>Amöbe</th>
              <th>Mite</th>
              <th>Slime</th>
              <th>Spore</th>
              <th>Toxin</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-neu);"></span>Neutroph.</span></td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-normal">★★</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-weak">★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-none">✕</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-mac);"></span>Makroph.</span></td><td class="dmg-normal">★★</td><td class="dmg-normal">★★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-normal">★★</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-weak">★</td><td class="dmg-normal">★★</td><td class="dmg-normal">★★</td><td class="dmg-none">✕</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-dc);"></span>Dendrit. Z.</span></td><td colspan="12" style="color: var(--ink-dim); font-style: italic; font-family: 'Fraunces', serif;">Kein Direktschaden · Schaltet Phase 3 frei</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-th);"></span>T-Helfer</span></td><td colspan="12" style="color: var(--ink-dim); font-style: italic; font-family: 'Fraunces', serif;">Buff-Aura · +50% Schaden für alle Zellen in 100px Reichweite</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-tk);"></span>T-Killer</span></td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-none">✕</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-bz);"></span>B-Zelle</span></td><td class="dmg-normal">★★</td><td class="dmg-normal">★★</td><td class="dmg-normal">★★</td><td class="dmg-strong">★★★</td><td class="dmg-weak">★ (Mutation)</td><td class="dmg-normal">★★</td><td class="dmg-weak">★ (Latent)</td><td class="dmg-strong">★★★</td><td class="dmg-normal">★★</td><td class="dmg-normal">★★</td><td class="dmg-normal">★★</td><td class="dmg-none">✕</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-nk);"></span>Natural Killer</span></td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★ (sieht Latenz!)</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-none">✕</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-mast);"></span>Mast Cell</span></td><td class="dmg-normal">★★ (AoE)</td><td class="dmg-normal">★★ (AoE)</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-none">—</td><td class="dmg-normal">★★</td><td class="dmg-strong">★★★ (AoE)</td><td class="dmg-strong">★★★ (AoE)</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★ (löst auf!)</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-eos);"></span>Eosinophil</span></td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-none">—</td><td class="dmg-strong">★★★</td><td class="dmg-strong">★★★</td><td class="dmg-weak">★</td><td class="dmg-weak">★</td><td class="dmg-none">✕</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-bas);"></span>Basophil</span></td><td colspan="11" style="color: var(--ink-dim); font-style: italic; font-family: 'Fraunces', serif;">Slow-Field · 50% Speed-Reduktion für alle Pathogene in Reichweite</td><td class="dmg-strong">★★★ (löst auf!)</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-mon);"></span>Monocyte</span></td><td colspan="12" style="color: var(--ink-dim); font-style: italic; font-family: 'Fraunces', serif;">Wandelt sich nach 8s in MAC oder DC um · Spielerwahl</td></tr>
            <tr><td><span class="cell-tag"><span class="cell-dot" style="background: var(--c-plt);"></span>Platelet</span></td><td colspan="12" style="color: var(--ink-dim); font-style: italic; font-family: 'Fraunces', serif;">Barriere auf der Blutbahn · Slow + Heilung für Organ-HP</td></tr>
          </tbody>
        </table>
      </div>

      <div class="callout">
        <strong>Schlüsselerkenntnis:</strong> Mast Cell und Basophil sind die einzigen Toxin-Counter. NK ist der einzige Counter gegen Retrovirus während Latenz. Eosinophil ist Pflicht gegen Mites und Amöben.
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">10.2</div>
        <div>
          <div class="section-title">Top-Synergien (erweitert)</div>
          <div class="section-desc">Mit den neuen Helden ergeben sich neue Combos.</div>
        </div>
      </div>

      <div class="stack">
        <div class="card" style="border-left: 4px solid var(--accent); background: var(--bg-elev);">
          <div style="display: grid; grid-template-columns: 50px 1fr auto; gap: 20px; align-items: center;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 28px; color: var(--accent); line-height: 1;">1</div>
            <div><div style="font-size: 17px; font-weight: 500;">T-Helfer + B-Zelle + Neutrophile</div><div style="color: var(--ink-dim); font-size: 13px;">Klassiker. Buff-Aura × Antikörper-Mark × Schwarm-DPS.</div></div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: var(--accent); padding: 6px 12px; border: 1px solid var(--accent); border-radius: 4px;">×2.6</div>
          </div>
        </div>
        <div class="card" style="border-left: 4px solid var(--accent); background: var(--bg-elev);">
          <div style="display: grid; grid-template-columns: 50px 1fr auto; gap: 20px; align-items: center;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 28px; color: var(--accent); line-height: 1;">2</div>
            <div><div style="font-size: 17px; font-weight: 500;">Mast Cell + Eosinophil</div><div style="color: var(--ink-dim); font-size: 13px;">Histamin-AoE plus Anti-Parasit-Gift. Tötet ganze Mite-Wellen in Sekunden.</div></div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: var(--accent); padding: 6px 12px; border: 1px solid var(--accent); border-radius: 4px;">AoE×2</div>
          </div>
        </div>
        <div class="card" style="border-left: 4px solid var(--accent); background: var(--bg-elev);">
          <div style="display: grid; grid-template-columns: 50px 1fr auto; gap: 20px; align-items: center;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 28px; color: var(--accent); line-height: 1;">3</div>
            <div><div style="font-size: 17px; font-weight: 500;">Basophil + Neutrophile</div><div style="color: var(--ink-dim); font-size: 13px;">Slow-Field verlangsamt Pathogene → Neutrophile haben mehr Zeit. Sustained DPS.</div></div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: var(--accent); padding: 6px 12px; border: 1px solid var(--accent); border-radius: 4px;">×1.8</div>
          </div>
        </div>
        <div class="card" style="border-left: 4px solid var(--accent); background: var(--bg-elev);">
          <div style="display: grid; grid-template-columns: 50px 1fr auto; gap: 20px; align-items: center;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 28px; color: var(--accent); line-height: 1;">4</div>
            <div><div style="font-size: 17px; font-weight: 500;">NK + T-Helfer (Anti-Virus)</div><div style="color: var(--ink-dim); font-size: 13px;">NK braucht keine Phase 3. T-Helfer-Aura = sofort verfügbarer Anti-Virus-Boost.</div></div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: var(--accent); padding: 6px 12px; border: 1px solid var(--accent); border-radius: 4px;">×1.5</div>
          </div>
        </div>
        <div class="card" style="border-left: 4px solid var(--accent); background: var(--bg-elev);">
          <div style="display: grid; grid-template-columns: 50px 1fr auto; gap: 20px; align-items: center;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 28px; color: var(--accent); line-height: 1;">5</div>
            <div><div style="font-size: 17px; font-weight: 500;">Monocyte → Makrophage-Posten</div><div style="color: var(--ink-dim); font-size: 13px;">Günstige Monocyte für 20⚡ → wandelt zu MAC für effektiv 20⚡ statt 30⚡. Eine Makrophage spawnt dann passive Neutrophile.</div></div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: var(--accent); padding: 6px 12px; border: 1px solid var(--accent); border-radius: 4px;">∞ NEU</div>
          </div>
        </div>
        <div class="card" style="border-left: 4px solid var(--accent); background: var(--bg-elev);">
          <div style="display: grid; grid-template-columns: 50px 1fr auto; gap: 20px; align-items: center;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 28px; color: var(--accent); line-height: 1;">6</div>
            <div><div style="font-size: 17px; font-weight: 500;">Platelet-Wall + Basophil</div><div style="color: var(--ink-dim); font-size: 13px;">Plättchen bauen Barriere → Slow-Field davor. Pathogene staut sich, perfektes Ziel für AoE.</div></div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 18px; color: var(--accent); padding: 6px 12px; border: 1px solid var(--accent); border-radius: 4px;">Choke</div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 11: PHYSICS                             -->
  <!-- =============================================== -->
