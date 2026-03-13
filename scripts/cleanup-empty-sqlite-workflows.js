#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'data', 'botagents.db');

function normalizeWorkflowObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

async function main() {
  const doDelete = process.argv.includes('--do-delete') || process.argv.includes('-y');
  console.log('Opening sqlite DB:', dbPath);
  const db = new Database(dbPath, { readonly: false });

  // Ensure rules table exists
  try {
    const rows = db.prepare('SELECT id, workflow_object FROM rules').all();
    console.log(`Found ${rows.length} rows in rules table`);
    const toDelete = [];
    for (const r of rows) {
      const wf = normalizeWorkflowObject(r.workflow_object);
      const nodesLen = Array.isArray(wf?.nodes) ? wf.nodes.length : 0;
      if (nodesLen === 0) toDelete.push({ id: r.id });
    }

    console.log(`Documents with nodes.length === 0: ${toDelete.length}`);
    toDelete.forEach(d => console.log(' -', d.id));

    if (!toDelete.length) {
      console.log('Nothing to delete. Exiting.');
      process.exit(0);
    }

    if (!doDelete) {
      console.log('\nDry run. To actually delete run with --do-delete or -y');
      process.exit(0);
    }

    const delStmt = db.prepare('DELETE FROM rules WHERE id = ?');
    for (const d of toDelete) {
      try {
        delStmt.run(d.id);
        console.log('Deleted', d.id);
      } catch (e) {
        console.error('Failed to delete', d.id, e.message || e);
      }
    }

    console.log('Done');
    process.exit(0);
  } catch (e) {
    console.error('Error scanning rules table:', e.message || e);
    process.exit(1);
  }
}

main();
