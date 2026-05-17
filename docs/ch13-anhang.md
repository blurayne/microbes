<!-- Kapitel 13 · Anhang · Beziehungsdiagramm
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. The relationship SVG below is hand-
     authored, inline (not an external image), so it themes
     against the existing colour variables and renders crisp at
     any zoom. -->

  <div class="chapter" id="ch13">
    <div class="chapter-header">
      <div class="chapter-num">13</div>
      <div class="chapter-title-block">
        <h2><em>Anhang</em><br>Beziehungsdiagramm</h2>
        <div class="chapter-subtitle">Wer aktiviert wen, wer tötet wen, wer produziert Antikörper. Visuelle Übersicht der wichtigsten Interaktionen zwischen den 12 Immunzellen, den 9 Pathogenen und Antikörpern.</div>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">13.1</div>
        <div>
          <div class="section-title">Live-Demo</div>
          <div class="section-desc">Shader-Sandbox für jeden Zell- und Pathogen-Typ — drei Render-Themes (Mikroskop · Cartoon · Kurzgesagt-Stil).</div>
        </div>
      </div>

      <div class="chapter-toc" style="margin-top: 16px;">
        <ul class="chapter-toc-list">
          <li><a href="../shader-test.html"><span class="num">▶</span><span class="title">Shader-Test · 21 Zelltypen, 4 Themes (WebGPU + WebGL2)</span></a></li>
        </ul>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">13.2</div>
        <div>
          <div class="section-title">Beziehungsdiagramm · Immunsystem</div>
          <div class="section-desc">Kurzgesagt-inspirierte Darstellung. Linke Hälfte: angeborene Immunität. Rechte Hälfte: adaptive Immunität. Kanten zeigen Interaktionstypen (siehe Legende).</div>
        </div>
      </div>

      <div class="relation-chart" style="margin-top: 18px;">
        <svg viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg" role="img"
             aria-label="Beziehungsdiagramm der Immunzellen, Pathogene und Antikörper"
             style="display:block; width:100%; height:auto; background:#1a0e3a; border-radius:10px;">

          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="b"/>
              <feMerge>
                <feMergeNode in="b"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            <marker id="arrow-attack" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#ff5fa3"/>
            </marker>
            <marker id="arrow-activate" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#ffc34d"/>
            </marker>
            <marker id="arrow-communicate" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#4dd0ff"/>
            </marker>
            <marker id="arrow-antibody" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#7be065"/>
            </marker>
            <marker id="arrow-morph" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#ff8845"/>
            </marker>
          </defs>

          <!-- ── Domain dividers + labels ─────────────────────────── -->
          <line x1="510" y1="40" x2="510" y2="600" stroke="#3a2a6a" stroke-width="1" stroke-dasharray="4 6"/>
          <text x="250" y="608" text-anchor="middle" fill="#9aa0c4" font-family="IBM Plex Mono, monospace" font-size="11" letter-spacing="2">INNATE IMMUNITY</text>
          <text x="770" y="608" text-anchor="middle" fill="#9aa0c4" font-family="IBM Plex Mono, monospace" font-size="11" letter-spacing="2">ADAPTIVE IMMUNITY</text>

          <!-- ── Legend (top-right) ───────────────────────────────── -->
          <g font-family="IBM Plex Sans, sans-serif" font-size="11" fill="#cdd1ec">
            <line x1="800" y1="36" x2="824" y2="36" stroke="#ff5fa3" stroke-width="2.5"/>
            <text x="830" y="40">Attack and Kill</text>
            <line x1="800" y1="54" x2="824" y2="54" stroke="#ffc34d" stroke-width="2.5"/>
            <text x="830" y="58">Activate</text>
            <line x1="800" y1="72" x2="824" y2="72" stroke="#4dd0ff" stroke-width="2.5"/>
            <text x="830" y="76">Communicate</text>
            <line x1="800" y1="90" x2="824" y2="90" stroke="#7be065" stroke-width="2.5"/>
            <text x="830" y="94">Produce Antibodies</text>
            <line x1="800" y1="108" x2="824" y2="108" stroke="#ff8845" stroke-width="2.5"/>
            <text x="830" y="112">Morph</text>
          </g>

          <!-- ── Edges (drawn first so nodes sit on top) ──────────── -->
          <!-- Pathogen → Neutrophil / Macrophage / NK / Eosinophil — Attack -->
          <path d="M 130 190 Q 200 170, 230 130" fill="none" stroke="#ff5fa3" stroke-width="2" marker-end="url(#arrow-attack)"/>
          <path d="M 150 220 Q 240 240, 320 250" fill="none" stroke="#ff5fa3" stroke-width="2" marker-end="url(#arrow-attack)"/>
          <path d="M 130 240 Q 220 320, 300 360" fill="none" stroke="#ff5fa3" stroke-width="2" marker-end="url(#arrow-attack)"/>
          <path d="M 130 270 Q 230 430, 310 470" fill="none" stroke="#ff5fa3" stroke-width="2" marker-end="url(#arrow-attack)"/>
          <!-- Pathogen → Mast / Basophil — Communicate (histamine) -->
          <path d="M 110 280 Q 175 460, 240 540" fill="none" stroke="#4dd0ff" stroke-width="2" marker-end="url(#arrow-communicate)"/>
          <path d="M 110 260 Q 110 380, 145 540" fill="none" stroke="#4dd0ff" stroke-width="2" marker-end="url(#arrow-communicate)"/>
          <!-- Macrophage → Dendritic — Communicate / antigen handover -->
          <path d="M 360 250 Q 430 280, 470 320" fill="none" stroke="#4dd0ff" stroke-width="2" marker-end="url(#arrow-communicate)"/>
          <!-- Macrophage → Neutrophil — Activate (recruits) -->
          <path d="M 320 220 Q 290 175, 245 145" fill="none" stroke="#ffc34d" stroke-width="2" marker-end="url(#arrow-activate)"/>
          <!-- Monocyte → Macrophage — Morph (differentiation) -->
          <path d="M 180 380 Q 240 320, 310 260" fill="none" stroke="#ff8845" stroke-width="2.5" marker-end="url(#arrow-morph)"/>
          <!-- Dendritic → Helper T-Cell — Activate (cross domains) -->
          <path d="M 510 350 Q 590 320, 670 280" fill="none" stroke="#ffc34d" stroke-width="2.5" marker-end="url(#arrow-activate)"/>
          <!-- Helper T → B-Cell — Activate -->
          <path d="M 720 290 Q 760 360, 770 430" fill="none" stroke="#ffc34d" stroke-width="2.5" marker-end="url(#arrow-activate)"/>
          <!-- Helper T → Killer T — Activate -->
          <path d="M 720 270 Q 800 250, 870 230" fill="none" stroke="#ffc34d" stroke-width="2" marker-end="url(#arrow-activate)"/>
          <!-- B-Cell → Plasma — Morph -->
          <path d="M 770 470 Q 800 510, 830 540" fill="none" stroke="#ff8845" stroke-width="2.5" marker-end="url(#arrow-morph)"/>
          <!-- Plasma → Antibodies — Produce -->
          <path d="M 855 525 Q 905 490, 920 450" fill="none" stroke="#7be065" stroke-width="2.5" marker-end="url(#arrow-antibody)"/>
          <!-- Antibodies → Pathogens — Attack (cross domains, the loop) -->
          <path d="M 935 420 C 700 100, 250 80, 90 215" fill="none" stroke="#ff5fa3" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#arrow-attack)"/>
          <!-- Killer T → Infected Cell — Attack -->
          <path d="M 880 200 Q 800 140, 720 130" fill="none" stroke="#ff5fa3" stroke-width="2" marker-end="url(#arrow-attack)"/>
          <!-- NK → Infected Cell (innate side too) — Attack -->
          <path d="M 320 360 Q 480 200, 700 125" fill="none" stroke="#ff5fa3" stroke-width="2" stroke-dasharray="3 4" marker-end="url(#arrow-attack)"/>
          <!-- Eosinophil → Parasitic Worms — Attack -->
          <path d="M 320 470 Q 220 510, 130 540" fill="none" stroke="#ff5fa3" stroke-width="2" marker-end="url(#arrow-attack)"/>

          <!-- ── Nodes ────────────────────────────────────────────── -->
          <!-- Helper to read the file: each cell is <g><circle glow><circle fill><text></g>.
               Coordinates are static; cytoBot palette mirrored from
               assets/core/state.js → CELL_TYPES. -->

          <!-- Pathogens cluster (innate, far left) -->
          <g transform="translate(95, 230)" filter="url(#glow)">
            <circle r="32" fill="#9c2dbe" opacity="0.35"/>
            <circle r="22" fill="#9c2dbe" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="3" cx="-8" cy="-6" fill="#3a0552"/>
            <circle r="3" cx="6" cy="-2" fill="#3a0552"/>
            <circle r="3" cx="-2" cy="8" fill="#3a0552"/>
          </g>
          <text x="95" y="288" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Pathogens</text>

          <!-- Parasitic Worms (bottom-left) -->
          <g transform="translate(95, 540)" filter="url(#glow)">
            <ellipse rx="28" ry="9" fill="#7e3df0" opacity="0.30"/>
            <path d="M -22 0 Q -10 -6, 0 0 T 22 0" fill="none" stroke="#a065ff" stroke-width="4" stroke-linecap="round"/>
          </g>
          <text x="95" y="572" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Parasitic Worms</text>

          <!-- Neutrophil -->
          <g transform="translate(230, 130)" filter="url(#glow)">
            <circle r="26" fill="#e58a26" opacity="0.30"/>
            <circle r="18" fill="#e58a26" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="3.5" cx="-5" cy="-3" fill="#5a2a05"/>
            <circle r="3.5" cx="5" cy="-3" fill="#5a2a05"/>
            <circle r="3.5" cx="0" cy="5" fill="#5a2a05"/>
          </g>
          <text x="230" y="170" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Neutrophil</text>

          <!-- Macrophage -->
          <g transform="translate(340, 250)" filter="url(#glow)">
            <circle r="30" fill="#d36699" opacity="0.30"/>
            <circle r="22" fill="#d36699" stroke="#ece6d6" stroke-width="0.8"/>
            <path d="M -10 -2 a 8 8 0 1 0 14 0 l -2 2 z" fill="#3a1029"/>
          </g>
          <text x="340" y="293" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Macrophage</text>

          <!-- Dendritic Cell -->
          <g transform="translate(490, 340)" filter="url(#glow)">
            <circle r="28" fill="#4d8fcf" opacity="0.30"/>
            <circle r="18" fill="#4d8fcf" stroke="#ece6d6" stroke-width="0.8"/>
            <line x1="0" y1="-22" x2="0" y2="-32" stroke="#4d8fcf" stroke-width="2" stroke-linecap="round"/>
            <line x1="19" y1="-12" x2="28" y2="-18" stroke="#4d8fcf" stroke-width="2" stroke-linecap="round"/>
            <line x1="22" y1="6" x2="32" y2="9" stroke="#4d8fcf" stroke-width="2" stroke-linecap="round"/>
            <line x1="13" y1="20" x2="19" y2="29" stroke="#4d8fcf" stroke-width="2" stroke-linecap="round"/>
            <line x1="-13" y1="20" x2="-19" y2="29" stroke="#4d8fcf" stroke-width="2" stroke-linecap="round"/>
            <line x1="-22" y1="6" x2="-32" y2="9" stroke="#4d8fcf" stroke-width="2" stroke-linecap="round"/>
            <line x1="-19" y1="-12" x2="-28" y2="-18" stroke="#4d8fcf" stroke-width="2" stroke-linecap="round"/>
            <circle r="4" fill="#102544"/>
          </g>
          <text x="490" y="385" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Dendritic Cell</text>

          <!-- NK -->
          <g transform="translate(320, 380)" filter="url(#glow)">
            <circle r="22" fill="#7172c6" opacity="0.30"/>
            <circle r="15" fill="#7172c6" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="6" fill="#291b5e"/>
            <circle r="2" cx="-6" cy="-4" fill="#cdd1ec"/>
            <circle r="2" cx="5" cy="2" fill="#cdd1ec"/>
            <circle r="2" cx="-3" cy="6" fill="#cdd1ec"/>
          </g>
          <text x="320" y="418" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Natural Killer</text>

          <!-- Monocyte -->
          <g transform="translate(180, 410)" filter="url(#glow)">
            <circle r="24" fill="#6d8df0" opacity="0.30"/>
            <circle r="17" fill="#6d8df0" stroke="#ece6d6" stroke-width="0.8"/>
            <path d="M -7 -3 a 7 7 0 1 0 12 0 l -3 3 z" fill="#1d1c5a"/>
          </g>
          <text x="180" y="447" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Monocyte</text>

          <!-- Eosinophil -->
          <g transform="translate(330, 480)" filter="url(#glow)">
            <circle r="22" fill="#e0855a" opacity="0.30"/>
            <circle r="15" fill="#e0855a" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="4" cx="-5" cy="-1" fill="#4d1d09"/>
            <circle r="4" cx="5" cy="-1" fill="#4d1d09"/>
            <circle r="2" cx="0" cy="6" fill="#fff0e0" opacity="0.7"/>
            <circle r="2" cx="-7" cy="5" fill="#fff0e0" opacity="0.7"/>
            <circle r="2" cx="7" cy="5" fill="#fff0e0" opacity="0.7"/>
          </g>
          <text x="330" y="517" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Eosinophil</text>

          <!-- Mast Cell -->
          <g transform="translate(240, 540)" filter="url(#glow)">
            <ellipse rx="22" ry="18" fill="#54a877" opacity="0.30"/>
            <ellipse rx="16" ry="13" fill="#54a877" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="1.5" cx="-7" cy="-5" fill="#0f4a2e"/>
            <circle r="1.5" cx="-2" cy="-7" fill="#0f4a2e"/>
            <circle r="1.5" cx="4" cy="-4" fill="#0f4a2e"/>
            <circle r="1.5" cx="8" cy="0" fill="#0f4a2e"/>
            <circle r="1.5" cx="-8" cy="2" fill="#0f4a2e"/>
            <circle r="1.5" cx="-3" cy="6" fill="#0f4a2e"/>
            <circle r="1.5" cx="3" cy="5" fill="#0f4a2e"/>
            <circle r="1.5" cx="6" cy="-7" fill="#0f4a2e"/>
          </g>
          <text x="240" y="577" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Mast Cell</text>

          <!-- Basophil -->
          <g transform="translate(145, 540)" filter="url(#glow)">
            <circle r="20" fill="#d97aa1" opacity="0.30"/>
            <circle r="14" fill="#d97aa1" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="3" cx="-4" cy="0" fill="#410d2e"/>
            <circle r="3" cx="4" cy="0" fill="#410d2e"/>
            <circle r="1.5" cx="-7" cy="-6" fill="#1a0d1a"/>
            <circle r="1.5" cx="2" cy="-7" fill="#1a0d1a"/>
            <circle r="1.5" cx="6" cy="5" fill="#1a0d1a"/>
            <circle r="1.5" cx="-3" cy="7" fill="#1a0d1a"/>
          </g>
          <text x="145" y="572" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Basophil</text>

          <!-- Infected Cell (purple, sits on the boundary) -->
          <g transform="translate(710, 110)" filter="url(#glow)">
            <circle r="22" fill="#a01818" opacity="0.30"/>
            <circle r="15" fill="#a01818" stroke="#9c2dbe" stroke-width="1.2"/>
            <circle r="2" cx="-3" cy="-3" fill="#3a0552"/>
            <circle r="2" cx="4" cy="2" fill="#3a0552"/>
            <circle r="2" cx="-2" cy="4" fill="#3a0552"/>
          </g>
          <text x="710" y="148" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Infected Cell</text>

          <!-- Helper T-cell -->
          <g transform="translate(700, 260)" filter="url(#glow)">
            <circle r="26" fill="#8d7be0" opacity="0.30"/>
            <circle r="18" fill="#8d7be0" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="9" fill="#2a134d"/>
          </g>
          <text x="700" y="300" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Helper T-Cell</text>

          <!-- Killer T-cell -->
          <g transform="translate(890, 210)" filter="url(#glow)">
            <circle r="24" fill="#8d7be0" opacity="0.30"/>
            <circle r="16" fill="#8d7be0" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="8" fill="#2a134d"/>
            <circle r="2" cx="-3" cy="-3" fill="#cdd1ec"/>
            <circle r="2" cx="3" cy="3" fill="#cdd1ec"/>
          </g>
          <text x="890" y="246" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Killer T-Cell</text>

          <!-- B-cell -->
          <g transform="translate(770, 450)" filter="url(#glow)">
            <circle r="26" fill="#df8189" opacity="0.30"/>
            <circle r="18" fill="#df8189" stroke="#ece6d6" stroke-width="0.8"/>
            <circle r="9" fill="#4a1014"/>
            <line x1="-13" y1="-3" x2="13" y2="-3" stroke="#fcc9cc" stroke-width="0.8" opacity="0.7"/>
            <line x1="-13" y1="0"  x2="13" y2="0"  stroke="#fcc9cc" stroke-width="0.8" opacity="0.7"/>
            <line x1="-13" y1="3"  x2="13" y2="3"  stroke="#fcc9cc" stroke-width="0.8" opacity="0.7"/>
          </g>
          <text x="770" y="490" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">B-Cell</text>

          <!-- Plasma Cell -->
          <g transform="translate(840, 540)" filter="url(#glow)">
            <ellipse rx="22" ry="17" fill="#df8189" opacity="0.30"/>
            <ellipse rx="15" ry="11" fill="#df8189" stroke="#ece6d6" stroke-width="0.8"/>
            <ellipse rx="6" ry="5" fill="#4a1014"/>
          </g>
          <text x="840" y="577" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Plasma Cell</text>

          <!-- Antibodies (Y-shape cluster) -->
          <g transform="translate(935, 415)" filter="url(#glow)">
            <circle r="26" fill="#7be065" opacity="0.20"/>
            <g stroke="#cdd1ec" stroke-width="2.2" stroke-linecap="round" fill="none">
              <path d="M -10 8 L -10 -2 L -16 -10 M -10 -2 L -4 -10"/>
              <path d="M  10 8 L  10 -2 L   4 -10 M  10 -2 L 16 -10"/>
              <path d="M  0  16 L  0  6 L  -6 -2 M  0  6 L  6 -2"/>
            </g>
          </g>
          <text x="935" y="458" text-anchor="middle" fill="#cdd1ec" font-family="IBM Plex Sans, sans-serif" font-size="11">Antibodies</text>

        </svg>
      </div>

      <p style="color: var(--ink-dim); font-size: 13px; line-height: 1.55; margin-top: 16px;">
        Inspiriert vom Erklärstil des YouTube-Kanals <strong>Kurzgesagt — In a Nutshell</strong>.
        Die fünf Kanten-Kategorien (Attack and Kill · Activate · Communicate · Produce
        Antibodies · Morph) decken die Kern-Interaktionen ab, die im Spiel als
        Schaden, Buff-Auren, Aktivierungskaskade und Antikörper-Produktion umgesetzt
        sind. Vergleiche §11 (Physik) und §10 (Schadens-Matrix) für die genauen
        Zahlenwerte.
      </p>

      <p style="margin-top: 14px;">
        <a href="../assets/beziehungsdiagramm.pdf" download
           style="display: inline-block; padding: 8px 14px; border-radius: 6px;
                  background: #2a1e5a; color: #cdd1ec; text-decoration: none;
                  font-family: 'IBM Plex Sans', sans-serif; font-size: 12px;
                  border: 1px solid #4a3a8a;">
          ⤓ PDF herunterladen · A4 quer (für Druck)
        </a>
      </p>

    </section>

    <section id="anhang-b" class="appendix-section" style="margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--line, #2a2438);">
      <h2 style="margin-bottom: 8px;">Anhang B — Erweiterte Zellen (nicht spielrelevant)</h2>
      <p style="color: var(--ink-dim); font-size: 13px; line-height: 1.55; max-width: 700px;">
        Der <a href="../shader-test.html"><strong>Shader-Test</strong></a> rendert
        21 Spezimen (kinds 0–20). Im Spiel ausbalanciert sind die 20 Zelltypen
        aus §01 + §02. Der verbleibende kind 0 — <em>Eukaryote, generic</em> —
        ist eine generische Körperzelle, die als <strong>erweiterte (nicht
        spielrelevante) Zelle</strong> in der Add-Dialog-Liste auftaucht,
        sobald in den Einstellungen → Anzeige der Schalter
        <em>„Erweiterte (nicht spielrelevante) Zellen zeigen"</em>
        aktiviert ist. Sie dient ausschließlich als visueller Vergleich
        zwischen Spiel-Renderer und Shader-Test (siehe
        <code>docs/cell-zoo.html</code>).
      </p>

      <div class="tier-group" style="display: grid; gap: 16px; margin-top: 20px;">
        <div class="card cell-card" data-cell="eukaryote" style="--cell-color: #c78ca8;">
          <div class="card-header">
            <div class="card-icon">
              <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="16" fill="#e6b8c8" stroke="#7a3e58" stroke-width="2"/>
                <circle cx="22" cy="22" r="5" fill="#4a2638"/>
              </svg>
            </div>
            <div class="card-title">
              <h3>Eukaryote · Erweitert</h3>
              <div class="card-sub">Generische Körperzelle — Shader-Test kind 0</div>
            </div>
          </div>
          <p style="font-size: 13px; line-height: 1.55;">
            Passives Spezimen ohne Spielbalance. Drift-KI (kein Verfolgen,
            kein Angriff), unendliche HP wie alle <em>good</em>-Zellen,
            <code>category: 'good'</code>, <code>extended: true</code> in
            <code>CELL_TYPES</code>. Farben aus <code>cytoColor(0)</code>
            des Shader-Tests: <code>vec3(0.78, 0.55, 0.66) ≈ #c78ca8</code>,
            ergänzt durch Top/Bottom-Stops <code>#e6b8c8 / #a06b80</code>
            für den Radialverlauf und einen warmen Kern <code>#4a2638</code>.
          </p>
          <p style="font-size: 12px; color: var(--ink-dim);">
            Spawn-Test im laufenden Build:
            <code>?cellType=eukaryote&amp;extended=1&amp;theme=legacy&amp;pose=1</code> ·
            Vergleich gegen den Shader-Test über <code>docs/cell-zoo.html</code>
            (Scope-Filter: <em>extended only</em>).
          </p>
          <div class="rel-row">
            <span class="rel-label">Freunde</span>
            <span class="rel-list">—</span>
          </div>
          <div class="rel-row">
            <span class="rel-label">Beute</span>
            <span class="rel-list">—</span>
          </div>
          <div class="rel-row">
            <span class="rel-label">Feinde</span>
            <span class="rel-list">virus · bacterium · slime (per
              <code>CELL_TYPES.eukaryote.foes</code>; die Zelle hat
              <em>infinite HP</em> und wird im Spielbalance-Loop nicht
              angegriffen)</span>
          </div>
        </div>
      </div>

      <p style="margin-top: 28px; font-size: 12px; color: var(--ink-dim);">
        Weitere Spezimen aus dem Shader-Test können über die Workflow-
        Skill
        <a href="https://github.com/blurayne/microbes/blob/main/.claude/skills/import-shader-test-cell/SKILL.md"><code>import-shader-test-cell</code></a>
        ins Spiel portiert werden. Hinweise zur Renderer-Parität (canvas2d /
        webgl2 / webgpu) und zum visuellen Pixel-Diff über Playwright stehen
        dort.
      </p>
    </section>

  </div>
