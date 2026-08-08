(function () {
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const links = [
    { href: 'index.html', label: 'Home' },
    { href: 'install.html', label: 'Install' },
    { href: 'controls.html', label: 'Controls' },
    { href: 'features.html', label: 'Features' },
    { href: 'configuration.html', label: 'Config' },
    { href: 'callouts.html', label: 'Callouts' },
    { href: 'changelog.html', label: 'Changelog' },
  ];

  function navHtml() {
    return links.map((link) => {
      const current = path === link.href || (path === '' && link.href === 'index.html');
      return `<a href="${link.href}"${current ? ' aria-current="page"' : ''}>${link.label}</a>`;
    }).join('');
  }

  const header = document.querySelector('[data-docs-header]');
  if (header) {
    header.innerHTML = `
      <div class="site-header-inner">
        <a class="brand" href="index.html">
          <span class="brand-mark">On Duty Framework</span>
          <span class="brand-sub">Documentation</span>
        </a>
        <nav class="nav" aria-label="Docs">${navHtml()}</nav>
      </div>
    `;
  }

  const footer = document.querySelector('[data-docs-footer]');
  if (footer) {
    footer.innerHTML = `
      <div class="site-footer-inner">
        <span>On Duty Framework · v0.29.0</span>
        <span>Standalone FiveM police framework · No ESX / QBCore</span>
      </div>
    `;
  }
})();
