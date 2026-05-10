<!-- Einleitung — Titelblock, Neu in v10, Kapitel-TOC
     Extracted verbatim from docs/_source.html (lines 654-700).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="title-block">
    <div>
      <div class="eyebrow">Game Design Document · Erweiterte Komplettfassung</div>
      <h1>Das <em>Immunsystem</em><br>als Spiel.</h1>
    </div>
    <div class="title-meta">
      v10.0 — Codex & Bosses<br>
      12 Helden · 12 Pathogene<br>
      18 Levels · 5 Bosse<br>
      Adaptiver Codex
    </div>
  </div>

  <div class="whats-new">
    <div class="whats-new-label">◆ Neu in v10.0</div>
    <h3>Adaptiver Codex und 3-Akt-Struktur</h3>
    <p style="color: var(--ink-dim); font-size: 14px; margin-bottom: 12px;">Das Spiel lehrt sich selbst — adaptive Immunität als Tutorial-Mechanik.</p>
    <ul>
      <li><strong>Lebende Zellen statt Türme</strong>Platzierte Zellen jagen, driften, sterben autonom (siehe §11)</li>
      <li><strong>Free Game Modus</strong>Sandbox: jede Zelle, jedes Pathogen, kein Roster-Limit (siehe §4.3)</li>
      <li><strong>Pre-Level &amp; In-Level Briefing + Status-Line</strong>Gegner + Konter strategisch (modal) und taktisch (HUD-Zeile, modus-übergreifend) — siehe §12</li>
      <li><strong>Adaptiver Codex</strong>Spieler entdeckt Schwächen durch Kontakt — biologisch korrekt!</li>
      <li><strong>Live-Indicator über Pathogenen</strong>Kleines Icon zeigt aktuelle Schwäche-Kategorie</li>
      <li><strong>3-Akt-Struktur</strong>18 Levels in drei Akten — Tutorial, Komplikation, Krise</li>
      <li><strong>5 Bosse statt 1</strong>2 Mini-Bosse · 2 Major-Bosse · 1 Finale</li>
      <li><strong>Schwierigkeitskurve</strong>Klare Progression: lernen → kombinieren → meistern</li>
    </ul>
  </div>

  <div class="chapter-toc">
    <h3>◆ Live-Demo</h3>
    <p style="color: var(--ink-dim); font-size: 14px; margin-bottom: 8px;">Interaktiver Shader-Sandbox: ein WGSL-/GLSL-Shader, neun Zelltypen (Immun + Pathogene), umschaltbar per Dropdown.</p>
    <ul class="chapter-toc-list">
      <li><a href="shader-test.html"><span class="num">▶</span><span class="title">Shader-Test · Live-Zelle (WebGPU + WebGL2)</span></a></li>
    </ul>
  </div>

  <div class="chapter-toc">
    <h3>◆ Inhaltsverzeichnis</h3>
    <ul class="chapter-toc-list">
      <li><a href="#ch01"><span class="num">01</span><span class="title">Die 12 Immunzellen + Filler</span></a></li>
      <li><a href="#ch02"><span class="num">02</span><span class="title">Pathogen-Katalog (12 Typen)</span></a></li>
      <li><a href="#ch03"><span class="num">03</span><span class="title">Diagramme & Abläufe</span></a></li>
      <li><a href="#ch04"><span class="num">04</span><span class="title">Spielkonzept & Tiers</span></a></li>
      <li><a href="#ch05"><span class="num">05</span><span class="title">Adaptiver Codex (NEU)</span></a></li>
      <li><a href="#ch06"><span class="num">06</span><span class="title">Level-Struktur (3 Akte)</span></a></li>
      <li><a href="#ch07"><span class="num">07</span><span class="title">Boss-Katalog (5 Bosse)</span></a></li>
      <li><a href="#ch08"><span class="num">08</span><span class="title">Sieg, Niederlage & Regeln</span></a></li>
      <li><a href="#ch09"><span class="num">09</span><span class="title">Game Feel & Phasen</span></a></li>
      <li><a href="#ch10"><span class="num">10</span><span class="title">Schadens-Matrix</span></a></li>
      <li><a href="#ch11"><span class="num">11</span><span class="title">Physik & Magnetismus</span></a></li>
      <li><a href="#ch12"><span class="num">12</span><span class="title">Briefing (NEU)</span></a></li>
    </ul>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 01: HEROES                              -->
  <!-- =============================================== -->
