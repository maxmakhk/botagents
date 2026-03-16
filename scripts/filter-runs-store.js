#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const root = process.cwd();
const runsPath = path.join(root, 'runs_store.json');
const backupPath = path.join(root, `runs_store.json.bak.${Date.now()}`);
const dbPath = path.join(root, 'data', 'botagents.db');

if (!fs.existsSync(runsPath)) {
  console.error('runs_store.json not found at', runsPath);
  process.exit(1);
}

fs.copyFileSync(runsPath, backupPath);
console.log('Backed up runs_store.json ->', backupPath);

let db = null;
try {
  if (fs.existsSync(dbPath)) db = new Database(dbPath, { readonly: true });
  else console.warn('SQLite DB not found at', dbPath);
} catch (e) {
  console.warn('Failed to open sqlite DB:', e.message || e);
}

const raw = JSON.parse(fs.readFileSync(runsPath, 'utf8'));
const projects = Array.isArray(raw.projects) ? raw.projects : [];

function nodeContainsAction1(node) {
  try {
    const candidates = [];
    if (node.metadata && typeof node.metadata === 'object') {
      candidates.push(node.metadata.apiName, node.metadata.action, node.metadata.name);
    }
    candidates.push(node.label, node.type, node.id);
    return candidates.some(c => c && String(c).toLowerCase().includes('action1'));
  } catch (e) { return false; }
}

// Build whitelist of rule IDs from sqlite: name === 'main' OR workflow_object contains 'action1'
const whitelist = new Set();
try {
  if (db) {
    const rows = db.prepare("SELECT id, name, workflow_object FROM rules WHERE name = 'main' OR lower(workflow_object) LIKE '%action1%'").all();
    for (const r of rows || []) {
      if (r && r.id) whitelist.add(r.id);
    }
  }
} catch (e) {
  console.warn('Failed to query sqlite for whitelist:', e.message || e);
}

// Filter projects: keep if projectId in whitelist OR contains node matching 'action1'
const filtered = projects.filter(p => {
  if (!p || !p.projectId) return false;
  if (whitelist.has(p.projectId)) return true;
  if (Array.isArray(p.nodes)) {
    for (const n of p.nodes) {
      if (nodeContainsAction1(n)) return true;
    }
  }
  return false;
});

const out = { ...raw, savedAt: new Date().toISOString(), projects: filtered };
fs.writeFileSync(runsPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`Filtered runs_store.json: kept ${filtered.length} of ${projects.length} projects (backup at ${backupPath})`);

if (db) db.close();
