// A fresh clone has no worker/profile.mjs (it is git-ignored), so copy the example in.
import { copyFileSync, existsSync } from 'node:fs';

const target = new URL('../worker/profile.mjs', import.meta.url);
if (!existsSync(target)) {
  copyFileSync(new URL('../worker/profile.example.mjs', import.meta.url), target);
  console.log('Created worker/profile.mjs from worker/profile.example.mjs');
}
