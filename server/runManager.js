import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { runWorkflow } from './workflowRunner.js';
import projectManager from './projectManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, 'runs_store.json');

class RunManager {
  constructor() {
    this.io = null;
    this.runs = {}; // runId -> runObj
    this.handlers = {}; // runId -> event handlers registered by runner (via fakeSocket.on)
    this._loadFromDisk();
  }

  init(io) {
    this.io = io;
  }

  _persist() {
    try {
      // ensure directory exists
      try { fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true }); } catch (e) { }
      const data = Object.values(this.runs).map(r => ({ runId: r.runId, projectId: r.projectId, workflowId: r.workflowId, categoryId: r.categoryId, startedAt: r.startedAt, currentNodeId: r.currentNodeId, currentEdgeId: r.currentEdgeId, lastHeartbeat: r.lastHeartbeat }));
      fs.writeFileSync(STORE_PATH, JSON.stringify({ runs: data }, null, 2));
    } catch (e) { console.warn('Failed to persist runs:', e); }
  }

  //0317B
  _loadFromDisk() {
    console.log("------------------- ------------ ----------------------------------");
    console.log("------------------- runManager.loadFromDisk_v3 --------------------");
    console.log("------------------- ------------ ----------------------------------");
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    
    if (parsed && Array.isArray(parsed.runs)) {
      parsed.runs.forEach(r => {
        const proj = projectManager.getProject(r.projectId);
        const nodes = proj?.nodes || [];
        const edges = proj?.edges || [];
        const apis = proj?.apis || [];
        
        const handlers = {};
        const room = `run:${r.runId}`;
        
        const runObj = {
          runId: r.runId, 
          projectId: r.projectId, 
          workflowId: r.workflowId || null,
          categoryId: r.categoryId || null,
          status: 'stopped',
          startedAt: r.startedAt || null, 
          currentNodeId: r.currentNodeId || null, 
          currentEdgeId: r.currentEdgeId || null,
          lastHeartbeat: r.lastHeartbeat || null,
          nodes,
          edges,
          apis,
          room,
          storeVars: r.storeVars || {}
        };
        
        // ✅ 立即為所有 loaded runs 建立完整的 fakeSocket（不用條件判斷）
        runObj.fakeSocket = {
          id: `backend_${r.runId}`,
          io: this.io,
          on: (ev, fn) => { handlers[ev] = fn; },
          __call: (ev, payload) => {
            try { 
              if (typeof handlers[ev] === 'function') handlers[ev](payload); 
            } catch (e) { console.warn('loaded run handler error', e); }
          },
          emit: (event, payload) => {
            try {
              if (event === 'workflow_status_update' && this.io) {
                this.io.emit(event, payload);
                return;
              }
              if (event === 'store_vars_update') {
                runObj.storeVars = payload || runObj.storeVars || {};
                runObj.lastHeartbeat = new Date().toISOString();
                this._persist();
              }
              if (event === 'node_start' && payload?.nodeId) {
                runObj.currentNodeId = payload.nodeId;
                runObj.currentEdgeId = null;
                runObj.lastHeartbeat = new Date().toISOString();
                this._persist();
              }
              if (event === 'edge_start' && payload?.edgeId) {
                runObj.currentEdgeId = payload.edgeId;
                runObj.lastHeartbeat = new Date().toISOString();
                this._persist();
              }
              if (event === 'run_started') {
                runObj.status = 'running';
                runObj.lastHeartbeat = new Date().toISOString();
                this._persist();
                try { this._broadcastRunningList(); } catch (e) { }
              }
              if (event === 'run_completed' || event === 'workflow_complete') {
                runObj.status = 'completed';
                runObj.lastHeartbeat = new Date().toISOString();
                this._persist();
                try { this._broadcastRunningList(); } catch (e) { }
              }
              if (event === 'run_error') {
                runObj.status = 'error';
                runObj.lastHeartbeat = new Date().toISOString();
                this._persist();
                try { this._broadcastRunningList(); } catch (e) { }
              }
              if (this.io) this.io.to(room).emit(event, payload);
            } catch (e) { console.warn('fakeSocket emit error:', e); }
          }
        };
        
        this.runs[r.runId] = runObj;
      });
      console.log(`[RunManager] ✅ Loaded ${Object.keys(this.runs).length} runs from disk`);
      
      // ✅ 載入後立即恢復所有有 currentNodeId 的 runs
      this._resumeAllLoadedRuns();
    }
  } catch (e) { 
    console.warn('Failed to load runs from disk:', e); 
  }
}

  //0317B
  async _resumeAllLoadedRuns() {
    const runsToResume = Object.values(this.runs).filter(r => r.currentNodeId && r.status === 'stopped');
    if (runsToResume.length === 0) {
      console.log('[RunManager] No runs to resume');
      return;
    }
    
    console.log(`[RunManager] 🔄 Resuming ${runsToResume.length} loaded runs from currentNodeId...`);
    
    runsToResume.forEach(r => {
      console.log(`[RunManager] ▶️ Resuming run ${r.runId.substring(0, 12)}... from node ${r.currentNodeId}`);
      
      // 異步啟動每個 run（不 await，讓它們並行執行）
      (async () => {
        try {
          r.status = 'running';
          this._persist();
          r.fakeSocket.emit('run_started', { runId: r.runId, projectId: r.projectId, workflowId: r.workflowId });
          
          // Resume from currentNodeId
          await runWorkflow(r.fakeSocket, { 
            projectId: r.projectId, 
            runId: r.runId, 
            nodes: r.nodes, 
            edges: r.edges, 
            apis: r.apis,
            stepDelay: 800,
            initialStoreVars: r.storeVars || {},
            startNodeId: r.currentNodeId,
            categoryId: r.categoryId
          });
          
          r.status = 'completed';
          r.lastHeartbeat = new Date().toISOString();
          this._persist();
          r.fakeSocket.emit('run_completed', { runId: r.runId });
        } catch (err) {
          console.error(`[RunManager] ❌ Resume failed for run ${r.runId.substring(0, 12)}:`, err?.message);
          r.status = 'error';
          r.fakeSocket.emit('run_error', { runId: r.runId, message: err?.message || String(err) });
          this._persist();
        }
      })();
    });
  }

  //0317: New method to resume runs that were loaded from disk and have a currentNodeId (indicating they were active when the server stopped)
  /*
  _loadFromDisk() {
    console.log("------------------- ------------ ----------------------------------");
    console.log("------------------- runManager.loadFromDisk_v2 --------------------");
    console.log("------------------- ------------ ----------------------------------");
    try {
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      
      if (parsed && Array.isArray(parsed.runs)) {
        parsed.runs.forEach(r => {
          // Get nodes/edges from projectManager if available
          const proj = projectManager.getProject(r.projectId);
          const nodes = proj?.nodes || [];
          const edges = proj?.edges || [];
          const apis = proj?.apis || [];
          
          const handlers = {};
          const room = `run:${r.runId}`;
          
          const runObj = {
            runId: r.runId, 
            projectId: r.projectId, 
            workflowId: r.workflowId || null,
            categoryId: r.categoryId || null,
            status: 'stopped',
            startedAt: r.startedAt || null, 
            currentNodeId: r.currentNodeId || null, 
            currentEdgeId: r.currentEdgeId || null,
            lastHeartbeat: r.lastHeartbeat || null,
            nodes,
            edges,
            apis,
            room,
            storeVars: r.storeVars || {}
          };
          
          // Create functional fakeSocket for loaded runs so they can resume
          runObj.fakeSocket = {
            id: `backend_${r.runId}`,
            io: this.io,
            on: (ev, fn) => { handlers[ev] = fn; },
            __call: (ev, payload) => {
              try { 
                if (typeof handlers[ev] === 'function') handlers[ev](payload); 
              } catch (e) { console.warn('loaded run handler error', e); }
            },
            emit: (event, payload) => {
              try {
                //console.log(`[restart run] ${event} `);
                // Handle workflow_status_update
                if (event === 'workflow_status_update' && this.io) {
                  this.io.emit(event, payload);
                  return;
                }
                
                // Update run metadata on lifecycle events
                if (event === 'store_vars_update') {
                  runObj.storeVars = payload || runObj.storeVars || {};
                  runObj.lastHeartbeat = new Date().toISOString();
                  this._persist();
                }
                if (event === 'node_start' && payload?.nodeId) {
                  runObj.currentNodeId = payload.nodeId;
                  runObj.currentEdgeId = null;
                  runObj.lastHeartbeat = new Date().toISOString();
                  this._persist();
                }
                if (event === 'edge_start' && payload?.edgeId) {
                  runObj.currentEdgeId = payload.edgeId;
                  runObj.lastHeartbeat = new Date().toISOString();
                  this._persist();
                }
                if (event === 'run_started') {
                  runObj.status = 'running';
                  runObj.lastHeartbeat = new Date().toISOString();
                  this._persist();
                  try { this._broadcastRunningList(); } catch (e) { }
                }
                if (event === 'run_completed' || event === 'workflow_complete') {
                  runObj.status = 'completed';
                  runObj.lastHeartbeat = new Date().toISOString();
                  this._persist();
                  try { this._broadcastRunningList(); } catch (e) { }
                }
                if (event === 'run_error') {
                  runObj.status = 'error';
                  runObj.lastHeartbeat = new Date().toISOString();
                  this._persist();
                  try { this._broadcastRunningList(); } catch (e) { }
                }
                
                // Broadcast to room
                if (this.io) this.io.to(room).emit(event, payload);
              } catch (e) { }
            }
          };
          
          this.runs[r.runId] = runObj;
        });
        console.log(`[RunManager] ✅ Loaded ${Object.keys(this.runs).length} runs from disk`);
        
        // Resume execution for all loaded runs that have currentNodeId
        this._resumeAllRuns();
      }
    } catch (e) { 
      console.warn('Failed to load runs from disk:', e); 
    }
  }

  //0317: New method to resume runs that were loaded from disk and have a currentNodeId (indicating they were active when the server stopped)
  _resumeAllRuns() {
    const runsToResume = Object.values(this.runs).filter(r => r.currentNodeId);
    if (runsToResume.length === 0) return;
    
    console.log(`[RunManager] 🔄 Resuming ${runsToResume.length} runs from currentNodeId...`);
    
    runsToResume.forEach(r => {
      console.log(`[RunManager] ▶️ Resuming run ${r.runId} from node ${r.currentNodeId}`);
      
      // Start execution asynchronously from the currentNodeId
      (async () => {
        try {
          r.status = 'running';
          this._persist();
          r.fakeSocket.emit('run_started', { runId: r.runId, projectId: r.projectId, workflowId: r.workflowId });
          
          // Resume workflow from currentNodeId
          await runWorkflow(r.fakeSocket, { 
            projectId: r.projectId, 
            runId: r.runId, 
            nodes: r.nodes, 
            edges: r.edges, 
            apis: r.apis,
            stepDelay: 800,
            initialStoreVars: r.storeVars || {},
            startNodeId: r.currentNodeId  // Resume from current position
          });
          
          r.status = 'completed';
          r.lastHeartbeat = new Date().toISOString();
          this._persist();
          r.fakeSocket.emit('run_completed', { runId: r.runId });
        } catch (err) {
          console.error(`[RunManager] ❌ Resume failed for run ${r.runId}:`, err);
          r.status = 'error';
          r.fakeSocket.emit('run_error', { runId: r.runId, message: err?.message || String(err) });
          this._persist();
        }
      })();
    });
  }
    */

  //v1
  /*
  _loadFromDisk() {
    try {
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      // We only load metadata; active runs must be restarted manually or left stopped.
      if (parsed && Array.isArray(parsed.runs)) {
        parsed.runs.forEach(r => {
          let loadedStatus = 'running';//r.status || 'stopped';
          // If the server restarted while a run was active, we lost its execution context.
          // Force it to 'stopped' so the UI doesn't get stuck thinking it's still running.
          //if (loadedStatus === 'running' || loadedStatus === 'starting') {
          //  loadedStatus = 'stopped';
          //}
          
          // Get nodes/edges from projectManager if available
          const proj = projectManager.getProject(r.projectId);
          const nodes = proj?.nodes || [];
          const edges = proj?.edges || [];
          const apis = proj?.apis || [];
          
          // Create a fake socket for stopped runs so they can receive [next] commands
          const handlers = {};
          const room = `run:${r.runId}`;
          const runObj = {
            runId: r.runId, 
            projectId: r.projectId, 
            workflowId: r.workflowId || null,
            categoryId: r.categoryId || null,
            status: loadedStatus,
            startedAt: r.startedAt || null, 
            currentNodeId: r.currentNodeId || null, 
            currentEdgeId: r.currentEdgeId || null,
            lastHeartbeat: r.lastHeartbeat || null,
            nodes,
            edges,
            apis,
            room
          };
          
          // Only add minimal fakeSocket for stopped runs (just enough for [next] to work)

          
          this.runs[r.runId] = runObj;
        });
        console.log(`[RunManager] Loaded ${Object.keys(this.runs).length} runs from disk`);
      }
    } catch (e) { console.warn('Failed to load runs from disk:', e); }
  }
  */

  startRun({ projectId, workflowId, nodes = [], edges = [], apis = [], options = {} }) {
    console.log('--------------------------------');
    console.log('--------------------------------');
    console.log('--------------------------------');
    console.log(`[RunManager] startRun [New Project] projectId=${projectId} workflowId=${workflowId} nodes=${nodes.length} edges=${edges.length} `);
    console.log(`[RunManager] options:`, options);//options.startNodeId

    if (!projectId) throw new Error('projectId required');
    if (!workflowId) throw new Error('workflowId required');

    // Allow multiple concurrent runs for the same workflow
    const runId = 'run_' + randomUUID();
    const room = `run:${runId}`;

    // create fake socket object compatible with runWorkflow
    const handlers = {};
    const fakeSocket = {
      id: `backend_${runId}`,
      io: this.io,  // Attach io for broadcast capability
      emit: (event, payload) => {
        try {
          // Broadcast workflow_status_update to ALL clients (not just room)
          if (event === 'workflow_status_update' && this.io) {
            console.log(`[RunManager] 📡 Broadcasting workflow_status_update to ALL clients via io.emit`);
            this.io.emit(event, payload);
            return;
          }
          
          // update run metadata for introspection
          if (event === 'store_vars_update') {
            runObj.storeVars = payload || runObj.storeVars || {};
            runObj.lastHeartbeat = new Date().toISOString();
            this._persist();
          }
          if (event === 'node_start' && payload && payload.nodeId) {
            runObj.currentNodeId = payload.nodeId;
            runObj.currentEdgeId = null;
            runObj.lastHeartbeat = new Date().toISOString();
            this._persist();
          }
          if (event === 'edge_start' && payload && payload.edgeId) {
            runObj.currentEdgeId = payload.edgeId;
            runObj.lastHeartbeat = new Date().toISOString();
            this._persist();
          }
          if (event === 'run_started') {
            runObj.status = 'running';
            runObj.lastHeartbeat = new Date().toISOString();
            this._persist();
            try { this._broadcastRunningList(); } catch (e) { }
          }
          if (event === 'run_completed' || event === 'workflow_complete') {
            runObj.status = 'completed';
            runObj.lastHeartbeat = new Date().toISOString();
            this._persist();
            try { this._broadcastRunningList(); } catch (e) { }
          }
          if (event === 'run_error') {
            runObj.status = 'error';
            runObj.lastHeartbeat = new Date().toISOString();
            this._persist();
            try { this._broadcastRunningList(); } catch (e) { }
          }
          if (this.io) this.io.to(room).emit(event, payload);
        } catch (e) { }
      },
      on: (ev, fn) => {
        handlers[ev] = fn;
      },
      // utility to call registered handlers from external inputs
      __call: (ev, payload) => {
        try { if (typeof handlers[ev] === 'function') handlers[ev](payload); } catch (e) { console.warn('run handler error', e); }
      }
    };

    // Extract categoryId from project
    const proj = projectManager.getProject(projectId);
    const categoryId = proj?.categoryId || null;// || projectId;

    const runObj = {
      runId,
      projectId,
      workflowId,
      categoryId,
      room,
      status: 'starting',
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      currentNodeId: null,
      currentEdgeId: null,
      storeVars: {},
      nodes,
      edges,
      apis,
      options,
      fakeSocket,
      abort: false
    };

    this.runs[runId] = runObj;
    this._persist();
    try { this._broadcastRunningList(); } catch (e) { }

    console.log(`[RunManager] startRun -> projectId=${projectId} workflowId=${workflowId} runId=${runId} categoryId=${categoryId} nodes=${(nodes || []).length} edges=${(edges || []).length}`);
    console.log('project data:', proj?.categoryId, proj?.name);
    //console.log(runObj);

    // run asynchronously
    (async () => {
      try {
        runObj.status = 'running';
        this._persist();
        runObj.fakeSocket.emit('run_started', { runId, projectId, workflowId });

        // Clear old activeNodeId since this is a new run (not a resume)
        if (proj) {
          proj.activeNodeId = null;
          proj.activeEdgeId = null;
        }

        // supply socket-like object to existing runWorkflow implementation
        // Ensure we pass projectId and runflowId so the runner can register its waitResolvers and track runflow
        // Extract startNodeId from options if provided
        //const startNodeId = options.startNodeId || null;
        // Prefer new `runId` field when invoking runner (runner will also accept legacy `runflowId`)
        //0317b
        //await runWorkflow(runObj.fakeSocket, { projectId, runId: runId, nodes, edges, apis, stepDelay: options.stepDelay || 800, initialStoreVars: options.initialStoreVars || {} });
        await runWorkflow(runObj.fakeSocket, { projectId, runId: runId, nodes, edges, apis, stepDelay: options.stepDelay || 800, initialStoreVars: options.initialStoreVars || {}, startNodeId: options.startNodeId || null, categoryId });

        runObj.status = 'completed';
        runObj.lastHeartbeat = new Date().toISOString();
        this._persist();
        //this._broadcastRunningList();
        runObj.fakeSocket.emit('run_completed', { runId });
      } catch (err) {
        console.error('Run failed:', err);
        runObj.status = 'error';
        runObj.fakeSocket.emit('run_error', { runId, message: err?.message || String(err) });
        this._persist();
        //this._broadcastRunningList();
      }
    })();

    return runObj;
  }

  stopRun(runId) {
    const r = this.runs[runId];
    if (!r) return null;
    r.abort = true;
    r.status = 'stopping';
    // trigger stop_workflow handler inside runner if exists
    try { r.fakeSocket.__call('stop_workflow'); } catch (e) { }
    r.status = 'stopped';
    r.stoppedAt = new Date().toISOString();
    this._persist();
    try { this._broadcastRunningList(); } catch (e) { }
    try { r.fakeSocket.emit('run_stopped', { runId }); } catch (e) { }
    return r;
  }

  getAllRunflows() {
    // Return all runs and preserve them until manually deleted.
    // Include lightweight current node metadata to allow UI to show where the run is executing.
    return Object.values(this.runs)
      .map(r => {
        const nodeList = Array.isArray(r.nodes) ? r.nodes : [];
        const nodeCount = nodeList.length;
        const currentNodeId = r.currentNodeId || null;
        let currentNodeName = null;
        let currentNodeIndex = -1;
        if (currentNodeId && nodeCount) {
          const idx = nodeList.findIndex(n => String(n.id) === String(currentNodeId));
          if (idx >= 0) {
            currentNodeIndex = idx + 1; // 1-based index for UI
            const n = nodeList[idx];
            currentNodeName = (n && (n.data?.label || n.label || n.data?.labelText)) || String(n?.id || '') || null;
          }
        }
        return {
          runflowId: r.runId,
          projectId: r.projectId,
          workflowId: r.workflowId,
          categoryId: r.categoryId,
          startedAt: r.startedAt,
          currentNodeId: currentNodeId,
          currentEdgeId: r.currentEdgeId,
          lastHeartbeat: r.lastHeartbeat,
          nodeCount,
          currentNodeName,
          currentNodeIndex
        };
      });
  }

  _broadcastRunningList() {
    try {
      if (this.io) {
        const runningList = this.getAllRunflows();
        this.io.emit('running_list_update', { runflows: runningList });
        console.log(`[RunManager] 📡 Broadcast running_list_update: ${runningList.length} runflows`);
      }
    } catch (e) { console.warn('Failed to broadcast running list:', e); }
  }

  getRunStatusByProject(projectId) {
    const r = Object.values(this.runs).find(x => x.projectId === projectId);
    if (!r) return null;
    const isRunning = r.status === 'running' || r.status === 'starting';
    return {
      runId: r.runId, projectId: r.projectId, workflowId: r.workflowId,
      currentNodeId: r.currentNodeId, currentEdgeId: r.currentEdgeId, startedAt: r.startedAt,
      lastHeartbeat: r.lastHeartbeat, storeVars: r.storeVars || {},
      nodes: isRunning ? (r.nodes || []) : undefined,
      edges: isRunning ? (r.edges || []) : undefined
    };
  }

  getRun(runId) {
    const r = this.runs[runId] || null;
    if (!r) return null;
    const isRunning = r.status === 'running' || r.status === 'starting';
    return {
      runId: r.runId, projectId: r.projectId, workflowId: r.workflowId,
      currentNodeId: r.currentNodeId, currentEdgeId: r.currentEdgeId, startedAt: r.startedAt,
      lastHeartbeat: r.lastHeartbeat, storeVars: r.storeVars || {},
      nodes: isRunning ? (r.nodes || []) : undefined,
      edges: isRunning ? (r.edges || []) : undefined
    };
  }

  // Remove a run from memory (manual delete). If the run is active, attempt to stop it first.
  deleteRun(runId) {
    const r = this.runs[runId];
    if (!r) return false;
    try {
      if (r && (r.status === 'running' || r.status === 'starting')) {
        r.abort = true;
        try { r.fakeSocket.__call('stop_workflow'); } catch (e) { }
        try { r.fakeSocket.emit('run_stopped', { runId }); } catch (e) { }
      }
      delete this.runs[runId];
      this._persist();
      try { this._broadcastRunningList(); } catch (e) { }
      return true;
    } catch (e) { return false; }
  }

  // called by server when a client sends a control message
  receiveClientEvent(runId, event, payload) {
    const r = this.runs[runId];
    if (!r) return false;
    try {
      // forward to runner handlers
      r.fakeSocket.__call(event, payload);
      // update heartbeat
      r.lastHeartbeat = new Date().toISOString();
      this._persist();
      return true;
    } catch (e) { return false; }
  }
}

const manager = new RunManager();
export default manager;
