async function waitForLibraries() {
  const required = ['React', 'ReactDOM', 'THREE', 'Babel'];
  const start = Date.now();
  while (required.some((name) => typeof window[name] === 'undefined')) {
    if (Date.now() - start > 10000) {
      throw new Error('Timed out while waiting for external libraries to load.');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function loadComponent() {
  await waitForLibraries();

  const response = await fetch('./advanced-explosion.jsx');
  if (!response.ok) {
    throw new Error(`Failed to fetch component: ${response.status} ${response.statusText}`);
  }
  const source = await response.text();
  const transformed = Babel.transform(source, {
    presets: ['react'],
    plugins: ['transform-modules-commonjs'],
    filename: 'advanced-explosion.jsx',
    sourceMaps: false,
  }).code;

  const module = { exports: {} };
  const require = (name) => {
    switch (name) {
      case 'react':
        return React;
      case 'three':
        return THREE;
      default:
        throw new Error(`Cannot resolve module: ${name}`);
    }
  };

  const fn = new Function('require', 'module', 'exports', transformed);
  fn(require, module, module.exports);
  return module.exports.default || module.exports;
}

(async () => {
  try {
    const AdvancedExplosionSimulator = await loadComponent();
    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element not found');
    }

    if (!ReactDOM?.createRoot) {
      throw new Error('ReactDOM.createRoot is unavailable.');
    }

    const root = ReactDOM.createRoot(rootElement);
    root.render(React.createElement(AdvancedExplosionSimulator));
  } catch (error) {
    console.error(error);
    const rootElement = document.getElementById('root');
    if (rootElement) {
      rootElement.innerHTML = `<div class="max-w-xl mx-auto mt-20 bg-red-900/40 border border-red-500 text-red-100 p-6 rounded">` +
        `<h2 class="text-xl font-bold mb-2">Unable to load simulator</h2>` +
        `<p class="text-sm leading-relaxed">${error.message}</p>` +
        `<p class="text-xs mt-3 opacity-70">Check your internet connection and make sure external CDNs are reachable.</p>` +
        `</div>`;
    }
  }
})();
