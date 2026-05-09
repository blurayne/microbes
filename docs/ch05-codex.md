<!-- Kapitel 05 · Adaptiver Codex
     Extracted verbatim from docs/_source.html (lines 1519-1740).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch05">
    <div class="chapter-header">
      <div class="chapter-num">05</div>
      <div class="chapter-title-block">
        <h2>Adaptiver <em>Codex</em></h2>
        <div class="chapter-subtitle">Das Spiel lehrt sich selbst — adaptive Immunität als Tutorial-Mechanik. Spieler entdeckt Schwächen durch Kontakt.</div>
      </div>
    </div>

    <div class="principle">
      <div class="principle-symbol">?→★</div>
      <div>
        <h3>Lernen ist die Mechanik</h3>
        <p>Statt einer statischen Anleitung baut der Spieler über die Wellen hinweg sein eigenes Wissen auf. <strong>Erste Begegnung = blind</strong>. Nach Kontakt wird der Pathogen permanent im Codex eingetragen — mit allen Schwächen, Spezialfähigkeiten und Konter-Empfehlungen. Das ist <strong>biologisch perfekt</strong>: adaptive Immunität ist Lernen durch Exposition.</p>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">5.1</div>
        <div>
          <div class="section-title">Drei Codex-Stufen</div>
          <div class="section-desc">Wissen wächst mit Erfahrung. Jeder Pathogen durchläuft drei Stufen.</div>
        </div>
      </div>

      <div class="grid-auto col-3 gap-12">
        <div class="card card-side" style="--card-color: var(--ink-dim);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 32px; color: var(--ink-dim); margin-bottom: 10px; line-height: 1;">?</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-dim); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 8px;">Stufe 1 · Unbekannt</div>
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">"Unknown Threat"</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Sichtbar: nur Kategorie-Symbol (🦠/🧫/🪱/🍄/☠️). Stats und Schwächen verborgen. Spieler muss experimentieren.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent-warm);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 32px; color: var(--accent-warm); margin-bottom: 10px; line-height: 1;">◐</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent-warm); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 8px;">Stufe 2 · Identifiziert</div>
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">Nach erstem Kill</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Name + HP/Speed/DMG sichtbar. Eine Schwäche bekannt. Spezialfähigkeit noch verborgen.</div>
        </div>
        <div class="card card-side" style="--card-color: var(--accent);">
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 32px; color: var(--accent); margin-bottom: 10px; line-height: 1;">★</div>
          <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 8px;">Stufe 3 · Vollständig</div>
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">Nach 5 Kills</div>
          <div style="color: var(--ink-dim); font-size: 13px; line-height: 1.5;">Komplettes Profil: alle Schwächen, Spezialfähigkeit, Konter-Empfehlung. Permanent gespeichert über alle Runs hinweg.</div>
        </div>
      </div>

      <div class="callout">
        <strong>Memory-Persistenz:</strong> Codex-Einträge bleiben dauerhaft erhalten — auch nach Game Over. Das ist die Roguelike-Memory-Mechanik. Jeder Run macht den Spieler stärker, weil er mehr weiß.
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">5.2</div>
        <div>
          <div class="section-title">Live-Indicator über Pathogenen</div>
          <div class="section-desc">Während des Kampfes zeigt ein kleines Icon die Schwäche-Kategorie — nur für identifizierte Gegner.</div>
        </div>
      </div>

      <div class="card" style="background: #0a0e0c;">
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-dim); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 16px;">Live-View · Mockup</div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">

          <div style="background: var(--bg-card); padding: 16px; border-radius: 4px; position: relative;">
            <div style="display: flex; gap: 12px; align-items: center;">
              <div style="position: relative; width: 48px; height: 48px;">
                <div style="width: 100%; height: 100%; background: var(--p-virus); border-radius: 50%; box-shadow: 0 0 12px var(--p-virus); opacity: 0.85;"></div>
                <div style="position: absolute; top: -8px; right: -8px; background: var(--bg); border: 2px solid var(--c-tk); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 8px var(--c-tk);">
                  <div style="width: 10px; height: 10px; border-radius: 50%; background: var(--c-tk);"></div>
                </div>
              </div>
              <div>
                <div style="font-size: 13px; font-weight: 500;">Standard-Virus</div>
                <div style="font-size: 10px; color: var(--ink-dim); font-family: 'JetBrains Mono', monospace;">HP 35 · Schwäche: T-Killer</div>
              </div>
            </div>
            <div style="font-size: 11px; color: var(--accent); margin-top: 10px; font-family: 'JetBrains Mono', monospace;">★ identifiziert</div>
          </div>

          <div style="background: var(--bg-card); padding: 16px; border-radius: 4px; position: relative;">
            <div style="display: flex; gap: 12px; align-items: center;">
              <div style="position: relative; width: 48px; height: 48px;">
                <div style="width: 100%; height: 100%; background: var(--ink-dim); border-radius: 50%; opacity: 0.5;"></div>
                <div style="position: absolute; top: -8px; right: -8px; background: var(--bg); border: 2px solid var(--ink-dim); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: var(--ink-dim);">
                  ?
                </div>
              </div>
              <div>
                <div style="font-size: 13px; font-weight: 500; color: var(--ink-dim);">Unknown Threat</div>
                <div style="font-size: 10px; color: var(--ink-dim); font-family: 'JetBrains Mono', monospace;">Kategorie 🦠 · ?? · ??</div>
              </div>
            </div>
            <div style="font-size: 11px; color: var(--ink-dim); margin-top: 10px; font-family: 'JetBrains Mono', monospace;">? unbekannt</div>
          </div>

          <div style="background: var(--bg-card); padding: 16px; border-radius: 4px; position: relative;">
            <div style="display: flex; gap: 12px; align-items: center;">
              <div style="position: relative; width: 48px; height: 48px;">
                <div style="width: 100%; height: 100%; background: var(--p-toxin); border-radius: 0; clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); box-shadow: 0 0 12px var(--p-toxin);"></div>
                <div style="position: absolute; top: -8px; right: -8px; background: var(--bg); border: 2px solid var(--c-mast); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 8px var(--c-mast);">
                  <div style="width: 10px; height: 10px; border-radius: 50%; background: var(--c-mast);"></div>
                </div>
              </div>
              <div>
                <div style="font-size: 13px; font-weight: 500;">Toxin</div>
                <div style="font-size: 10px; color: var(--ink-dim); font-family: 'JetBrains Mono', monospace;">∞ · Auflösbar: Mast/Bas</div>
              </div>
            </div>
            <div style="font-size: 11px; color: var(--accent); margin-top: 10px; font-family: 'JetBrains Mono', monospace;">★ identifiziert</div>
          </div>

        </div>
      </div>

      <div class="callout">
        <strong>Indicator-Farbe = Counter-Held.</strong> Wenn ein Pathogen blau (T-Killer) markiert ist, weiß der Spieler in 0.5 Sek: "Anti-Virus setzen!" Keine Lesepausen mitten im Kampf. Die Farbe entspricht dem Konter-Helden — keine zusätzliche Decodierung nötig.
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">5.3</div>
        <div>
          <div class="section-title">Pre-Wave Briefing</div>
          <div class="section-desc">Vor jeder Welle: Was kommt? Was weiß ich? Welches Roster passt?</div>
        </div>
      </div>

      <div class="card" style="background: #0a0e0c; padding: 24px;">
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 4px;">▶ Welle 7 startet in 8 Sek</div>
        <div style="font-size: 24px; font-weight: 500; margin-bottom: 20px; letter-spacing: -0.01em;">Pilz-Spore-Storm</div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
          <div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-dim); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 12px;">Erwartete Pathogene</div>
            <div class="stack" style="gap: 8px;">
              <div style="padding: 10px 12px; background: var(--bg-card); border-radius: 3px; display: flex; gap: 12px; align-items: center;">
                <div style="width: 28px; height: 28px; background: var(--p-spore); border-radius: 50%; box-shadow: 0 0 8px var(--p-spore);"></div>
                <div style="flex: 1;">
                  <div style="font-size: 13px; font-weight: 500;">Spore</div>
                  <div style="font-size: 10px; color: var(--ink-dim); font-family: 'JetBrains Mono', monospace;">★ Schwach: Neutrophile, Mast Cell</div>
                </div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent);">×8</div>
              </div>
              <div style="padding: 10px 12px; background: var(--bg-card); border-radius: 3px; display: flex; gap: 12px; align-items: center;">
                <div style="width: 28px; height: 28px; background: var(--p-slime); border-radius: 40% 60%; box-shadow: 0 0 8px var(--p-slime);"></div>
                <div style="flex: 1;">
                  <div style="font-size: 13px; font-weight: 500;">Slime</div>
                  <div style="font-size: 10px; color: var(--ink-dim); font-family: 'JetBrains Mono', monospace;">★ Schwach: Neutrophile, Makrophage</div>
                </div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent);">×3</div>
              </div>
              <div style="padding: 10px 12px; background: var(--bg-card); border-radius: 3px; display: flex; gap: 12px; align-items: center;">
                <div style="width: 28px; height: 28px; background: var(--ink-dim); border-radius: 50%; opacity: 0.5;"></div>
                <div style="flex: 1;">
                  <div style="font-size: 13px; font-weight: 500; color: var(--ink-dim);">Unknown Threat 🍄</div>
                  <div style="font-size: 10px; color: var(--ink-dim); font-family: 'JetBrains Mono', monospace;">? Erste Begegnung</div>
                </div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-dim);">×2</div>
              </div>
            </div>
          </div>

          <div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-dim); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 12px;">Empfohlenes Roster</div>
            <div style="padding: 14px; background: var(--bg-card); border-radius: 3px; border-left: 2px solid var(--accent);">
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">
                <span class="weakness-chip"><span class="dot" style="background: var(--c-neu);"></span>Neutrophile</span>
                <span class="weakness-chip"><span class="dot" style="background: var(--c-mac);"></span>Makrophage</span>
                <span class="weakness-chip"><span class="dot" style="background: var(--c-mast);"></span>Mast Cell</span>
                <span class="weakness-chip"><span class="dot" style="background: var(--c-dc);"></span>Dendritische Z.</span>
              </div>
              <div style="font-size: 11px; color: var(--ink-dim); line-height: 1.5;">Schwarm-Strategie: Neutrophile gegen sich vermehrende Sporen, Mast Cell für AoE.</div>
            </div>
            <div style="margin-top: 14px; padding: 10px 12px; background: rgba(255, 140, 90, 0.08); border-left: 2px solid var(--accent-warm); border-radius: 0 3px 3px 0;">
              <div style="font-size: 11px; color: var(--accent-warm); font-family: 'JetBrains Mono', monospace; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 4px;">⚠ Warnung</div>
              <div style="font-size: 12px; color: var(--ink); line-height: 1.4;">Neuer Pathogen-Typ entdeckt. Bringe diverses Roster für Adaptation.</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">5.4</div>
        <div>
          <div class="section-title">Codex-Interface</div>
          <div class="section-desc">Vollständige Pathogen-Datenbank, jederzeit pausierbar einsehbar.</div>
        </div>
      </div>

      <div class="card">
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 16px;">📖 Codex · Funktionen</div>
        <div class="grid-auto col-auto-240 gap-12">
          <div style="padding: 14px; background: var(--bg-card); border-radius: 3px;">
            <div style="font-size: 14px; font-weight: 500; margin-bottom: 6px;">Filter nach Kategorie</div>
            <div style="font-size: 12px; color: var(--ink-dim);">Viren / Bakterien / Parasiten / Pilze / Toxine</div>
          </div>
          <div style="padding: 14px; background: var(--bg-card); border-radius: 3px;">
            <div style="font-size: 14px; font-weight: 500; margin-bottom: 6px;">Sortieren nach Bedrohung</div>
            <div style="font-size: 12px; color: var(--ink-dim);">HP, DMG, Speed, Spezialfähigkeit</div>
          </div>
          <div style="padding: 14px; background: var(--bg-card); border-radius: 3px;">
            <div style="font-size: 14px; font-weight: 500; margin-bottom: 6px;">Counter-Empfehlungen</div>
            <div style="font-size: 12px; color: var(--ink-dim);">Top-3 Helden gegen jeden Pathogen</div>
          </div>
          <div style="padding: 14px; background: var(--bg-card); border-radius: 3px;">
            <div style="font-size: 14px; font-weight: 500; margin-bottom: 6px;">Statistik</div>
            <div style="font-size: 12px; color: var(--ink-dim);">Kills, beste Combo, schwierigster Run</div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 06: LEVEL STRUCTURE                     -->
  <!-- =============================================== -->
