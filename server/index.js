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
import path from 'path';
import { initializeApp } from 'firebase/app';

// System prompt generator (moved out of client code)
import { generateSystemPrompt } from './systemPromptGenerator.js';
import { requestNodesAndEdgesFromXai } from './xaiService.js';
import { requestFromOllama } from './ollamaService.js';
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp, getDocs } from 'firebase/firestore';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Increase default body size limit to reduce PayloadTooLarge occurrences during debugging
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// Temporary logging middleware: prints claimed content-length and route to help find large requests
app.use((req, res, next) => {
  try {
    //const cl = req.headers['content-length'] || '(none)';
    //console.log(`[REQ-SIZE] ${req.method} ${req.originalUrl} content-length=${cl}`);
  } catch (e) { /* ignore */ }
  next();
});

// Initialize Firebase for server-side Firestore operations (used by endpoints below)
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || '',
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || ''
};

console.log('[Firebase Init] Config loaded. projectId:', firebaseConfig.projectId ? '(set)' : '(empty)');
console.log('[Firebase Init] apiKey:', firebaseConfig.apiKey ? '(set)' : '(empty)');
console.log('[Firebase Init] authDomain:', firebaseConfig.authDomain ? '(set)' : '(empty)');

let firebaseApp = null;
let firestore = null;
try {
  if (firebaseConfig.projectId) {
    firebaseApp = initializeApp(firebaseConfig);
    firestore = getFirestore(firebaseApp);
    console.log('[Firebase Init] ✓ Initialized Firebase successfully');
  } else {
    console.warn('[Firebase Init] ✗ Firebase not configured - missing projectId. Set VITE_FIREBASE_PROJECT_ID or FIREBASE_PROJECT_ID in .env');
  }
} catch (e) {
  console.error('[Firebase Init] ✗ Failed to initialize Firebase:', e.message);
}

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

/*
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Workflow trigger URLs
app.get('/trigger/:workflowName', async (req, res) => {
  try {
    const { workflowName } = req.params;
    const result = projectManager.findWorkflowByName(workflowName);
    
    if (!result) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    const { projectId, project } = result;

    // Get first node and set it as activeNodeId
    const firstNode = project.nodes && project.nodes[0];
    if (!firstNode) {
      return res.status(400).json({ success: false, error: 'Workflow has no nodes' });
    }

    project.activeNodeId = firstNode.id;

    res.json({ success: true, projectId, activeNodeId: firstNode.id });
  } catch (error) {
    console.error('[/trigger/:workflowName] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/trigger/:workflowName/:nodeLabel', async (req, res) => {
  try {
    const { workflowName, nodeLabel } = req.params;
    const result = projectManager.findWorkflowByName(workflowName);
    //console.log("[trigger/:workflowName/:nodeLabel]", result, "[workflowName/]", workflowName, "[nodeLabel/]", nodeLabel);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    const { projectId, project } = result;

    // Find node by label
    const targetNode = projectManager.findNodeByLabel(projectId, nodeLabel);
    if (!targetNode) {
      return res.status(404).json({ success: false, error: `Node with label "${nodeLabel}" not found` });
    }

    // Store node ID as jumpID for /run/:workflowID to use
    project.jumpID = targetNode.id;

    console.log(`[Trigger] Stored jumpID=${targetNode.id} for workflow "${workflowName}" (projectId=${projectId}). Call /run/${workflowName} to continue execution from this node.`); 

    fetch('http://localhost:3001/run/'+ workflowName)

    res.json({ success: true, projectId, nodeId: targetNode.id, message: 'Node ID stored in jumpID, call /run/:workflowID to continue' });
  } catch (error) {
    console.error('[/trigger/:workflowName/:nodeLabel] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/stop/:workflowName', (req, res) => {
  try {
    const { workflowName } = req.params;
    const result = projectManager.findWorkflowByName(workflowName);
    
    if (!result) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    const { projectId } = result;
    projectManager.stopProject(projectId);
    
    res.json({ success: true, projectId });
  } catch (error) {
    console.error('[/stop/:workflowName] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
*/

/*
// Update workflow waiting state (supports both workflow name and ID)
app.get('/wait/:workflowID/:status', (req, res) => {
  try {
    const { workflowID, status } = req.params;
    console.log(`/wait/ ${workflowID} to ${status}`);
    
    // Parse status (true/false or 1/0)
    const waitingState = (status === 'true' || status === '1');
    
    // Try to find by workflow name first
    let result = projectManager.findWorkflowByName(workflowID);
    let projectId = result ? result.projectId : workflowID;
    
    // If not found by name, try by ID
    const project = result ? result.project : projectManager.getProject(workflowID);
    
    if (!project) {
      console.warn(`Workflow ${workflowID} not found for /wait endpoint`);
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    // Update waiting_wait state and capture detailed resume diagnostics
    const waitResult = projectManager.setWaitingState(projectId, waitingState);

    // If resume was requested but no waiting resolver was active, return 409 for clearer client behavior
    if (!waitingState && waitResult && waitResult.canResume === false) {
      return res.status(409).json({
        success: false,
        projectId,
        waiting_wait: waitingState,
        activeRun: !!waitResult.activeRun,
        resolvedCount: Number(waitResult.resolvedCount || 0),
        error: 'No active waiting node to resume (workflow may have already finished or was not paused).'
      });
    }
    
    res.json({ 
      success: true, 
      projectId: projectId, 
      waiting_wait: waitingState,
      activeRun: waitResult ? !!waitResult.activeRun : false,
      resolvedCount: waitResult ? Number(waitResult.resolvedCount || 0) : 0,
      message: waitingState ? 'Workflow paused' : 'Workflow resumed'
    });
  } catch (error) {
    console.error('[/wait/:workflowID/:status] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
*/

