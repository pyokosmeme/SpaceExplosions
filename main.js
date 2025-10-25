const localModuleCache = new Map();
let threeModulePromise;

async function waitForLibraries() {
  const required = ['React', 'ReactDOM', 'Babel'];
  const start = Date.now();
  while (required.some((name) => typeof window[name] === 'undefined')) {
    if (Date.now() - start > 10000) {
      throw new Error('Timed out while waiting for external libraries to load.');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function loadThreeModule() {
  if (!threeModulePromise) {
    threeModulePromise = import('https://unpkg.com/three@0.160.0/build/three.module.js?module')
      .then((module) => {
        const namespace = {};
        for (const key of Object.keys(module)) {
          namespace[key] = module[key];
        }
        if ('default' in module) {
          namespace.default = module.default;
        }
        if (!('default' in namespace)) {
          namespace.default = module;
        }
        if (typeof window !== 'undefined') {
          window.THREE = namespace;
        }
        return namespace;
      })
      .catch((error) => {
        threeModulePromise = undefined;
        throw error;
      });
  }
  return threeModulePromise;
}

async function loadCommonJSModule(path) {
  if (localModuleCache.has(path)) {
    return localModuleCache.get(path);
  }

  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch module ${path}: ${response.status} ${response.statusText}`);
  }

  const source = await response.text();
  const module = { exports: {} };
  const fn = new Function('module', 'exports', source);
  fn(module, module.exports);
  localModuleCache.set(path, module.exports);
  return module.exports;
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

  const [three, simulationUtils] = await Promise.all([
    loadThreeModule(),
    loadCommonJSModule('./simulation-utils.js'),
  ]);

  const module = { exports: {} };
  const require = (name) => {
    switch (name) {
      case 'react':
        return React;
      case 'three':
        return three;
      case './simulation-utils.js':
        return simulationUtils;
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
