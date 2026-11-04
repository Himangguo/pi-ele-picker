import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// The source plugin, not the built one: the tests must fail on a broken client
// without anyone remembering to run `npm run build` first. `resolveClientFile`
// falls back to this package's own `client/picker.js`, so that is what gets served.
import piElePicker from '../../src/index.ts';

/** Must match `PORT` in ../../playwright.config.ts. */
const PORT = 5273;
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [piElePicker({ root })],
  server: {
    // Bind IPv4 explicitly: `localhost` resolves to ::1 first on some machines,
    // which would leave Playwright polling 127.0.0.1 against nothing.
    host: '127.0.0.1',
    port: PORT,
    // A silent fallback to another port would leave Playwright waiting on the
    // wrong URL, so fail loudly instead.
    strictPort: true,
  },
});
