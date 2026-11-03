import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const parent = resolve(import.meta.dirname, '..');
export const projectRoot = existsSync(resolve(parent, 'package.json'))
  ? parent
  : resolve(parent, '..');
