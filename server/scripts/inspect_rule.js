// server/scripts/inspect_rule.js
// Run with: node server/scripts/inspect_rule.js
import db from '../db.js';

function showSchema() {
  const rows = db.prepare("PRAGMA table_info('rules')").all();
  console.log('rules schema:', rows);
}

function listRules(limit = 50) {
  const rows = db.prepare("SELECT id, name, category_id, length(workflow_object) AS wf_len FROM rules LIMIT ?").all(limit);
  console.log(`first ${limit} rules:`, rows);
}

function findByWorkflowContent(idFragment) {
  const q = db.prepare("SELECT id, name, workflow_object FROM rules WHERE workflow_object LIKE ? LIMIT 20");
  const rows = q.all(`%${idFragment}%`);
  for (const r of rows) {
    console.log('MATCH:', r.id, r.name);
    console.log('snippet:', (r.workflow_object || '').slice(0, 1000));
  }
}

(async () => {
  showSchema();
  listRules(50);
  findByWorkflowContent('980323084');
})();