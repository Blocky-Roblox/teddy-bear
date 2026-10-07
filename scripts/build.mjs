import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true,
  write: false, format: 'iife', target: 'es2020', legalComments: 'inline'
});
const template = await readFile('src/template.html', 'utf8');
const css = await readFile('src/styles.css', 'utf8');
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const licenses = await Promise.all(['three', 'cannon-es'].map(async name => `${name}\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`));
const html = template.replace('/* INLINE_STYLES */', () => css).replace('/* INLINE_APP */', () => script)
  .replace('<!-- THIRD_PARTY_LICENSES -->', () => `<!--\n${licenses.join('\n\n')}\n-->`).replace(/[ \t]+$/gm, '');
// Function replacements preserve literal $ sequences in bundled dependencies.
// Check the actual embedded artifact, not only esbuild's intermediate output.
new Script(html.match(/<script>([\s\S]*)<\/script>/)[1], {filename: 'index.html inline script'});
await writeFile('index.html', html);
console.log(`Built self-contained index.html (${Math.round((await readFile('index.html')).length / 1024)} KiB).`);
