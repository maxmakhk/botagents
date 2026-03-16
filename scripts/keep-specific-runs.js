#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const runsPath = path.join(root, 'runs_store.json');
const backupPath = path.join(root, `runs_store.json.keepbackup.${Date.now()}`);

if (!fs.existsSync(runsPath)) {
  console.error('runs_store.json not found at', runsPath);
  process.exit(1);
}

fs.copyFileSync(runsPath, backupPath);
console.log('Backed up runs_store.json ->', backupPath);

// Add the rule IDs you want to keep here
const keepIds = new Set([
  'rule_1773360377217_1n6l7n', // main
  'rule_1773360383383_n0u551'  // action1
]);

const raw = JSON.parse(fs.readFileSync(runsPath, 'utf8'));
const projects = Array.isArray(raw.projects) ? raw.projects : [];

const filtered = projects.filter(p => p && p.projectId && keepIds.has(p.projectId));

const out = { ...raw, savedAt: new Date().toISOString(), projects: filtered };
fs.writeFileSync(runsPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`Kept ${filtered.length} of ${projects.length} projects (backup at ${backupPath})`);
