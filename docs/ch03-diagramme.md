<!-- Kapitel 03 · Diagramme & Abläufe
     Extracted verbatim from docs/_source.html (lines 1321-1448).
     md2book passes raw HTML through; styling comes from
     docs/assets/style.css. -->

  <div class="chapter" id="ch03">
    <div class="chapter-header">
      <div class="chapter-num">03</div>
      <div class="chapter-title-block">
        <h2>Diagramme &<br><em>Abläufe</em></h2>
        <div class="chapter-subtitle">Visualisierung der gesamten Logik. Tier-Hierarchie, Aktivierungskaskade, Pathogen-Counter-Map.</div>
      </div>
    </div>

    <section>
      <div class="section-head">
        <div class="section-num">3.1</div>
        <div>
          <div class="section-title">Hierarchie der Helden</div>
          <div class="section-desc">Tier-Struktur und Counter-Beziehungen.</div>
        </div>
      </div>
      <div class="diagram-card">
        <div class="mermaid">
graph TD
    HSC[Hämatopoetische Stammzelle] --> CORE[Tier 1: Core]
    HSC --> SPEC[Tier 2: Special]
    HSC --> UTIL[Tier 3: Utility]
    HSC --> RBC[Filler: Red Blood Cell]

    CORE --> NEU[Neutrophile]
    CORE --> MAC[Makrophage]
    CORE --> DC[Dendritische Zelle]
    CORE --> TH[T-Helfer]
    CORE --> TK[T-Killer]
    CORE --> BZ[B-Zelle]

    SPEC --> NK[Natural Killer]
    SPEC --> MAST[Mast Cell]
    SPEC --> EOS[Eosinophil]
    SPEC --> BAS[Basophil]

    UTIL --> MON[Monocyte]
    UTIL --> PLT[Platelet]

    style HSC fill:#c8ff5a,stroke:#0f1410,color:#0f1410
    style CORE fill:#90ee90,stroke:#0f1410,color:#0f1410
    style SPEC fill:#c8a8ff,stroke:#0f1410,color:#0f1410
    style UTIL fill:#fdd663,stroke:#0f1410,color:#0f1410
    style RBC fill:#d63333,stroke:#0f1410,color:#fff
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">3.2</div>
        <div>
          <div class="section-title">Pathogen → Counter Map</div>
          <div class="section-desc">Welcher Held kontert welchen Pathogen-Typ?</div>
        </div>
      </div>
      <div class="diagram-card">
        <div class="mermaid">
graph LR
    subgraph PATH[Pathogene]
      VIR[Viren]
      BAC[Bakterien]
      PAR[Parasiten]
      FUN[Pilze]
      TOX[Toxine]
    end

    subgraph HEROES[Helden]
      NEU[Neutrophile]
      MAC[Makrophage]
      TK[T-Killer]
      NK[NK]
      BZ[B-Zelle]
      EOS[Eosinophil]
      MAST[Mast Cell]
      BAS[Basophil]
    end

    VIR -.kontert.-> TK
    VIR -.kontert.-> NK
    VIR -.kontert.-> BZ
    BAC -.kontert.-> NEU
    BAC -.kontert.-> MAC
    BAC -.kontert.-> BAS
    PAR -.kontert.-> EOS
    PAR -.kontert.-> BZ
    FUN -.kontert.-> NEU
    FUN -.kontert.-> MAC
    FUN -.kontert.-> MAST
    TOX -.löst auf.-> MAST
    TOX -.löst auf.-> BAS

    style VIR fill:#5ab8ff,color:#000
    style BAC fill:#ff5a5a,color:#fff
    style PAR fill:#90c050,color:#000
    style FUN fill:#c8a8ff,color:#000
    style TOX fill:#ffaa00,color:#000
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div class="section-num">3.3</div>
        <div>
          <div class="section-title">Der Ablauf in 4 Schritten</div>
          <div class="section-desc">Das Drehbuch jeder Welle.</div>
        </div>
      </div>
      <div class="diagram-card">
        <div class="mermaid">
graph LR
    A[1. Eindringling kommt] --> B[2. Makrophage entdeckt + ruft Verstärkung]
    B --> C[3. DC sammelt Antigen + holt adaptive Zellen]
    C --> D[4. Spezialisten + T+B vernichten gezielt]
    style A fill:#ff5a5a,stroke:#0f1410,color:#fff
    style B fill:#ff8c5a,stroke:#0f1410,color:#000
    style C fill:#ffd700,stroke:#0f1410,color:#000
    style D fill:#5ab8ff,stroke:#0f1410,color:#000
        </div>
      </div>
    </section>
  </div>

  <!-- =============================================== -->
  <!-- CHAPTER 04: CONCEPT                             -->
  <!-- =============================================== -->
