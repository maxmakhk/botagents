import express from 'express';
import cors from 'cors';
import db from './db.js';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());
app.use(cors());

// -- Helpers ---------------------------------------------------------------
function normalizeTs(val) {
  if (!val) return new Date().toISOString();
  try { if (typeof val.toDate === 'function') return val.toDate().toISOString(); } catch (e) {}
  if (typeof val === 'string') return val;
  try { return new Date(val).toISOString(); } catch (e) { return new Date().toISOString(); }
}

// Ensure rule_categories table exists (migration scripts created it, but be safe)
db.exec(`
  CREATE TABLE IF NOT EXISTS rule_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
  );
`);

// Ensure rules table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    rule_id TEXT,
    type TEXT,
    name TEXT,
    expr TEXT,
    detect_prompt TEXT,
    system_prompt TEXT,
    related_fields TEXT,
    category_id TEXT,
    workflow_object TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// ------------------ Rule Categories API ----------------------------------
app.get('/api/rule-categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name, description, created_at FROM rule_categories ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/rule-categories', (req, res) => {
  try {
    const id = req.body.id || randomUUID();
    const name = req.body.name || 'Unnamed';
    const description = req.body.description || null;
    const created_at = normalizeTs(req.body.created_at || new Date().toISOString());
    const stmt = db.prepare('INSERT OR REPLACE INTO rule_categories (id, name, description, created_at) VALUES (?, ?, ?, ?)');
    stmt.run(id, name, description, created_at);
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.put('/api/rule-categories/:id', (req, res) => {
  try {
    const id = req.params.id;
    const name = req.body.name;
    const description = req.body.description;
    const stmt = db.prepare('UPDATE rule_categories SET name = ?, description = ? WHERE id = ?');
    stmt.run(name, description, id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.delete('/api/rule-categories/:id', (req, res) => {
  try {
    const id = req.params.id;
    const stmt = db.prepare('DELETE FROM rule_categories WHERE id = ?');
    stmt.run(id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ------------------ Rules API --------------------------------------------
app.get('/api/rules', (req, res) => {
  try {
    const categoryId = req.query.categoryId;
    let rows;
    if (categoryId && categoryId !== 'all') {
      rows = db.prepare('SELECT * FROM rules WHERE category_id = ? ORDER BY created_at DESC').all(categoryId);
    } else {
      rows = db.prepare('SELECT * FROM rules ORDER BY created_at DESC').all();
    }
    // parse JSON workflow_object when present
    const parsed = rows.map(r => ({ ...r, workflowObject: r.workflow_object ? (() => { try { return JSON.parse(r.workflow_object); } catch(e){ return r.workflow_object; } })() : null }));
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.get('/api/rules/:id', (req, res) => {
  try {
    const id = req.params.id;
    const row = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const out = { ...row, workflowObject: row.workflow_object ? (() => { try { return JSON.parse(row.workflow_object); } catch(e){ return row.workflow_object; } })() : null };
    res.json(out);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/rules', (req, res) => {
  try {
    const id = req.body.id || randomUUID();
    const rule_id = req.body.ruleId || req.body.rule_id || req.body.ruleId || id;
    const type = req.body.type || '';
    const name = req.body.name || '';
    const expr = typeof req.body.expr === 'string' ? req.body.expr : (req.body.expr ? JSON.stringify(req.body.expr) : '');
    const detect_prompt = req.body.detectPrompt || req.body.detect_prompt || '';
    const system_prompt = req.body.systemPrompt || req.body.system_prompt || '';
    const related_fields = req.body.relatedFields ? (typeof req.body.relatedFields === 'string' ? req.body.relatedFields : JSON.stringify(req.body.relatedFields)) : '';
    const category_id = req.body.categoryId || req.body.category_id || '';
    let workflow_object = req.body.workflowObject || req.body.workflow_object || '';
    if (workflow_object && typeof workflow_object !== 'string') {
      try { workflow_object = JSON.stringify(workflow_object); } catch (e) { workflow_object = String(workflow_object); }
    }
    const created_at = normalizeTs(req.body.created_at || req.body.createdAt || new Date().toISOString());
    const updated_at = normalizeTs(req.body.updated_at || req.body.updatedAt || new Date().toISOString());

    const stmt = db.prepare(`INSERT OR REPLACE INTO rules (
      id, rule_id, type, name, expr, detect_prompt, system_prompt, related_fields, category_id, workflow_object, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(id, rule_id, type, name, expr, detect_prompt, system_prompt, related_fields, category_id, workflow_object, created_at, updated_at);
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.delete('/api/rules/:id', (req, res) => {
  try {
    const id = req.params.id;
    const stmt = db.prepare('DELETE FROM rules WHERE id = ?');
    stmt.run(id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// 建立一個 world（測試用）
app.post('/worlds', (req, res) => {
  const id = randomUUID();
  const name = req.body.name || 'Untitled World';
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(
    'INSERT INTO worlds (id, name, created_at) VALUES (?, ?, ?)'
  );
  stmt.run(id, name, createdAt);

  res.json({ id, name, createdAt });
});

// 取得全部 worlds
app.get('/worlds', (req, res) => {
  const rows = db.prepare('SELECT * FROM worlds').all();
  res.json(rows);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log('server running on', port);
});
