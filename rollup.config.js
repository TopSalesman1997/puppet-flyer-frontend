// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import * as pluginTerser from '@rollup/plugin-terser';
import url from '@rollup/plugin-url';
import copy from 'rollup-plugin-copy';

// Support various plugin export shapes:
// - some installs export { terser }
// - others export default
const terser = (pluginTerser && (pluginTerser.terser || pluginTerser.default || pluginTerser));

// Plugins array
const plugins = [
  resolve({
    browser: true,
    preferBuiltins: false
  }),
  commonjs(),
  url({
    include: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.svg', '**/*.gif'],
    limit: 10 * 1024, // inline files < 10KB
    emitFiles: true,
    // write emitted assets to dist/assets
    fileName: 'assets/[name]-[hash][extname]'
  }),
  // Only call terser if the import resolved to a function
  ...(typeof terser === 'function' ? [terser()] : []),
  copy({
    targets: [
      { src: 'assets/*', dest: 'dist/assets' },
      { src: 'index.html', dest: 'dist' }
    ],
    copyOnce: true
  })
];

export default [
  {
    input: 'src/firebase-client.js',
    output: {
      file: 'dist/js/firebaseClient.bundle.js',
      format: 'iife',
      name: 'FirebaseClient',
      sourcemap: true,
    },
    plugins
  },
  {
    input: 'src/script.js',
    output: {
      file: 'dist/js/script.bundle.js',
      format: 'iife',
      name: 'Script',
      sourcemap: true,
    },
    plugins
  },
  {
    input: 'src/index.js',
    output: {
      file: 'dist/js/index.bundle.js',
      format: 'iife',
      name: 'Index',
      sourcemap: true,
    },
    plugins
  }
];
