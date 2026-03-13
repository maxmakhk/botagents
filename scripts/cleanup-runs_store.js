#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

async function main() {
  const doDelete = process.argv.includes('--do-delete') || process.argv.includes('-y');
  const fp = path.join(process.cwd(), 'runs_store.json');
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const parsed = JSON.parse(raw);
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    console.log(`Loaded runs_store.json - projects: ${projects.length}`);

    const empties = projects.filter(p => !(p && Array.isArray(p.nodes) && p.nodes.length > 0));
    console.log(`Found ${empties.length} project(s) with nodes.length === 0`);
    empties.forEach(p => console.log(' -', p.projectId || p.projectId === 0 ? p.projectId : JSON.stringify(p).slice(0,80)));

    if (!empties.length) return process.exit(0);

    if (!doDelete) {
      console.log('\nDry run complete. To actually delete, re-run with --do-delete or -y');
      return process.exit(0);
    }

    // Backup
    const bakPath = path.join(process.cwd(), `runs_store.json.bak.${Date.now()}`);
    await fs.copyFile(fp, bakPath);
    console.log('Backup saved to', bakPath);

    const remaining = projects.filter(p => (p && Array.isArray(p.nodes) && p.nodes.length > 0));
    parsed.projects = remaining;
    await fs.writeFile(fp, JSON.stringify(parsed, null, 2), 'utf8');
    console.log(`Deleted ${empties.length} projects from runs_store.json`);
    process.exit(0);
  } catch (e) {
    console.error('Error:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