//http://localhost:3001/deleterun/runId
app.get('/deleterun/:runID', async (req, res) => {
  console.log("------------------------------------------");
  console.log("--------DELETE RUN BY ID(endpoint)--------");
  console.log(`----runID  ${req.params.runID}----`);
  console.log("------------------------------------------");

  try {
    const runID = req.params.runID;
    if (!runID) {
      return res.status(400).json({ success: false, error: 'runID required' });
    }
    
    console.log(`[/deleterun/:runID] Deleting run: ${runID}`);
    const ok = runManager.deleteRun(runID);
    
    if (!ok) {
      console.log(`[/deleterun/:runID] Run not found: ${runID}`);
      return res.status(404).json({ success: false, error: 'run not found' });
    }
    
    console.log(`[/deleterun/:runID] ✓ Successfully deleted run: ${runID}`);
    res.json({ success: true, runID, message: 'Run deleted' });
  } catch (err) {
    console.error(`[/deleterun/:runID] Error:`, err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

//0317 Jump to node by ID and resume execution
//http://localhost:3001/gobynodeid/:runID/:nodeId
app.get('/gobynodeid/:runID/:nodeId', async (req, res) => {
  console.log("------------------------------------------");
  console.log("--------GO NODE BY ID (endpoint)--------");
  console.log(`----runID  ${req.params.runID}----`);
  console.log(`----nodeId ${req.params.nodeId}----`);
  console.log("------------------------------------------");

  try {
    const { runID, nodeId } = req.params;
    if (!runID || !nodeId) {
      return res.status(400).json({ success: false, error: 'runID and nodeId required' });
    }

    // Get the run object
    const run = runManager.getRun(runID);
    if (!run) {
      return res.status(404).json({ success: false, error: 'run not found' });
    }

    // Verify the node exists in this run
    const nodeList = Array.isArray(run.nodes) ? run.nodes : [];
    const targetNode = nodeList.find(n => String(n.id) === String(nodeId));
    
    if (!targetNode) {
      return res.status(404).json({
        success: false,
        error: `Node with ID "${nodeId}" not found in this run`,
        availableNodeIds: nodeList.map(n => n.id)
      });
    }

    console.log(`[/gobynodeid/:runID/:nodeId] Found target node: ${nodeId}`);

    // Queue this node as the next node to execute
    try {
      const ok = runManager.receiveClientEvent(runID, 'go_to_node', { nodeId });
      if (!ok) {
        return res.status(500).json({ success: false, error: 'Failed to queue node, run may not be running' });
      }
      return res.json({ success: true, runID, nodeId, message: 'Queued jump to node' });
    } catch (innerErr) {
      console.error('[/gobynodeid/:runID/:nodeId] receiveClientEvent failed:', innerErr);
      return res.status(500).json({ success: false, error: String(innerErr) });
    }
  } catch (err) {
    console.error('[/gobynodeid/:runID/:nodeId] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

//http://localhost:3001/go/test-run/Start%20Node
app.get('/go/:runID/:nodeLabel', async (req, res) => {
  console.log("------------------------------------------");
  console.log("--------GO NODE BY LABEL(endpoint)--------");
  console.log(`----runID  ${req.params.runID}----`);
  console.log(`----nodeLabel ${req.params.nodeLabel}----`);
  console.log("------------------------------------------");

  try {
    const { runID, nodeLabel } = req.params;
    if (!runID || !nodeLabel) {
      return res.status(400).json({ success: false, error: 'runID and nodeLabel required' });
    }

    // Get the run object
    const run = runManager.getRun(runID);
    if (!run) {
      return res.status(404).json({ success: false, error: 'run not found' });
    }


    // Find the node with matching label in the run's node list
    const nodeList = Array.isArray(run.nodes) ? run.nodes : [];
    let targetNode = null;
    let targetNodeId = null;
    
    console.log("nodeList:", nodeList.length);

    for (const node of nodeList) {
      const nodeName = node?.data?.label || node?.label || node?.data?.labelText;
      const runNodeLabel = node?.data?.nodeLabel;
      console.log(`Checking node name "${nodeName}" label "${runNodeLabel}" against target label "${nodeLabel}"`);
      if (runNodeLabel && String(runNodeLabel).toLowerCase() === String(nodeLabel).toLowerCase()) {
        targetNode = node;
        targetNodeId = node?.id;
        console.log('label found', { nodeId: targetNodeId, nodeLabel });
        break;
      }
    }

    if (!targetNode || !targetNodeId) {
      return res.status(404).json({
        success: false,
        error: `Node with label "${nodeLabel}" not found in this run`,
        availableLabels: nodeList.map(n => n?.data?.label || n?.label || n?.data?.labelText || n?.id)
      });
    }

    console.log(`[/go/:runID/:nodeLabel] Found target node: ${targetNodeId} (label: ${nodeLabel})`);

    // Queue this node as the next node to execute
    try {
      const ok = runManager.receiveClientEvent(runID, 'go_to_node', { nodeId: targetNodeId, nodeLabel });
      if (!ok) {
        return res.status(500).json({ success: false, error: 'Failed to queue node, run may not be running' });
      }
      return res.json({ success: true, runID, nodeId: targetNodeId, nodeLabel, message: 'Queued jump to node' });
    } catch (innerErr) {
      console.error('[/go/:runID/:nodeLabel] receiveClientEvent failed:', innerErr);
      return res.status(500).json({ success: false, error: String(innerErr) });
    }
  } catch (err) {
    console.error('[/go/:runID/:nodeLabel] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

//http://localhost:3001/next/test-run
app.get('/next/:runID', async (req, res) => {
  console.log("-----------------------------------");
  console.log("--------NEXT NODE(endpoint)--------");
  console.log(`----/next/  ${req.params.runID}----`);
  console.log("-----------------------------------");
    try {
      const { runID } = req.params;
      if (!runID) return res.status(400).json({ success: false, error: 'runID required' });

      // Forward 'next' control to RunManager
      try {
        const ok = runManager.receiveClientEvent(runID, 'next', {});
        if (!ok) return res.status(404).json({ success: false, error: 'run not found or not running' });
        return res.json({ success: true, runID });
      } catch (e) {
        console.error('[/next/:runID] Forward to runManager failed:', e);
        return res.status(500).json({ success: false, error: String(e) });
      }
    } catch (err) {
      console.error('[/next/:runID] Error:', err);
      res.status(500).json({ success: false, error: String(err) });
    }

  });


app.get('/run/:workflowID', async (req, res) => {
  try {

    console.log(`[Run Endpoint] /run/${req.params.workflowID} HOLD`);
    return false;

    const { workflowID } = req.params;
    //console.log(`/run/ ${workflowID} requested resume`);

    // Resolve projectId
    let projectId = workflowID;
    const result = projectManager.findWorkflowByName(workflowID);
    //console.log("[/run/:workflowID] findWorkflowByName result:", result, "workflowID", workflowID);
    if (result) projectId = result.projectId;

    const project = projectManager.getProject(projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Workflow not found' });
    }

    let nextNodeId = null;
    if (project.jumpID) {
      nextNodeId = project.jumpID;
      delete project.jumpID;  // Clear it after use
    } else {
      // Get current node
      const activeNodeId = project.activeNodeId;
      if (!activeNodeId) {
        return res.json({ success: false, error: 'No active node' });
      }

      // Find next node via edges
      const edges = project.edges || [];
      const outgoing = edges.filter(e => String(e.source || e.from) === String(activeNodeId));

      if (outgoing.length === 0) {
        return res.json({ success: true, message: 'No next node, workflow complete' });
      }

      nextNodeId = outgoing[0].target || outgoing[0].to;
    }

    // Jump to next node
    await projectManager.forceJumpToNode(projectId, String(nextNodeId));

    res.json({ success: true, projectId, nextNodeId, message: 'Jumped to next node' });
  } catch (error) {
    console.error('[/run/:workflowID] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Load persisted runs_store.json (if present) before initializing runtime
(async () => {
  try {
    console.log("------------------- ----------------- -------------------");
    console.log("------------------- ----------------- -------------------");
    console.log("------------------- START NODE SERVER -------------------");
    console.log("------------------- ----------------- -------------------");
    console.log("------------------- ----------------- -------------------");
    const runsPath = path.join(process.cwd(), 'runs_store.json');
    await projectManager.loadFromDisk(runsPath);
    
    // NOW load runs from runManager after projectManager has its data
    runManager._loadFromDisk();
  
    // Load persisted workflows from sqlite `rules.workflow_object` if present
    try {
      console.log('[Startup] Loading workflows from sqlite `rules.workflow_object`');
      const rows = db.prepare('SELECT id, name, workflow_object, category_id FROM rules').all();
      let loaded = 0;
      for (const r of rows || []) {
        try {
          if (!r || !r.id) continue;
          let parsed = null;
          if (r.workflow_object) {
            try { parsed = typeof r.workflow_object === 'string' ? JSON.parse(r.workflow_object) : r.workflow_object; } catch (e) { parsed = null; }
          }
          const nodes = (parsed && Array.isArray(parsed.nodes)) ? parsed.nodes : [];
          const edges = (parsed && Array.isArray(parsed.edges)) ? parsed.edges : [];
          const apis = (parsed && Array.isArray(parsed.apis)) ? parsed.apis : [];
          const stepDelay = (parsed && parsed.stepDelay) ? parsed.stepDelay : 1000;

          projectManager.loadProject(r.id, nodes, edges, apis, stepDelay, r.category_id);
          // propagate stored rule name if available
          if (r.name) {
            const proj = projectManager.getProject(r.id);
            if (proj) proj.name = r.name;
          }
          loaded += 1;
        } catch (e) {
          console.warn('[Startup] Failed to load workflow from row', r && r.id, e);
        }
      }
      console.log(`[Startup] Loaded ${loaded} workflows from sqlite (rules.workflow_object)`);
    } catch (e) {
      console.warn('[Startup] Error loading workflows from sqlite', e);
    }
  } catch (e) {
    console.warn('Error loading runs_store.json at startup', e);
  }

  // Initialize project manager with Socket.IO after loading
  projectManager.init(io);

  // Save on graceful shutdown
  const saveAndExit = async () => {
    try {
      const runsPath = path.join(process.cwd(), 'runs_store.json');
      await projectManager.saveToDisk(runsPath);
      console.log('Saved runs_store.json on shutdown');
    } catch (e) {
      console.error('Error saving runs_store.json on shutdown', e);
    }
    process.exit(0);
  };

  process.on('SIGINT', saveAndExit);
  process.on('SIGTERM', saveAndExit);
})();

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

// ------------------ External APIs (server-mediated) ----------------------
// Add a new external API (server will persist to Firestore)
app.post('/api/external-apis', async (req, res) => {
  try {
    if (!firestore) return res.status(500).json({ error: 'firebase_not_configured' });
    const { name, url, tags = [], function: fn = '', cssStyle = '', description = '', functionInput = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name_required' });
    const docRef = await addDoc(collection(firestore, 'VariableManager-apis'), {
      name,
      url,
      description: description || '',
      tags: Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean),
      function: fn || '',
      functionInput: functionInput !== undefined ? functionInput : '',
      metadata: { cssStyle: cssStyle || '' },
      lastPrompt: '',
      createdAt: new Date(),
    });
    const out = { id: docRef.id, name, url, description: description || '', tags: Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean), function: fn || '', functionInput: functionInput !== undefined ? functionInput : '', metadata: { cssStyle: cssStyle || '' }, lastPrompt: '', createdAt: new Date() };
    // notify project manager / running runners (if projectId provided)
    try {
      const projectId = req.body?.projectId;
      if (projectId) {
        const proj = projectManager.getProject(projectId);
        if (proj) {
          proj.apis = proj.apis ? (proj.apis.concat([out])) : [out];
          projectManager.broadcastToProject(projectId, 'workflow_updated', { projectId, apisCount: proj.apis.length, apis: proj.apis });
        }
      }
    } catch (e) {}
    res.json(out);
  } catch (err) { console.error('POST /api/external-apis error', err); res.status(500).json({ error: String(err) }); }
});

// Update API metadata
app.put('/api/external-apis/:id', async (req, res) => {
  console.log('Received PUT /api/external-apis/:id with id=', req.params.id, 'body=', req.body);
  try {
    console.log('PUT /api/external-apis/:id called with id=', req.params.id, 'bodyKeys=', Object.keys(req.body || {}));
    if (!firestore){
      console.log('Firestore not configured, cannot update API metadata');
      return res.status(500).json({ error: 'firebase_not_configured' });
    }
    const id = req.params.id;
    console.log('Step 1: Extracting projectId and metadata from body');
    const { projectId, ...metadata } = req.body || {};
    const metaFromBody = (metadata.metadata && typeof metadata.metadata === 'object') ? metadata.metadata : {};
    console.log('Step 2: projectId=', projectId, 'metadata keys=', Object.keys(metadata));
    const apiRef = doc(firestore, 'VariableManager-apis', id);
    console.log('Step 3: Created apiRef');
    const updateData = {};
    // Only include fields that should be persisted to Firestore
    if (metadata.name !== undefined) updateData.name = metadata.name;
    if (metadata.url !== undefined) updateData.url = metadata.url;
    if (metadata.description !== undefined) updateData.description = metadata.description;
    if (metadata['function'] !== undefined) updateData.function = metadata['function'];
    if (metadata.functionInput !== undefined) updateData.functionInput = metadata.functionInput;
    if (metadata.tags !== undefined) updateData.tags = Array.isArray(metadata.tags) ? metadata.tags : String(metadata.tags).split(',').map(t => t.trim()).filter(Boolean);
    const metaImage = metadata.image !== undefined ? metadata.image : metaFromBody.image;
    const metaSize = metadata.size !== undefined ? metadata.size : metaFromBody.size;
    const metaCss = metadata.cssStyle !== undefined ? metadata.cssStyle : metaFromBody.cssStyle;
    if (metaImage !== undefined) updateData['metadata.image'] = metaImage;
    if (metaSize !== undefined) updateData['metadata.size'] = metaSize;
    if (metaCss !== undefined) updateData['metadata.cssStyle'] = metaCss;
    updateData.updatedAt = serverTimestamp();
    console.log('Step 4: Built updateData before filtering:', JSON.stringify(updateData, null, 2));
    Object.keys(updateData).forEach(k => { if (updateData[k] === undefined) delete updateData[k]; });
    console.log('Step 5: Final updateData for Firestore:', JSON.stringify(updateData, null, 2));
    try {
      console.log('Step 6: About to call updateDoc');
      await updateDoc(apiRef, updateData);
      console.log(`Step 7: Updated API ${id} in Firestore successfully`);
    } catch (innerErr) {
      console.error('Firestore updateDoc failed for API id=', id, 'Error:', innerErr);
      return res.status(500).json({ error: 'firestore_update_failed', detail: String(innerErr && innerErr.message ? innerErr.message : innerErr) });
    }
    // notify running runners via projectManager
    try {
      if (projectId) {
        const proj = projectManager.getProject(projectId);
        if (proj) {
          // update apis array in-memory if present
          proj.apis = proj.apis ? proj.apis.map(a => {
            if (String(a.id) !== String(id)) return a;
            const mergedMetadata = { ...(a.metadata || {}) };
            if (metaFromBody.image !== undefined) mergedMetadata.image = metaFromBody.image;
            if (metaFromBody.size !== undefined) mergedMetadata.size = metaFromBody.size;
            if (metaFromBody.cssStyle !== undefined) mergedMetadata.cssStyle = metaFromBody.cssStyle;
            if (metadata.image !== undefined) mergedMetadata.image = metadata.image;
            if (metadata.size !== undefined) mergedMetadata.size = metadata.size;
            if (metadata.cssStyle !== undefined) mergedMetadata.cssStyle = metadata.cssStyle;
            return { ...a, ...metadata, metadata: mergedMetadata };
          }) : proj.apis;
          projectManager.broadcastToProject(projectId, 'workflow_updated', { projectId, apisCount: (proj.apis || []).length, apis: proj.apis });
        }
      } else {
        // No projectId provided — update any loaded projects that include this api id
        for (const [pid, proj] of projectManager.projects.entries()) {
          try {
            if (proj && Array.isArray(proj.apis) && proj.apis.find(a => String(a.id) === String(id))) {
              proj.apis = proj.apis.map(a => {
                if (String(a.id) !== String(id)) return a;
                const mergedMetadata = { ...(a.metadata || {}) };
                if (metaFromBody.image !== undefined) mergedMetadata.image = metaFromBody.image;
                if (metaFromBody.size !== undefined) mergedMetadata.size = metaFromBody.size;
                if (metaFromBody.cssStyle !== undefined) mergedMetadata.cssStyle = metaFromBody.cssStyle;
                if (metadata.image !== undefined) mergedMetadata.image = metadata.image;
                if (metadata.size !== undefined) mergedMetadata.size = metadata.size;
                if (metadata.cssStyle !== undefined) mergedMetadata.cssStyle = metadata.cssStyle;
                return { ...a, ...metadata, metadata: mergedMetadata };
              });
              projectManager.broadcastToProject(pid, 'workflow_updated', { projectId: pid, apisCount: proj.apis.length, apis: proj.apis });
              console.log(`Notified project ${pid} of API ${id} update`);
            }
          } catch (inner) {
            console.error('Error updating project apis for pid=', pid, inner);
          }
        }
      }
    } catch (e) { console.error('projectManager notify failed', e); }
    res.json({ success: true });
  } catch (err) {
    console.log('PUT ERROR /api/external-apis/:id outer catch error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Delete API
app.delete('/api/external-apis/:id', async (req, res) => {
  try {
    if (!firestore) return res.status(500).json({ error: 'firebase_not_configured' });
    const id = req.params.id;
    await deleteDoc(doc(firestore, 'VariableManager-apis', id));
    try {
      const projectId = req.body?.projectId;
      if (projectId) {
        const proj = projectManager.getProject(projectId);
        if (proj) {
          proj.apis = proj.apis ? proj.apis.filter(a => String(a.id) !== String(id)) : proj.apis;
          projectManager.broadcastToProject(projectId, 'workflow_updated', { projectId, apisCount: (proj.apis || []).length, apis: proj.apis });
        }
      }
    } catch (e) {}
    res.json({ success: true });
  } catch (err) { console.error('DELETE /api/external-apis/:id error', err); res.status(500).json({ error: String(err) }); }
});

// Save API prompt (record last prompt)
app.post('/api/external-apis/:id/prompt', async (req, res) => {
  try {
    console.log("firestore=", firestore);
    if (!firestore) return res.status(500).json({ error: 'firebase_not_configured' });
    const id = req.params.id;
    const prompt = req.body?.prompt || '';
    const apiRef = doc(firestore, 'VariableManager-apis', id);
    await updateDoc(apiRef, { lastPrompt: prompt, updatedAt: serverTimestamp() });
    res.json({ success: true });
  } catch (err) { console.error('POST /api/external-apis/:id/prompt error', err); res.status(500).json({ error: String(err) }); }
});

// ------------------ Project State API (debug) --------------------------
// Return in-memory project state (nodes, edges, apis, storeVars, status)
app.get('/api/projects/:projectId/state', (req, res) => {
  try {
    const projectId = req.params.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId_required' });
    const project = projectManager.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'not_found' });
    // Return a shallow copy to avoid accidental mutation by callers
    const out = {
      projectId,
      nodes: project.nodes || [],
      edges: project.edges || [],
      apis: project.apis || [],
      storeVars: project.storeVars || {},
      status: project.status || 'stopped',
      activeNodeId: project.activeNodeId || null,
      activeEdgeId: project.activeEdgeId || null,
      stepDelay: project.stepDelay || 1000
    };
    console.log(`[API] GET /api/projects/${projectId}/state -> returning project state`);
    res.json(out);
  } catch (err) {
    console.error('GET /api/projects/:projectId/state error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err) });
  }
});

// ------------------ Global Store API (debug) --------------------------
// Return the single-layer global store object maintained by ProjectManager
app.get('/api/global-store', (req, res) => {
  try {
    const out = projectManager.getGlobalVars();
    res.json({ test: "OK", globalStoreVars: out });
  } catch (err) {
    console.error('GET /api/global-store error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err) });
  }
});

// POST to set a global var for testing: { key: 'name', value: any }
app.post('/api/global-store', (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key_required' });
    projectManager.setGlobalVar(key, value);
    
    // Broadcast update to all connected Socket.io clients
    io.emit('global_store_vars_update', {
      globalStoreVars: projectManager.getGlobalVars()
    });
    
    res.json({ success: true, key, value });
  } catch (err) {
    console.error('POST /api/global-store error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err) });
  }
});

// POST generate system prompt server-side
app.post('/api/generate-system-prompt', async (req, res) => {
  console.log('Received POST /api/generate-system-prompt with body:', req.body.userPrompt, req.body.functionsList.length);
  try {
    const { userPrompt, functionsList, apis } = req.body || {};
    const result = generateSystemPrompt({ userPrompt, functionsList, apis, globalStoreVars: projectManager.getGlobalVars() });



    // ============================================================================
    // 02 28 REQUEST NODES AND EDGES FROM xAI
    // ============================================================================
    // This function calls xAI to generate nodes and edges from the user prompt
    // and system prompt. The xAI_ENDPOINT, XAI_API_KEY, and XAI_MODEL should be
    // configured in .env (e.g., XAI_ENDPOINT=https://api.x.ai/v1/chat/completions)
    //
    // To enable this: uncomment the code below and ensure .env is configured
    // ============================================================================
    
    /* UNCOMMENT TO ENABLE XAI INTEGRATION:
    try {
      const { nodesResult, edgesResult } = await requestNodesAndEdgesFromXai({
        systemPrompt: result.systemPrompt,
        userPrompt: userPrompt,
        xaiEndpoint: process.env.XAI_ENDPOINT,
        xaiApiKey: process.env.XAI_API_KEY,
        xaiModel: process.env.XAI_MODEL
      });
      
      // Merge nodes and edges into result
      result.nodes = nodesResult;
      result.edges = edgesResult;
      
      console.log(`[xAI] Successfully generated ${nodesResult.length} nodes and ${edgesResult.length} edges`);
    } catch (xaiErr) {
      console.error('[xAI] Error generating nodes/edges:', xaiErr.message);
      // Continue without xAI nodes/edges if request fails
      result.nodes = [];
      result.edges = [];
    }
    */

    // ============================================================================
    // REQUEST NODES AND EDGES FROM OLLAMA (LOCAL LLM)
    // ============================================================================
    // This function calls Ollama to generate nodes and edges from the user prompt
    // and system prompt. OLLAMA_URL and OLLAMA_MODEL should be configured in .env
    // (e.g., OLLAMA_URL=http://localhost:11434/api/chat, OLLAMA_MODEL=qwen3:8b)
    //
    // Ollama must be running locally before enabling this.
    // To enable this: uncomment the code below and ensure Ollama is running
    // ============================================================================
    
    try {
      const { ollamaResult } = await requestFromOllama({
        systemPrompt: result.systemPrompt,
        userPrompt: userPrompt,
        ollamaUrl: process.env.OLLAMA_URL,
        ollamaModel: process.env.OLLAMA_MODEL
      });
      
      // Return the complete Ollama result
      result.ollamaResult = ollamaResult;
      result.aimodel = process.env.OLLAMA_MODEL || 'qwen3:8b';
      
      // Extract nodes and edges from parsed workflow if available
      if (ollamaResult?.parsedWorkflow) {
        result.nodes = Array.isArray(ollamaResult.parsedWorkflow.nodes) ? ollamaResult.parsedWorkflow.nodes : [];
        result.edges = Array.isArray(ollamaResult.parsedWorkflow.edges) ? ollamaResult.parsedWorkflow.edges : [];
        console.log(`[Ollama] Successfully parsed ${result.nodes.length} nodes and ${result.edges.length} edges`);
      } else {
        result.nodes = [];
        result.edges = [];
        console.log('[Ollama] No parsed workflow available, but raw Ollama result available');
      }
      
    } catch (ollamaErr) {
      console.error('[Ollama] Error requesting from Ollama:', ollamaErr.message);
      // Continue without Ollama result if request fails
      result.ollamaResult = null;
      result.nodes = [];
      result.edges = [];
    }

    console.log('Generated system prompt result:', result);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('POST /api/generate-system-prompt error', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Receive workflow template for a given workflow id
// POST /getworkflowtemplate/:workflowid
// body: { workflowTemplate: { nodes: [], edges: [] } }
app.post('/getworkflowtemplate/:workflowid', (req, res) => {
  try {
    const workflowId = req.params.workflowid;
    const payload = req.body || {};
    const workflowTemplate = payload.workflowTemplate || payload.workflow_template || null;

    console.log(`[GETWORKFLOWTEMPLATE] Received template for workflowId=${workflowId}. template present: ${workflowTemplate ? 'yes' : 'no'}`);

    // Basic validation: ensure it's an object (but we won't persist)
    if (!workflowTemplate || typeof workflowTemplate !== 'object') {
      return res.status(400).json({ success: false, error: 'workflowTemplate_required' });
    }

    // For now we only acknowledge receipt. Optionally log size/summary.
    const nodesCount = Array.isArray(workflowTemplate.nodes) ? workflowTemplate.nodes.length : 0;
    const edgesCount = Array.isArray(workflowTemplate.edges) ? workflowTemplate.edges.length : 0;
    console.log(`[GETWORKFLOWTEMPLATE] workflowId=${workflowId} nodes=${nodesCount} edges=${edgesCount}`);

    // Respond with acknowledgement
    return res.json({ success: true, workflowId, received: true, nodes: nodesCount, edges: edgesCount });
  } catch (err) {
    console.error('POST /getworkflowtemplate/:workflowid error', err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

  // ------------------ Get Components (APIs) ----------------------------------
  // Returns all API/component documents from Firestore collection `VariableManager-apis`
  //http://localhost:3001/getcomponents or /getcomponents/:tags
  // Example: /getcomponents/action,object
  async function handleGetComponents(req, res) {
    console.log("------------ GET /getcomponents ----------------");
    try {
      if (!firestore) return res.status(500).json({ error: 'firebase_not_configured' });
      const q = collection(firestore, 'VariableManager-apis');
      const snap = await getDocs(q);
      const items = [];
      snap.forEach((d) => {
        try {
          const data = d.data() || {};
          items.push({
            id: d.id,
            name: data.name || '',
            url: data.url || '',
            description: data.description || '',
            tags: Array.isArray(data.tags) ? data.tags : (data.tags ? String(data.tags).split(',').map(t => t.trim()).filter(Boolean) : []),
            function: data.function || '',
            functionInput: data.functionInput !== undefined ? data.functionInput : '',
            metadata: data.metadata || {},
            lastPrompt: data.lastPrompt || '',
            createdAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : null
          });
        } catch (e) {
          // ignore malformed doc
        }
      });

      // Parse tags from param or query
      const tagsParam = (req.params && req.params.tags) ? req.params.tags : (req.query.tags || '');
      const requestedTags = (typeof tagsParam === 'string' && tagsParam.trim()) ? tagsParam.split(/[|,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean) : [];

      let filtered = items;
      if (requestedTags.length) {
        filtered = items.filter(it => {
          const itTags = (Array.isArray(it.tags) ? it.tags : []).map(t => String(t).toLowerCase());
          return requestedTags.some(rt => itTags.includes(rt));
        });
      }

      res.json({ success: true, apis: filtered, requestedTags });
    } catch (err) {
      console.error('GET /getcomponents error', err && err.stack ? err.stack : err);
      res.status(500).json({ success: false, error: String(err) });
    }
  }

  app.get('/getcomponents', handleGetComponents);
  app.get('/getcomponents/:tags', handleGetComponents);

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
  console.log(`[Socket] ✅ Client connected: ${socket.id}`);

  // Register client with ProjectManager
  projectManager.registerClient(socket.id, socket);
  console.log(`[Socket] 📝 Client ${socket.id} registered - initial projectcategoryId: UNSET`);

  // Send all project statuses immediately on connect
  const allStatuses = projectManager.getAllProjectStatuses();
  socket.emit('all_project_statuses', allStatuses);
  socket.emit('sendAllWorkflowStatus', projectManager.getAllWorkflowStatus());
  //console.log(`[Socket] Sent all project statuses to ${socket.id}:`, allStatuses);

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

  // Client wants to watch a category for clientJS broadcasts
  socket.on('watch_category', (data) => {
    const { categoryId } = data || {};
    if (!categoryId) return;
    console.log(`[Socket] Client ${socket.id} wants to watch category ${categoryId}`);
    projectManager.watchCategory(socket.id, categoryId);
  });

  // Client wants to unwatch a category
  socket.on('unwatch_category', (data) => {
    const { categoryId } = data || {};
    if (!categoryId) return;
    console.log(`[Socket] Client ${socket.id} wants to unwatch category ${categoryId}`);
    projectManager.unwatchCategory(socket.id, categoryId);
  });

  // Client updates its selected project category
  socket.on('set_project_category', (data) => {
    const { projectcategoryId } = data || {};
    if (!projectcategoryId) {
      console.warn(`[Socket] ⚠️ Client ${socket.id} sent empty projectcategoryId`);
      return;
    }
    console.log(`[Socket] 📨 Received 'set_project_category' from Client ${socket.id} with projectcategoryId: ${projectcategoryId}`);
    projectManager.setClientProjectCategory(socket.id, projectcategoryId);
  });

  // Client requests updating project metadata (name / category)
  socket.on('update_project_meta', (data) => {
    try {
      const { projectId, name, categoryId } = data || {};
      if (!projectId) return;
      console.log(`[Socket] Received update_project_meta for ${projectId}: name=${name} categoryId=${categoryId}`);
      // Update in-memory project metadata and broadcast
      projectManager.updateProjectState(projectId, { name: name || undefined, categoryId: categoryId || undefined });
      // Persisting to DB is handled by /api/rules POST which client already called
    } catch (e) {
      console.warn('Failed to handle update_project_meta socket event', e);
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

  // Client adds a single edge to workflow
  socket.on('add_edge', (data) => {
    try {
      const { projectId, edge } = data || {};
      if (!projectId || !edge) return;
      console.log(`[Socket] Client ${socket.id} requested add_edge for ${projectId}:`, edge && edge.id ? edge.id : '(no-id)');
      const added = projectManager.addProjectEdge(projectId, edge);
      socket.emit('add_edge_result', { success: !!added, projectId, edge: added || null });
    } catch (e) {
      console.error('add_edge handler error', e);
      socket.emit('add_edge_result', { success: false, error: String(e) });
    }
  });

  // Client requests deletion of selected nodes/edges
  socket.on('delete_selected_items', (data) => {
    try {
      const { projectId, selectedIds } = data || {};
      if (!projectId || !Array.isArray(selectedIds) || !selectedIds.length) {
        socket.emit('delete_selected_result', { success: false, error: 'Missing projectId or selectedIds' });
        return;
      }

      console.log(`[Socket] Client ${socket.id} requested delete_selected_items for ${projectId}:`, selectedIds);
      const result = projectManager.deleteSelectedItems(projectId, selectedIds);
      
      if (result) {
        projectManager.broadcastToProject(projectId, 'nodes_edges_deleted', {
          projectId,
          removedNodeIds: result.removedNodeIds,
          removedEdgeIds: result.removedEdgeIds,
          orphanedEdgeCount: result.orphanedEdgeCount,
          remainingNodes: result.remainingNodes,
          remainingEdges: result.remainingEdges
        });
        
        socket.emit('delete_selected_result', { success: true, projectId });
      } else {
        socket.emit('delete_selected_result', { success: false, error: 'Project not found' });
      }
    } catch (e) {
      console.error('delete_selected_items handler error', e);
      socket.emit('delete_selected_result', { success: false, error: String(e) });
    }
  });

  // Client updates a single node's properties
  socket.on('update_node', async (data) => {
    try {
      const { projectId, nodeId, updates } = data || {};
      if (!projectId || !nodeId) return;
      console.log(`[Socket] Client ${socket.id} requested update_node for ${projectId}/${nodeId}:`, updates);
      const updated = projectManager.updateNode(projectId, nodeId, updates);
      socket.emit('update_node_result', { success: !!updated, projectId, nodeId, updates });
      
      // Also save the updated workflow to Firebase immediately
      if (updated && firestore) {
        try {
          const workflow = projectManager.getProjectWorkflow(projectId);
          if (workflow) {
            console.log(`[Socket] Auto-saving updated workflow ${projectId} to Firebase after node update`);
            const rulesRef = collection(firestore, 'rules');
            const docRef = doc(rulesRef, projectId);
            await setDoc(docRef, {
              workflowObject: JSON.stringify(workflow),
              updatedAt: serverTimestamp()
            }, { merge: true });
            console.log(`[Socket] ✓ Auto-saved workflow ${projectId} to Firebase`);
          }
        } catch (saveErr) {
          console.warn(`[Socket] Failed to auto-save workflow ${projectId} to Firebase:`, saveErr);
          // Don't fail the whole operation if Firebase save fails
        }
      }
    } catch (e) {
      console.error('update_node handler error', e);
      socket.emit('update_node_result', { success: false, error: String(e) });
    }
  });

  // Client updates workflow style only (e.g. autolayout positions)
  socket.on('update_workflow_style', (data) => {
    const { projectId, workflowId, nodes, edges } = data || {};
    const targetWorkflowId = workflowId || projectId;
    if (!targetWorkflowId) return;
    const updated = projectManager.updateWorkflowStyle(targetWorkflowId, nodes, edges);
    socket.emit('workflow_style_updated', {
      workflowId: targetWorkflowId,
      projectId: targetWorkflowId,
      success: !!updated
    });
  });

  // Client requests workflow (nodes/edges)
  socket.on('get_project_workflow', (data) => {
    const { projectId } = data || {};
    if (!projectId) return;

    console.log(`[Socket] Client ${socket.id} requested workflow for ${projectId}`);
    const workflow = projectManager.getProjectWorkflow(projectId);
    if (!workflow) {
      console.log(`[Socket] project_workflow for ${projectId} not found; sending notFound to ${socket.id}`);
      socket.emit('project_workflow_response', { projectId, workflow: null, notFound: true });
    } else {
      console.log(`[Socket] Sending project_workflow_response to ${socket.id} for ${projectId}: nodes=${(workflow.nodes||[]).length}, edges=${(workflow.edges||[]).length}`);
      socket.emit('project_workflow_response', { projectId, workflow });
    }
  });

  // New workflow management API over socket
  socket.on('get_all_workflow_status', () => {
    socket.emit('sendAllWorkflowStatus', projectManager.getAllWorkflowStatus());
  });

  socket.on('get_workflow_data', (data) => {
    const workflowId = data?.workflowId || data?.projectId;
    if (!workflowId) return;
    console.log(`[Socket] Client ${socket.id} requested workflow DATA for ${workflowId}`);
    const workflow = projectManager.getWorkflowData(workflowId);
    if (!workflow) {
      console.log(`[Socket] workflow DATA for ${workflowId} not found; responding notFound to ${socket.id}`);
      socket.emit('workflow_data_response', { workflowId, projectId: workflowId, workflow: null, notFound: true });
    } else {
      console.log(`[Socket] Sending workflow_data_response to ${socket.id} for ${workflowId}: nodes=${(workflow.nodes||[]).length}, edges=${(workflow.edges||[]).length}`);
      socket.emit('workflow_data_response', { workflowId, projectId: workflowId, workflow });
    }
  });

  // Client requests to save workflow to Firebase from server memory
  socket.on('save_workflow_to_firebase', async (data) => {
    const { projectId, ruleData } = data || {};
    if (!projectId) {
      socket.emit('save_workflow_result', { success: false, error: 'projectId required' });
      return;
    }

    try {
      console.log(`[Socket] Client ${socket.id} requested save workflow ${projectId} to Firebase`);
      
      // Get workflow from server memory
      const workflow = projectManager.getProjectWorkflow(projectId);
      if (!workflow) {
        socket.emit('save_workflow_result', { success: false, error: 'Workflow not found in server memory' });
        return;
      }

        console.log(`[Socket] → Saving workflow with ${workflow.nodes?.length || 0} nodes, ${workflow.edges?.length || 0} edges`);

      // Check if firestore is available
      if (!firestore) {
        socket.emit('save_workflow_result', { success: false, error: 'Firebase not configured on server' });
        return;
      }

      // Prepare the document to save
      const docData = {
        ...ruleData,
        workflowObject: JSON.stringify(workflow),
        updatedAt: serverTimestamp()
      };

      // Save to Firestore (create if missing, update if existing)
      const rulesRef = collection(firestore, 'rules');
      const docRef = doc(rulesRef, projectId);
      await setDoc(docRef, docData, { merge: true });

      console.log(`[Socket] ✓ Saved workflow ${projectId} to Firebase`);
      // If the client provided ruleData.name, propagate it into server memory
      try {
        if (ruleData && ruleData.name) {
          const proj = projectManager.getProject(projectId);
          if (proj) {
            proj.name = ruleData.name;
            console.log(`[Socket] Updated in-memory project name for ${projectId} -> ${ruleData.name}`);
            // Also broadcast updated workflow statuses to clients so UI gets new names
            projectManager.sendAllWorkflowStatus();
          }
        }
      } catch (e) { console.warn('[Socket] Failed to update in-memory project name', e); }
      socket.emit('save_workflow_result', { success: true, projectId });
      
    } catch (error) {
      console.error(`[Socket] ✗ Failed to save workflow ${projectId} to Firebase:`, error);
      socket.emit('save_workflow_result', { success: false, error: error.message });
    }
  });

  // Client updates global store variable
  socket.on('set_global_var', (data) => {
    const { key, value } = data || {};
    if (!key) {
      socket.emit('set_global_var_result', { success: false, error: 'key required' });
      return;
    }

    try {
      console.log(`[Socket] Client ${socket.id} set global var: ${key} =`, value);
      projectManager.setGlobalVar(key, value);
      
      // Broadcast to all clients and update them
      io.emit('global_store_vars_update', {
        globalStoreVars: projectManager.getGlobalVars()
      });
      
      socket.emit('set_global_var_result', { success: true, key, value });
    } catch (error) {
      console.error(`[Socket] Failed to set global var ${key}:`, error);
      socket.emit('set_global_var_result', { success: false, error: error.message });
    }
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
    console.log("---------------------------------");
    console.log("--------NEXT NODE(socket)--------");
    console.log("---------------------------------");
    try {
      const { runId, event, payload } = data || {};
      if (!runId || !event) return socket.emit('run_control_ack', { ok: false, message: 'runId and event required' });

      // Log receipt for debugging: print runId, event and payload
      try {
        console.log(`[Socket] 🛠 Received 'run.control' from ${socket.id}: runId=${runId}, event=${event}, payload=${JSON.stringify(payload)}`);
      } catch (e) {
        console.log(`[Socket] 🛠 Received 'run.control' from ${socket.id}: runId=${runId}, event=${event} (payload stringify failed)`);
      }

      // Print workflow status with current position
      const run = runManager.getRun(runId);
      if (run && run.nodes) {
        console.log(`\n========== WORKFLOW STATUS ==========`);
        //console.log(run);
        console.log(`RunID: ${runId}`);
        console.log(`Status: ${run.status}`);
        console.log(`Nodes:`);
        run.nodes.forEach((node, index) => {
          //console.log(`  node[${index}] metadata:`, node.metadata);
          const marker = node.id === run.currentNodeId ? ' <--- here' : '';
          console.log(`  node[${index}]: ${node.metadata.apiName} ${marker}`);
        });
        console.log(`====================================\n`);
      } else if (run) {
        console.log(`\n[RunControl] RunID: ${runId} - Status: ${run.status} (nodes not available for running status)`);
      } else {
        console.log(`\n[RunControl] RunID: ${runId} - Not found`);
      }

      // Print global vars
      const globalVars = projectManager.getGlobalVars();
      console.log(`=========== GLOBAL VARS ============`);
      if (Object.keys(globalVars).length === 0) {
        console.log(`(no global vars)`);
      } else {
        Object.entries(globalVars).forEach(([key, value]) => {
          console.log(`${key} = ${JSON.stringify(value)}`);
        });
      }
      console.log(`====================================\n`);

      const ok = runManager.receiveClientEvent(runId, event, payload);
      socket.emit('run_control_ack', { ok });
    } catch (e) { socket.emit('run_control_ack', { ok: false, message: String(e) }); }
  });

  // Allow starting a run via socket (convenience)
  socket.on('run.start', (data) => {
    try {
      const { projectId, workflowId, nodes, edges, apis, options } = data || {};
      if (!projectId || !workflowId) return socket.emit('run_error', { message: 'projectId and workflowId required' });
      const run = runManager.startRun({ projectId, workflowId, nodes: nodes || [], edges: edges || [], apis: apis || [], options: options || {} });
      socket.emit('run.started', { runflowId: run.runId, runId: run.runId, projectId: run.projectId, workflowId: run.workflowId });
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
    console.log(`[Socket] ❌ Client disconnected: ${socket.id}`);
    projectManager.unregisterClient(socket.id);
  });
});

// Initialize run manager with io so it can broadcast to rooms
runManager.init(io);

// Initialize project manager with io and start execution loop
projectManager.init(io);

// ------------------ Run Control REST API --------------------------------
//http://localhost:3000/api/run/start
app.post('/api/run/start', (req, res) => {
  console.log('****************************************************************')
  console.log('************************ /api/run/start ************************');
  console.log('****************************************************************')
  try {
    const { projectId, workflowId, nodes, edges, apis, options } = req.body || {};
    if (!projectId || !workflowId) return res.status(400).json({ error: 'projectId and workflowId required' });
    const run = runManager.startRun({ projectId, workflowId, nodes: nodes || [], edges: edges || [], apis: apis || [], options: options || {} });
    res.json({ success: true, runflowId: run.runId, runId: run.runId, categoryId: run.categoryId });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});
/*
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
*/
app.get('/api/run/list', (req, res) => {
  try {
    const runflows = runManager.getAllRunflows();
    res.json({ runflows });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});
/*
// Delete a run (manual cleanup)
app.delete('/api/run/:runId', (req, res) => {
  try {
    const runId = req.params.runId;
    const ok = runManager.deleteRun(runId);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});
*/

app.get('/api/projects/statuses', (req, res) => {
  try {
    const statuses = projectManager.getAllProjectStatuses();
    res.json(statuses);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ------------------ Workflow Management API -----------------------------

app.get('/api/workflows/statuses', (req, res) => {
  try {
    res.json(projectManager.getAllWorkflowStatus());
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ------------------ Convenience endpoints for frontend projectSelect ---------
// Return all workflows (summary) for adding to projectSelect
app.get('/getworkflows/all', (req, res) => {
  try {
    const data = projectManager.getAllWorkflowStatus();
    res.json({ success: true, workflows: data });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Return workflows filtered by category id. Use 'all' to return everything.
app.get('/getworkflows/:category', (req, res) => {
  try {
    const category = req.params.category;
    let data = projectManager.getAllWorkflowStatus() || [];
    console.log(`[getworkflows] requested category='${category}' totalWorkflows=${data.length}`);

    if (category && category !== 'all') {
      const filtered = [];
      for (const wf of data) {
        try {
          // Try to read in-memory project metadata first
          const full = projectManager.getWorkflowData(wf.id) || projectManager.getProject(wf.id);
          let projCategory = full && (full.categoryId || full.category || full.category_id) ? (full.categoryId || full.category || full.category_id) : null;

          // Fallback: check rules table in DB for category_id
          if (!projCategory) {
            try {
              const row = db.prepare('SELECT category_id FROM rules WHERE id = ? LIMIT 1').get(wf.id);
              if (row && row.category_id) projCategory = row.category_id;
            } catch (e) { /* ignore DB lookup errors */ }
          }

          if (projCategory && String(projCategory) === String(category)) {
            filtered.push({ ...wf, categoryId: projCategory });
          }
        } catch (e) {
          // ignore per-item errors
        }
      }
      console.log(`[getworkflows] filtered workflows for category='${category}' => ${filtered.length}`);
      data = filtered;
    }

    // Ensure each workflow has categoryId for client convenience
    const out = (data || []).map(w => ({ ...w, categoryId: w.categoryId || (projectManager.getWorkflowData(w.id)?.categoryId) || null }));

    res.json({ success: true, workflows: out });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Return list of project categories (from rule_categories table or derived)
app.get('/getprojectcategorylist', (req, res) => {
  try {
    let rows = [];
    try {
      rows = db.prepare('SELECT id, name, description, created_at FROM rule_categories ORDER BY created_at DESC').all();
    } catch (e) {
      console.warn('[getprojectcategorylist] Failed to query rule_categories table, falling back to derived list');
    }

    if (!rows || rows.length === 0) {
      // derive distinct category ids from rules table
      try {
        const cats = db.prepare('SELECT DISTINCT category_id FROM rules WHERE category_id IS NOT NULL AND category_id != ""').all();
        rows = (cats || []).map((c) => ({ id: c.category_id, name: c.category_id }));
      } catch (e) {
        rows = [];
      }
    }

    res.json({ success: true, categories: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Create new run starting from a specific node label
// http://localhost:3001/runnew/:workflowId/:nodeLabelName
app.get('/runnew/:workflowId/:nodeLabelName', (req, res) => {
  console.log('****************************************************************')
  console.log('************************ RUN NEW by Node Label Name ************');
  console.log('workflowId =', req.params.workflowId, 'nodeLabelName =', req.params.nodeLabelName);
  console.log('****************************************************************')
  try {
    const { workflowId, nodeLabelName } = req.params;
    if (!workflowId || !nodeLabelName) {
      return res.status(400).json({ error: 'workflowId and nodeLabelName required' });
    }

    // Load workflow from projectManager memory
    const workflow = projectManager.getWorkflowData(workflowId);
    if (!workflow) {
      return res.status(404).json({ error: `Workflow "${workflowId}" not found in server memory` });
    }

    const nodes = workflow.nodes || [];
    const edges = workflow.edges || [];
    const apis = workflow.apis || [];
    const projectId = workflow.id || workflowId;
    const categoryId = workflow.categoryId || projectId;

    // Find node by label (case-insensitive)
    let startNodeId = null;
    for (const node of nodes) {
      //const nodeName = node?.data?.label || node?.label || node?.data?.labelText;
      const runNodeLabel = node?.data?.nodeLabel;
      
      if (runNodeLabel == nodeLabelName) {
        startNodeId = node?.id;
        console.log("!!!!!!!node found with nodeLabel:", runNodeLabel, "nodeId:", startNodeId);
        break;
      }
    }

    if (!startNodeId) {
      const availableLabels = nodes.map(n => n?.data?.nodeLabel || n?.data?.label || n?.label || '(unnamed)').join(', ');
      return res.status(404).json({ 
        error: `Node with label "${nodeLabelName}" not found in workflow`,
        availableLabels: availableLabels || '(no nodes)'
      });
    }

    // Create new run starting from the specified node
    const options = { startNodeId };
    const run = runManager.startRun({ 
      projectId, 
      workflowId, 
      nodes, 
      edges, 
      apis, 
      options 
    });
    
    console.log(`[runnew] Created run ${run.runId} from workflow ${workflowId}, starting at node "${nodeLabelName}" (nodeId: ${startNodeId})`);
    
    res.json({ 
      success: true, 
      runId: run.runId,
      runflowId: run.runId,
      projectId: run.projectId,
      workflowId: run.workflowId,
      categoryId: run.categoryId,
      startNodeId: startNodeId,
      startNodeLabel: nodeLabelName
    });
  } catch (err) { 
    console.error('[runnew] Error:', err);
    res.status(500).json({ error: String(err) }); 
  }
});

// Update workflow metadata (name, category)
app.post('/updateworkflow', (req, res) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const name = req.body?.name || null;
    const category = req.body?.category || req.body?.categoryId || null;

    // Update DB if row exists
    try {
      const exists = db.prepare('SELECT id FROM rules WHERE id = ?').get(id);
      if (exists) {
        const stmt = db.prepare('UPDATE rules SET name = COALESCE(?, name), category_id = COALESCE(?, category_id), updated_at = ? WHERE id = ?');
        stmt.run(name, category, new Date().toISOString(), id);
      } else {
        // Insert minimal row if missing
        const stmt = db.prepare('INSERT INTO rules (id, name, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
        const now = new Date().toISOString();
        stmt.run(id, name || '', category || '', now, now);
      }
    } catch (e) {
      console.warn('[updateworkflow] DB update failed', e.message);
    }

    // Update in-memory project metadata and broadcast
    try {
      projectManager.updateProjectState(id, { name: name || undefined, categoryId: category || undefined });
      // Also ensure project entry exists in projectManager.projects
      const proj = projectManager.getProject(id);
      if (!proj) {
        projectManager.loadProject(id, [], [], [], 1000, category || id);
      } else {
        if (name) proj.name = name;
        if (category) proj.categoryId = category;
      }
      // Persist runs_store.json asynchronously
      try { projectManager.scheduleSave(1000); } catch (e) {}
    } catch (e) { console.warn('[updateworkflow] projectManager update failed', e.message); }

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Delete workflow (remove from DB and in-memory projects)
app.get('/deleteworkflow/:workflowID', (req, res) => {
  try {
    const id = req.params.workflowID;
    if (!id) return res.status(400).json({ success: false, error: 'workflowID required' });

    try {
      const stmt = db.prepare('DELETE FROM rules WHERE id = ?');
      stmt.run(id);
    } catch (e) {
      console.warn('[deleteworkflow] DB delete failed', e.message);
    }

    try {
      // remove in-memory project
      if (projectManager.projects.has(id)) {
        projectManager.projects.delete(id);
        projectManager.scheduleSave(1000);
      }
      // Broadcast status update so clients refresh lists
      projectManager.sendAllWorkflowStatus();
    } catch (e) { console.warn('[deleteworkflow] failed to cleanup in-memory project', e.message); }

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Add new workflow (rule) to sqlite and sync to memory
app.post('/addworkflow', (req, res) => {
  try {
    const name = req.body?.name || 'New Workflow';
    const categoryId = req.body?.categoryId || '';

    // Generate new workflow ID
    const workflowId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Insert into sqlite rules table
    try {
      const stmt = db.prepare(`
        INSERT INTO rules (id, name, category_id, expr, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      stmt.run(workflowId, name, categoryId || '', '', 'Rule Checker', now, now);
      console.log('[addworkflow] Inserted new workflow into DB:', workflowId, 'name:', name);
    } catch (e) {
      console.warn('[addworkflow] DB insert failed', e.message);
    }

    // Load the new workflow into memory
    try {
      projectManager.loadProject(workflowId, [], [], [], 1000, categoryId || '');
      // Update the in-memory project with the correct name (loadProject sets name to projectId by default)
      projectManager.updateProjectState(workflowId, { name, categoryId });
      projectManager.scheduleSave(1000);
      console.log('[addworkflow] Loaded workflow into memory:', workflowId, 'with name:', name);
    } catch (e) {
      console.warn('[addworkflow] projectManager update failed', e.message);
    }

    // Broadcast updated workflow list to all clients
    try {
      projectManager.sendAllWorkflowStatus();
    } catch (e) { /* ignore */ }

    res.json({ success: true, id: workflowId, name });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});


app.get('/api/workflows/:workflowId', (req, res) => {
  try {
    const workflowId = req.params.workflowId;
    // Support both direct workflowId and runflowId (runId) lookup
    let finalWorkflowId = workflowId;
    
    // Check if this looks like a runflowId (run_uuid format)
    if (workflowId.startsWith('run_')) {
      const runflow = runManager.getRun(workflowId);
      if (runflow) {
        finalWorkflowId = runflow.workflowId;
      }
    }
    
    const workflow = projectManager.getWorkflowData(finalWorkflowId);
    if (!workflow) return res.status(404).json({ error: 'not_found' });
    
    // Include runflowId info if this was looked up via runflow
    if (workflowId.startsWith('run_')) {
      workflow.runflowId = workflowId;
    }
    
    res.json(workflow);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.patch('/api/workflows/:workflowId/style', (req, res) => {
  try {
    const workflowId = req.params.workflowId;
    const nodes = req.body?.nodes;
    const edges = req.body?.edges;
    
    // Support both direct workflowId and runflowId (runId) lookup
    let finalWorkflowId = workflowId;
    
    // Check if this looks like a runflowId (run_uuid format)
    if (workflowId.startsWith('run_')) {
      const runflow = runManager.getRun(workflowId);
      if (runflow) {
        finalWorkflowId = runflow.workflowId;
      }
    }
    
    const updated = projectManager.updateWorkflowStyle(finalWorkflowId, nodes, edges);
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true, workflowId: finalWorkflowId, runflowId: workflowId !== finalWorkflowId ? workflowId : undefined });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});


const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log('server running on', port);
});
