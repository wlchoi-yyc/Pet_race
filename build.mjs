import { mkdir, cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of ['index.html', 'auth.js', 'auth.css', 'game.js', 'audio.js', 'models.js', 'scanpet.js', 'style.css', 'assets', 'lib']) {
  await cp(file, `dist/${file}`, { recursive: true });
}
console.log('Pet Race built for pet-race-wlchoi only.');
