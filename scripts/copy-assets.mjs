import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('build/db', { recursive: true });
await copyFile('db/schema.sql', 'build/db/schema.sql');
