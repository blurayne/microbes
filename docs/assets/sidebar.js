/* Sticky left-side TOC for desktop ≥ 1024px. Hidden on mobile.
   Loaded via mkdocs.yml extra_javascript so the bare mkdocs theme
   doesn't need a custom_dir override.

   Chapter list mirrors mkdocs.yml `nav:` and the inline TOC on
   index.md. Keep the three in sync when adding chapters. */
(function () {
  'use strict';

  var chapters = [
    { num: '',   title: 'Einleitung',                slug: '' },
    { num: '01', title: 'Helden',                    slug: 'ch01-helden/' },
    { num: '02', title: 'Pathogene',                 slug: 'ch02-pathogene/' },
    { num: '03', title: 'Diagramme',                 slug: 'ch03-diagramme/' },
    { num: '04', title: 'Konzept & Tiers',           slug: 'ch04-konzept/' },
    { num: '05', title: 'Adaptiver Codex',           slug: 'ch05-codex/' },
    { num: '06', title: 'Level-Struktur',            slug: 'ch06-levels/' },
    { num: '07', title: 'Boss-Katalog',              slug: 'ch07-bosse/' },
    { num: '08', title: 'Sieg & Regeln',             slug: 'ch08-regeln/' },
    { num: '09', title: 'Game Feel',                 slug: 'ch09-game-feel/' },
    { num: '10', title: 'Schadens-Matrix',           slug: 'ch10-schaden/' },
    { num: '11', title: 'Physik & Magnetismus',      slug: 'ch11-physik/' },
    { num: '12', title: 'Briefing',                  slug: 'ch12-briefing/' },
    { num: '13', title: 'Anhang',                    slug: 'ch13-anhang/' },
  ];

  function siteRoot() {
    // Walk up the path until we find a segment that matches a chapter
    // slug (or hit the root). The remainder is the site root, which
    // makes the sidebar work whether deployed at "/" or "/microbes/".
    var path = location.pathname;
    var slugs = chapters.map(function (c) { return c.slug; }).filter(Boolean);
    for (var i = 0; i < slugs.length; i++) {
      var idx = path.indexOf('/' + slugs[i]);
      if (idx >= 0) return path.slice(0, idx + 1);
    }
    // No chapter slug matched → we're on the index page.
    return path.endsWith('/') ? path : path.replace(/[^/]+$/, '');
  }

  function currentSlug(root) {
    var rel = location.pathname.slice(root.length);
    var match = chapters.find(function (c) { return c.slug && rel.indexOf(c.slug) === 0; });
    return match ? match.slug : '';
  }

  function build() {
    var aside = document.createElement('aside');
    aside.className = 'docs-sidebar';
    aside.setAttribute('aria-label', 'Kapitel-Navigation');

    var root = siteRoot();
    var here = currentSlug(root);

    var ul = document.createElement('ul');
    chapters.forEach(function (c) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = root + c.slug;
      if (c.slug === here || (!c.slug && here === '')) {
        a.setAttribute('aria-current', 'page');
      }
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = c.num;
      var title = document.createElement('span');
      title.className = 'title';
      title.textContent = c.title;
      a.appendChild(num);
      a.appendChild(title);
      li.appendChild(a);
      ul.appendChild(li);
    });
    aside.appendChild(ul);
    document.body.insertBefore(aside, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
