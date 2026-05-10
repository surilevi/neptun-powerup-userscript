import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/index.ts',
      userscript: {
        name: 'Neptun PowerUp!',
        namespace: 'npu',
        version: pkg.version,
        description: 'Neptun helper userscript for course and exam workflows',
        author: 'surilevi',
        license: 'MIT',
        icon: 'https://www.google.com/s2/favicons?sz=64&domain=neptun.net',
        match: [
          // Generic Neptun student portals:
          // hallgatoi, hallgato_ng, hallgatoing, etc.
          'https://*/hallgato*/*',
          // Obuda and some other deployments use /ujhallgato
          'https://*/ujhallgato/*',
        ],
        grant: ['GM.getValue', 'GM.setValue', 'GM.info'],
      },
      build: {
        fileName: 'npu.user.js',
      },
    }),
  ],
  build: {
    minify: false,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
