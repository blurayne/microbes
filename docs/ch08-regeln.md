<!-- Kapitel 08 · Sieg, Niederlage & Regeln
     Extracted verbatim from docs/_source.html (lines 2229-2305).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch08">
    <div class="chapter-header">
      <div class="chapter-num">08</div>
      <div class="chapter-title-block">
        <h2>Sieg, Niederlage<br>& <em>Regeln</em></h2>
        <div class="chapter-subtitle">Drei Wege zu verlieren, drei Wege zu gewinnen. Vier Regeln zum Platzieren.</div>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">8.1</div>
        <div>
          <div class="section-title">Win/Lose-Conditions</div>
          <div class="section-desc">Mehrere Pfade machen das Spiel taktisch.</div>
        </div>
      </div>

      <div class="grid-auto col-2 gap-12">
        <div class="card" style="border-color: rgba(144, 238, 144, 0.3); background: linear-gradient(180deg, rgba(144, 238, 144, 0.04) 0%, var(--bg-elev) 100%);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--success); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 12px;">▲ Sieg</div>
          <div style="font-size: 22px; font-weight: 500; margin-bottom: 16px;">Du gewinnst, wenn ...</div>
          <div class="stack" style="gap: 10px;">
            <div style="padding: 12px 14px; background: rgba(0, 0, 0, 0.2); border-left: 2px solid var(--success); border-radius: 0 3px 3px 0;"><strong style="display: block; color: var(--success); font-size: 11px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.15em; margin-bottom: 4px;">W1 · Welle</strong><span style="font-size: 13px; color: var(--ink-dim);">Pathogene eliminiert / unter Leak-Limit. Belohnung: Energie + Memory-Karte.</span></div>
            <div style="padding: 12px 14px; background: rgba(0, 0, 0, 0.2); border-left: 2px solid var(--success); border-radius: 0 3px 3px 0;"><strong style="display: block; color: var(--success); font-size: 11px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.15em; margin-bottom: 4px;">W2 · Run</strong><span style="font-size: 13px; color: var(--ink-dim);">10 Standard-Wellen abgeschlossen. Boss erreicht.</span></div>
            <div style="padding: 12px 14px; background: rgba(0, 0, 0, 0.2); border-left: 2px solid var(--success); border-radius: 0 3px 3px 0;"><strong style="display: block; color: var(--success); font-size: 11px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.15em; margin-bottom: 4px;">W3 · Boss</strong><span style="font-size: 13px; color: var(--ink-dim);">Pandemie-Erreger besiegt. Permanente Memory-Zelle.</span></div>
          </div>
        </div>
        <div class="card" style="border-color: rgba(255, 90, 90, 0.3); background: linear-gradient(180deg, rgba(255, 90, 90, 0.04) 0%, var(--bg-elev) 100%);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--danger); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 12px;">▼ Niederlage</div>
          <div style="font-size: 22px; font-weight: 500; margin-bottom: 16px;">Du verlierst, wenn ...</div>
          <div class="stack" style="gap: 10px;">
            <div style="padding: 12px 14px; background: rgba(0, 0, 0, 0.2); border-left: 2px solid var(--danger); border-radius: 0 3px 3px 0;"><strong style="display: block; color: var(--danger); font-size: 11px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.15em; margin-bottom: 4px;">L1 · Organ-HP</strong><span style="font-size: 13px; color: var(--ink-dim);">Auf 0 gefallen. Zu viele Pathogene durchgekommen.</span></div>
            <div style="padding: 12px 14px; background: rgba(0, 0, 0, 0.2); border-left: 2px solid var(--danger); border-radius: 0 3px 3px 0;"><strong style="display: block; color: var(--danger); font-size: 11px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.15em; margin-bottom: 4px;">L2 · Entzündung</strong><span style="font-size: 13px; color: var(--ink-dim);">Auf 100% gestiegen. Sepsis-Mechanik.</span></div>
            <div style="padding: 12px 14px; background: rgba(0, 0, 0, 0.2); border-left: 2px solid var(--danger); border-radius: 0 3px 3px 0;"><strong style="display: block; color: var(--danger); font-size: 11px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.15em; margin-bottom: 4px;">L3 · Leaks</strong><span style="font-size: 13px; color: var(--ink-dim);">10 Pathogene durchgekommen. Sofort-Verlust.</span></div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">8.2</div>
        <div>
          <div class="section-title">HUD: Drei Lebensbalken</div>
          <div class="section-desc">Alle drei Verlust-Bedingungen jederzeit sichtbar.</div>
        </div>
      </div>
      <div class="hud-mock">
        <div class="hud-bars">
          <div class="hud-bar"><div class="hud-bar-header"><span class="hud-bar-label">▲ Organ-HP</span><span class="hud-bar-value" style="color: var(--success);">75 / 100</span></div><div class="hud-bar-track"><div class="hud-bar-fill fill-organ"></div></div></div>
          <div class="hud-bar"><div class="hud-bar-header"><span class="hud-bar-label">⚠ Entzündung</span><span class="hud-bar-value" style="color: var(--accent);">45%</span></div><div class="hud-bar-track"><div class="hud-bar-fill fill-inflammation"></div></div></div>
          <div class="hud-bar"><div class="hud-bar-header"><span class="hud-bar-label">▼ Durchgekommen</span><span class="hud-bar-value" style="color: var(--accent-warm);">3 / 10</span></div><div class="hud-bar-track"><div class="hud-bar-fill fill-leaked"></div></div></div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">8.3</div>
        <div>
          <div class="section-title">Vier Platzierungs-Regeln</div>
          <div class="section-desc">Alle vier müssen erfüllt sein.</div>
        </div>
      </div>
      <div class="stack">
        <div class="rule"><div class="rule-num">01</div><div class="rule-content"><h3>Genug Energie</h3><p>Energie regeneriert +8/Sek. Kosten: 15–80⚡ je nach Zelle.</p></div><div class="rule-check">⚡ Energie ≥ Kosten</div></div>
        <div class="rule"><div class="rule-num">02</div><div class="rule-content"><h3>Im Roster</h3><p>Nur Zellen aus dem gewählten 6er-Roster verfügbar (NEU in v9).</p></div><div class="rule-check">◆ Im Loadout</div></div>
        <div class="rule"><div class="rule-num">03</div><div class="rule-content"><h3>Richtige Phase</h3><p>Adaptive Zellen erst nach DC. NK ist die Ausnahme — sofort verfügbar.</p></div><div class="rule-check">◆ Phase frei</div></div>
        <div class="rule"><div class="rule-num">04</div><div class="rule-content"><h3>Cooldown vorbei</h3><p>Globaler Cooldown 2 Sek nach jeder Platzierung.</p></div><div class="rule-check">⏱ 2s Cooldown</div></div>
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 09: GAME FEEL                           -->
  <!-- =============================================== -->
