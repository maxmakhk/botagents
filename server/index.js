import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import db from './db.js';
import { randomUUID } from 'crypto';
import http from 'http';
import { Server } from 'socket.io';
import { runWorkflow } from './workflowRunner.js';
import runManager from './runManager.js';
import { processPrompt } from './workflowPromptProcessor.js';
import projectManager from './projectManager.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json());
app.use(cors());

// -- Helpers ---------------------------------------------------------------
function normalizeTs(val) {
  if (!val) return new Date().toISOString();
  try { if (typeof val.toDate === 'function') return val.toDate().toISOString(); } catch (e) { }
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

// Ensure logs table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
`);

// Ensure variables table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS variables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    qty REAL,
    tag TEXT,
    signal TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

// ------------------ Logs API ----------------------------------------------
app.get('/api/logs', (req, res) => {
  try {
    const loadAll = req.query.all === 'true';
    const limitClause = loadAll ? '' : 'LIMIT 10';
    const rows = db.prepare(`SELECT id, payload FROM logs ORDER BY created_at DESC ${limitClause}`).all();

    // Parse the payload back out so the frontend receives the expected shape
    const logs = rows.map(r => {
      let data = {};
      try { data = JSON.parse(r.payload); } catch (e) { }
      return { id: r.id, ...data };
    });

    res.json({ logs, allLoaded: loadAll || logs.length < 10 });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/logs', (req, res) => {
  try {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // Merge ID/createdAt just in case so they exist in payload too
    const payloadData = { ...req.body, id, createdAt: req.body.createdAt || createdAt };

    const stmt = db.prepare('INSERT INTO logs (id, created_at, payload) VALUES (?, ?, ?)');
    stmt.run(id, createdAt, JSON.stringify(payloadData));
    res.json({ success: true, id });
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
    console.log(`check0221 Loaded ${rows.length} rules for categoryId=${categoryId || 'all'}`);
    // parse JSON workflow_object when present
    const parsed = rows.map(r => ({ ...r, workflowObject: r.workflow_object ? (() => { try { return JSON.parse(r.workflow_object); } catch (e) { return r.workflow_object; } })() : null }));
    res.json(parsed);
  } catch (err) { 
    console.error('check0221 Error loading rules:', err);
    res.status(500).json({ error: String(err) }); 

  }
});

app.get('/api/rules/:id', (req, res) => {
  try {
    const id = req.params.id;
    const row = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const out = { ...row, workflowObject: row.workflow_object ? (() => { try { return JSON.parse(row.workflow_object); } catch (e) { return row.workflow_object; } })() : null };
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

// ------------------ Variables API ----------------------------------------
app.get('/api/variables', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM variables ORDER BY created_at DESC').all();
    // Parse tag and signal JSON fields
    const parsed = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      qty: r.qty,
      tag: r.tag ? (() => { try { return JSON.parse(r.tag); } catch (e) { return []; } })() : [],
      signal: r.signal ? (() => { try { return JSON.parse(r.signal); } catch (e) { return {}; } })() : {},
      created_at: r.created_at,
      updated_at: r.updated_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/variables', (req, res) => {
  try {
    const id = req.body.id || randomUUID();
    const name = req.body.name || '';
    const description = typeof req.body.description === 'string' ? req.body.description : (req.body.description ? JSON.stringify(req.body.description) : '');
    const qty = typeof req.body.qty === 'number' ? req.body.qty : 0;
    const tag = req.body.tag ? (Array.isArray(req.body.tag) ? JSON.stringify(req.body.tag) : (typeof req.body.tag === 'string' ? req.body.tag : JSON.stringify(req.body.tag))) : '[]';
    const signal = req.body.signal ? (typeof req.body.signal === 'string' ? req.body.signal : JSON.stringify(req.body.signal)) : '{}';
    const created_at = normalizeTs(req.body.createdAt || req.body.created_at || new Date().toISOString());
    const updated_at = normalizeTs(req.body.updatedAt || req.body.updated_at || new Date().toISOString());

    const stmt = db.prepare('INSERT OR REPLACE INTO variables (id, name, description, qty, tag, signal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    stmt.run(id, name, description, qty, tag, signal, created_at, updated_at);
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.put('/api/variables/:id', (req, res) => {
  try {
    const id = req.params.id;
    const name = req.body.name;
    const description = typeof req.body.description === 'string' ? req.body.description : (req.body.description ? JSON.stringify(req.body.description) : undefined);
    const qty = typeof req.body.qty === 'number' ? req.body.qty : undefined;
    const tag = req.body.tag ? (Array.isArray(req.body.tag) ? JSON.stringify(req.body.tag) : (typeof req.body.tag === 'string' ? req.body.tag : JSON.stringify(req.body.tag))) : undefined;
    const updated_at = normalizeTs(new Date().toISOString());

    let updates = [];
    let params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (qty !== undefined) { updates.push('qty = ?'); params.push(qty); }
    if (tag !== undefined) { updates.push('tag = ?'); params.push(tag); }
    updates.push('updated_at = ?');
    params.push(updated_at);
    params.push(id);

    if (updates.length > 0) {
      const stmt = db.prepare(`UPDATE variables SET ${updates.join(', ')} WHERE id = ?`);
      stmt.run(...params);
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.delete('/api/variables/:id', (req, res) => {
  try {
    const id = req.params.id;
    const stmt = db.prepare('DELETE FROM variables WHERE id = ?');
    stmt.run(id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/variables/:id/signal/:signalName', (req, res) => {
  try {
    const id = req.params.id;
    const signalName = req.params.signalName;

    const row = db.prepare('SELECT signal FROM variables WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    let signal = {};
    try { signal = JSON.parse(row.signal || '{}'); } catch (e) { }

    const newSignalData = { ...req.body, lastUpdatedAt: req.body.lastUpdatedAt || new Date().toISOString() };
    signal[signalName] = newSignalData;

    const updated_at = normalizeTs(new Date().toISOString());
    const stmt = db.prepare('UPDATE variables SET signal = ?, updated_at = ? WHERE id = ?');
    stmt.run(JSON.stringify(signal), updated_at, id);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.put('/api/variables/:id/signal/:signalName/:fieldName', (req, res) => {
  try {
    const id = req.params.id;
    const signalName = req.params.signalName;
    const fieldName = req.params.fieldName;
    const value = req.body.value;

    const row = db.prepare('SELECT signal FROM variables WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    let signal = {};
    try { signal = JSON.parse(row.signal || '{}'); } catch (e) { }

    if (!signal[signalName]) signal[signalName] = {};
    signal[signalName][fieldName] = value;
    signal[signalName].lastUpdatedAt = new Date().toISOString();

    const updated_at = normalizeTs(new Date().toISOString());
    const stmt = db.prepare('UPDATE variables SET signal = ?, updated_at = ? WHERE id = ?');
    stmt.run(JSON.stringify(signal), updated_at, id);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.delete('/api/variables/:id/signal/:signalName', (req, res) => {
  try {
    const id = req.params.id;
    const signalName = req.params.signalName;

    const row = db.prepare('SELECT signal FROM variables WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });

    let signal = {};
    try { signal = JSON.parse(row.signal || '{}'); } catch (e) { }

    delete signal[signalName];

    const updated_at = normalizeTs(new Date().toISOString());
    const stmt = db.prepare('UPDATE variables SET signal = ?, updated_at = ? WHERE id = ?');
    stmt.run(JSON.stringify(signal), updated_at, id);

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

// ------------------ Socket.IO Workflow Execution -------------------------
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Register client with ProjectManager
  projectManager.registerClient(socket.id, socket);

  // Client wants to watch a project
  socket.on('watch_project', (data) => {
    const { projectId } = data || {};
    if (!projectId) return;
    console.log(`[Socket] Client ${socket.id} wants to watch project ${projectId}`);
    projectManager.watchProject(socket.id, projectId);
  });

  // Client wants to unwatch current project
  socket.on('unwatch_project', () => {
    const client = projectManager.clients.get(socket.id);
    if (client && client.projectId) {
      projectManager.unwatchProject(socket.id, client.projectId);
      client.projectId = null;
    }
  });

  // Client triggers run/stop for a project
  socket.on('project_control', (data) => {
    const { projectId, action } = data || {};
    if (!projectId || !action) return;

    console.log(`[Socket] Client ${socket.id} ${action} project ${projectId}`);

    // Ensure client is watching this project
    const client = projectManager.clients.get(socket.id);
    if (client && client.projectId !== projectId) {
      console.log(`[Socket] Client ${socket.id} not watching ${projectId}, auto-watching now`);
      projectManager.watchProject(socket.id, projectId);
    }

    if (action === 'run') {
      // Load or update project with provided data
      const nodes = data.nodes || [];
      const edges = data.edges || [];
      const apis = data.apis || [];
      const stepDelay = data.stepDelay || 1000;
      
      console.log(`[Socket] Starting project ${projectId} with ${nodes.length} nodes, ${edges.length} edges`);
      
      // Start project (sets status to 'running', execution loop will pick it up)
      projectManager.startProject(projectId, nodes, edges, apis, stepDelay);
      
    } else if (action === 'stop') {
      console.log(`[Socket] Stopping project ${projectId}`);
      // Stop project (sets status to 'stopped', execution loop will abort it)
      projectManager.stopProject(projectId);
    }
  });

  // Client updates workflow (nodes/edges)
  socket.on('update_project_workflow', (data) => {
    const { projectId, nodes, edges } = data || {};
    if (!projectId) return;

    console.log(`[Socket] Client ${socket.id} updated workflow for ${projectId}`);
    projectManager.updateProjectWorkflow(projectId, nodes, edges);
  });

  // Allow clients to subscribe to run updates by runId
  socket.on('run.subscribe', (data) => {
    try {
      const { runId } = data || {};
      if (!runId) return socket.emit('run_error', { message: 'runId required to subscribe' });
      const room = `run:${runId}`;
      socket.join(room);
      const run = runManager.getRun(runId);
      socket.emit('run_status', run ? { runId: run.runId, status: run.status, projectId: run.projectId } : { notFound: true });
    } catch (e) { console.warn('subscribe error', e); }
  });

  // Allow clients to unsubscribe from run updates
  socket.on('run.unsubscribe', (data) => {
    try {
      const { runId } = data || {};
      if (!runId) return;
      socket.leave(`run:${runId}`);
    } catch (e) { }
  });

  // Client-side control messages forwarded to run manager
  socket.on('run.control', (data) => {
    try {
      const { runId, event, payload } = data || {};
      if (!runId || !event) return socket.emit('run_control_ack', { ok: false, message: 'runId and event required' });
      const ok = runManager.receiveClientEvent(runId, event, payload);
      socket.emit('run_control_ack', { ok });
    } catch (e) { socket.emit('run_control_ack', { ok: false, message: String(e) }); }
  });

  // Allow starting a run via socket (convenience)
  socket.on('run.start', (data) => {
    try {
      const run = runManager.startRun(data || {});
      socket.emit('run.started', { runId: run.runId, projectId: run.projectId });
    } catch (e) { socket.emit('run_error', { message: String(e) }); }
  });

  socket.on('run_workflow', async (data) => {
    try {
      console.log(`[Socket ${socket.id}] Starting workflow execution`);
      await runWorkflow(socket, data);
    } catch (err) {
      console.error('Workflow execution error:', err);
      try {
        socket.emit('workflow_complete');
      } catch (e) { }
    }
  });

  socket.on('process_prompt', async (data) => {
    const { nodeId, promptText, apis = [], workflowData = null } = data;
    console.log(`[Socket ${socket.id}] Processing prompt for node:`, nodeId);

    try {
      // Emit start event
      socket.emit('prompt_processing_start', { nodeId });

      // Run the pipeline
      const result = await processPrompt({ nodeId, promptText, apis, workflowData });

      // Emit progress events
      socket.emit('prompt_normalized', {
        nodeId,
        normalizedPrompt: result.normalizedPrompt,
        originalPrompt: result.originalPrompt
      });

      socket.emit('function_generated', {
        nodeId,
        fnString: result.fnString,
        normalizeFnString: result.normalizeFnString
      });

      // Emit final result
      socket.emit('workflow_ready', {
        nodeId,
        workflowData: result.workflowData,
        nodes: result.workflowData?.nodes || [],
        edges: result.workflowData?.edges || [],
        metadata: {
          originalPrompt: result.originalPrompt,
          normalizedPrompt: result.normalizedPrompt,
          fnString: result.fnString,
          normalizeFnString: result.normalizeFnString
        }
      });

      console.log(`[Socket ${socket.id}] Prompt processing completed for node:`, nodeId);
    } catch (err) {
      console.error(`[Socket ${socket.id}] Prompt processing failed:`, err);
      socket.emit('prompt_error', {
        nodeId,
        message: err.message || 'Failed to process prompt'
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    projectManager.unregisterClient(socket.id);
  });
});

// Initialize run manager with io so it can broadcast to rooms
runManager.init(io);

// Initialize project manager with io and start execution loop
projectManager.init(io);

// ------------------ Run Control REST API --------------------------------
app.post('/api/run/start', (req, res) => {
  try {
    const { projectId, nodes, edges, apis, options } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const run = runManager.startRun({ projectId, nodes, edges, apis, options });
    res.json({ success: true, runId: run.runId });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/run/stop', (req, res) => {
  try {
    const { runId } = req.body || {};
    if (!runId) return res.status(400).json({ error: 'runId required' });
    const r = runManager.stopRun(runId);
    res.json({ success: !!r });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.get('/api/run/status', (req, res) => {
  try {
    const { projectId, runId } = req.query || {};
    if (projectId) {
      const s = runManager.getRunStatusByProject(projectId);
      //console.log(`[RunStatus] query projectId=${projectId} -> ${s ? `runId=${s.runId} status=${s.status}` : 'no-run'}`);
      return res.json(s || {});
    }
    if (runId) {
      const s = runManager.getRun(runId);
      return res.json(s || {});
    }
    res.status(400).json({ error: 'projectId or runId required' });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log('server running on', port);
});
