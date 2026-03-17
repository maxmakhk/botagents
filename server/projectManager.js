/**
 * Project Manager - Manages workflow projects and client subscriptions
 * Coordinates between multiple clients watching the same project
 * Executes projects independently from client connections
 */

import { executeWorkflow } from './workflowRunner.js';
import db from './db.js';
import fs from 'fs/promises';
import path from 'path';

class ProjectManager {
  constructor() {
    // Map: projectId -> { nodes, edges, status, storeVars, activeNodeId, activeEdgeId, apis, stepDelay }
    this.projects = new Map();
    
    // Map: clientId -> { socket, projectId }
    this.clients = new Map();
    
    // Map: projectId -> Set<clientId>
    this.projectWatchers = new Map();
    
    // Map: categoryId -> Set<clientId> (for category-based watching)
    this.categoryWatchers = new Map();
    
    // Map: runId -> { executing, abort, waitResolvers }
    // Changed from projectId key to runId key for multi-instance support
    this.runningProjects = new Map();
    
    // NEW: Map: runId -> { runId, projectId, nodes[], edges[], status, storeVars, activeNodeId, activeEdgeId, apis, stepDelay, createdAt, pausedAt, paused_wait }
    this.run_instances = new Map();
    
    // NEW: Map: projectId -> Set<runId> for quick lookup of all runs for a project
    this.runsByProjectId = new Map();
    
    // Socket.IO instance for broadcasting
    this.io = null;
    // Global store for application-wide variables (single object)
    this.globalStoreVars = {};
    
    // Execution loop interval
    this.executionInterval = null;
    // Verbose logging toggle (set env PROJECT_MANAGER_VERBOSE=true to enable)
    this.verbose = (process.env.PROJECT_MANAGER_VERBOSE === 'true');
    
    // Auto-save debounce timer
    this.saveTimer = null;
    this.diskSavePath = path.join(process.cwd(), 'runs_store.json');

    // Debounced workflow-structure broadcast timers (projectId -> Timeout)
    this.sendNodesTimers = new Map();
  }

  // NEW: Generate a unique runId
  generateRunId(projectId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${projectId}_${timestamp}_${random}`;
  }

  // NEW: Create a new run instance from a project template
  createRunInstance(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      console.error(`[ProjectManager] Cannot create run instance: project ${projectId} not found`);
      return null;
    }

    const runId = this.generateRunId(projectId);
    const runInstance = {
      runId,
      projectId,
      nodes: JSON.parse(JSON.stringify(project.nodes || [])), // Deep copy
      edges: JSON.parse(JSON.stringify(project.edges || [])), // Deep copy
      apis: project.apis || [],
      stepDelay: project.stepDelay || 1000,
      status: 'running',
      storeVars: JSON.parse(JSON.stringify(project.storeVars || {})), // Deep copy
      activeNodeId: null,
      activeEdgeId: null,
      createdAt: new Date().toISOString(),
      pausedAt: null,
      paused_wait: false
    };

    // Store in run_instances
    this.run_instances.set(runId, runInstance);

    // Track in runsByProjectId
    if (!this.runsByProjectId.has(projectId)) {
      this.runsByProjectId.set(projectId, new Set());
    }
    this.runsByProjectId.get(projectId).add(runId);

    // Initialize waitResolvers for this run
    this.runningProjects.set(runId, { executing: false, abort: false, waitResolvers: {} });

    this.log(`Created run instance ${runId} for project ${projectId}`);
    return runInstance;
  }

  // NEW: Get all running instances
  getAllRunInstances() {
    const instances = [];
    for (const [runId, instance] of this.run_instances.entries()) {
      instances.push({
        runId,
        projectId: instance.projectId,
        status: instance.status,
        activeNodeId: instance.activeNodeId,
        createdAt: instance.createdAt,
        pausedAt: instance.pausedAt,
        isPaused: instance.paused_wait
      });
    }
    return instances;
  }

  // NEW: Get all run instances for a specific project
  getProjectRunInstances(projectId) {
    const runIds = this.runsByProjectId.get(projectId) || new Set();
    const instances = [];
    for (const runId of runIds) {
      const instance = this.run_instances.get(runId);
      if (instance) {
        instances.push({
          runId,
          status: instance.status,
          activeNodeId: instance.activeNodeId,
          createdAt: instance.createdAt,
          pausedAt: instance.pausedAt,
          isPaused: instance.paused_wait
        });
      }
    }
    return instances;
  }

  // Global store var helpers
  getGlobalVars() {
    return this.globalStoreVars || {};
  }

  setGlobalVar(key, value) {
    console.log("setGlobalVar called with:", { key, value });
    try {
      const k = String(key || '').trim();
      if (!k) return;
      this.globalStoreVars[k] = value;
      // Always log global var updates for debugging
      //console.log(`[ProjectManager] setGlobalVar: projectGlobal ${k} =`, value);
      // Broadcast to all connected clients that global store changed
      this.broadcastToAllClients('global_store_vars_update', { globalStoreVars: this.globalStoreVars });
    } catch (e) { /* ignore */ }
  }

  replaceGlobalVars(obj) {
    try {
      this.globalStoreVars = Object.assign({}, obj || {});
      this.broadcastToAllClients('global_store_vars_update', { globalStoreVars: this.globalStoreVars });
    } catch (e) { }
  }

  log(...args) {
    if (this.verbose) console.log('[ProjectManager]', ...args);
  }

  /**
   * Load projects from runs_store.json (if exists)
   */
  async loadFromDisk(filePath) {
    console.log("------------------- ------------ ----------------------------------");
    console.log("------------------- projectManager.loadFromDisk -------------------");
    console.log("------------------- ------------ ----------------------------------");
    try {
      const fp = filePath || path.join(process.cwd(), 'runs_store.json');
      const raw = await fs.readFile(fp, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projects)) {
        for (const p of parsed.projects) {
          // Restore minimal project shape
          this.projects.set(p.projectId, {
            nodes: p.nodes || [],
            edges: p.edges || [],
            status: p.status || 'stopped',
            storeVars: p.storeVars || {},
            activeNodeId: p.activeNodeId || null,
            activeEdgeId: p.activeEdgeId || null,
            apis: p.apis || [],
            stepDelay: p.stepDelay || 1000,
            categoryId: p.categoryId || p.projectId
          });
        }
      }
      //console.log(`[ProjectManager] Loaded ${this.projects.size} projects from ${filePath || 'runs_store.json'}`);
    } catch (e) {
      if (e.code === 'ENOENT') {
        //console.log('[ProjectManager] No runs_store.json found, starting fresh');
        return;
      }
      //console.error('[ProjectManager] Error loading runs_store.json:', e);
    }
  }

  /**
   * Save projects to runs_store.json (only minimal necessary state)
   */
  async saveToDisk(filePath) {
    try {
      const fp = filePath || path.join(process.cwd(), 'runs_store.json');
      
      // Read existing file to preserve runs data
      let existingRuns = [];
      try {
        const existing = await fs.readFile(fp, 'utf8');
        const parsed = JSON.parse(existing || '{}');
        existingRuns = parsed.runs || [];
      } catch (e) { /* error reading existing file */ }
      
      const projects = [];
      for (const [projectId, p] of this.projects.entries()) {
        projects.push({
          projectId,
          nodes: p.nodes || [],
          edges: p.edges || [],
          status: p.status || 'stopped',
          storeVars: p.storeVars || {},
          activeNodeId: p.activeNodeId || null,
          activeEdgeId: p.activeEdgeId || null,
          apis: p.apis || [],
          stepDelay: p.stepDelay || 1000,
          categoryId: p.categoryId || null
        });
      }
      
      const out = { 
        savedAt: new Date().toISOString(), 
        projects,
        runs: existingRuns
      };
      await fs.writeFile(fp, JSON.stringify(out, null, 2), 'utf8');
      this.log(`Saved ${projects.length} projects to ${fp}`);
    } catch (e) {
      //console.error('[ProjectManager] Error saving runs_store.json:', e);
    }
  }

  /**
   * Initialize with Socket.IO instance
   */
  init(io) {
    this.io = io;
    this.startExecutionLoop();
    this.log('Initialized with execution loop');
  }

  /**
   * Register a client connection
   */
  registerClient(clientId, socket) {
    this.clients.set(clientId, { socket, projectId: null, projectcategoryId: null });
    //console.log(`[ProjectManager] Client registered: ${clientId}`);
  }

  /**
   * Unregister a client (on disconnect)
   */
  unregisterClient(clientId) {
    const client = this.clients.get(clientId);
    if (client && client.projectId) {
      this.unwatchProject(clientId, client.projectId);
    }
    
    // Clean up category watchers for this client
    for (const [categoryId, watchers] of this.categoryWatchers.entries()) {
      watchers.delete(clientId);
      if (watchers.size === 0) {
        this.categoryWatchers.delete(categoryId);
      }
    }
    
    this.clients.delete(clientId);
    //console.log(`[ProjectManager] Client unregistered: ${clientId}`);
  }

  /**
   * Client starts watching a project
   */
  watchProject(clientId, projectId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Unwatch previous project if any
    if (client.projectId) {
      this.unwatchProject(clientId, client.projectId);
    }

    // Watch new project
    client.projectId = projectId;
    
    if (!this.projectWatchers.has(projectId)) {
      this.projectWatchers.set(projectId, new Set());
    }
    this.projectWatchers.get(projectId).add(clientId);

    this.log(`Client ${clientId} watching project ${projectId}`);

    // Send current project status to client (只發送 status，不包含執行細節)
    const project = this.projects.get(projectId);
    if (project) {
      // Project exists, send status
      client.socket.emit('project_status', {
        projectId,
        status: project.status
      });
      this.log(`Sent project status to ${clientId}: status=${project.status}`);
      
      // If running, also send current execution state
      if (project.status === 'running') {
        client.socket.emit('execution_state', {
          projectId,
          activeNodeId: project.activeNodeId,
          activeEdgeId: project.activeEdgeId,
          storeVars: project.storeVars,
          globalStoreVars: this.getGlobalVars()
        });
        //console.log(`[ProjectManager] Sent execution state to ${clientId}`);
      }
    } else {
      // Project doesn't exist yet, send default stopped status
      client.socket.emit('project_status', {
        projectId,
        status: 'stopped'
      });
      this.log(`Sent default stopped status to ${clientId} for new project ${projectId}`);
    }
  }

  /**
   * Client stops watching a project
   */
  unwatchProject(clientId, projectId) {
    const watchers = this.projectWatchers.get(projectId);
    if (watchers) {
      watchers.delete(clientId);
      if (watchers.size === 0) {
        this.projectWatchers.delete(projectId);
      }
    }
    this.log(`Client ${clientId} unwatched project ${projectId}`);
  }

  /**
   * Client watches a category - receives all broadcasts for that category
   */
  watchCategory(clientId, categoryId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Initialize category watchers set if needed
    if (!this.categoryWatchers.has(categoryId)) {
      this.categoryWatchers.set(categoryId, new Set());
    }
    
    this.categoryWatchers.get(categoryId).add(clientId);
    this.log(`Client ${clientId} watching category ${categoryId}`);
  }

  /**
   * Client stops watching a category
   */
  unwatchCategory(clientId, categoryId) {
    const watchers = this.categoryWatchers.get(categoryId);
    if (watchers) {
      watchers.delete(clientId);
      if (watchers.size === 0) {
        this.categoryWatchers.delete(categoryId);
      }
    }
    this.log(`Client ${clientId} unwatched category ${categoryId}`);
  }

  /**
   * Broadcast event to all clients watching a category
   */
  broadcastToCategory(categoryId, event, data) {
    const watchers = this.categoryWatchers.get(categoryId);
    if (!watchers) {
      this.log(`No watchers for category ${categoryId}, cannot broadcast ${event}`);
      return;
    }

    this.log(`Broadcasting ${event} to ${watchers.size} watchers of category ${categoryId}`);

    for (const clientId of watchers) {
      const client = this.clients.get(clientId);
      if (client && client.socket) {
        client.socket.emit(event, data);
      }
    }
  }

  /**
   * Set client's selected project category
   */
  setClientProjectCategory(clientId, projectcategoryId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.projectcategoryId = projectcategoryId;
      console.log(`\n[ProjectManager] 🎯 Client ${clientId} changed projectcategoryId to: ${projectcategoryId}`);
      
      // Log all clients' current category status
      console.log(`[ProjectManager] 📋 Current clients state:`);
      for (const [cid, c] of this.clients.entries()) {
        const cat = c?.projectcategoryId ? String(c.projectcategoryId) : 'UNSET';
        const marker = cid === clientId ? '👈' : '  ';
        const socketStatus = c?.socket ? '✓' : '✗';
        console.log(`${marker} ${socketStatus} Client ${cid}: ${cat}`);
      }
      console.log('');
    } else {
      console.warn(`[ProjectManager] ⚠️ Client ${clientId} not found when trying to set projectcategoryId to ${projectcategoryId}`);
    }
  }

  /**
   * Broadcast to all clients with matching projectcategoryId
   */
  broadcastToProjectCategory(projectcategoryId, event, data) {
    if (!projectcategoryId) {
      console.log(`[ProjectManager] ⚠️ No projectcategoryId provided for broadcast, cannot send ${event}`);
      return;
    }

    const projectcategoryIdStr = String(projectcategoryId);
    console.log(`\n[ProjectManager] ═══════════════════════════════════════════`);
    console.log(`[ProjectManager] 📢 BROADCAST: ${event} to projectcategoryId: ${projectcategoryIdStr}`);
    console.log(`[ProjectManager] ═══════════════════════════════════════════`);
    console.log(`[ProjectManager] 📊 Total clients connected: ${this.clients.size}`);
    
    const successfulClients = [];
    const failedClients = [];
    const skippedClients = [];
    
    for (const [clientId, client] of this.clients.entries()) {
      const clientCategory = client?.projectcategoryId ? String(client.projectcategoryId) : 'UNSET';
      const hasSocket = client && client.socket ? true : false;
      
      if (client && client.socket && String(client.projectcategoryId) === projectcategoryIdStr) {
        try {
          client.socket.emit(event, data);
          successfulClients.push(clientId);
          console.log(`[ProjectManager] ✅ SENT to client: ${clientId}`);
        } catch (e) {
          failedClients.push({ clientId, error: e.message });
          console.log(`[ProjectManager] ❌ ERROR sending to ${clientId}: ${e.message}`);
        }
      } else {
        let reason = '';
        if (!client) reason = 'NO_CLIENT_DATA';
        else if (!hasSocket) reason = 'NO_SOCKET';
        else reason = `CATEGORY_MISMATCH (client: ${clientCategory} ≠ broadcast: ${projectcategoryIdStr})`;
        
        skippedClients.push({ clientId, reason });
        console.log(`[ProjectManager] ⊘ SKIPPED client: ${clientId} | ${reason}`);
      }
    }
    
    console.log(`[ProjectManager] ───────────────────────────────────────────`);
    console.log(`[ProjectManager] 📈 SUMMARY:`);
    console.log(`[ProjectManager]    ✅ Sent to ${successfulClients.length} client(s): ${successfulClients.join(', ') || 'NONE'}`);
    if (failedClients.length > 0) {
      console.log(`[ProjectManager]    ❌ Failed to send to ${failedClients.length} client(s): ${failedClients.map(f => `${f.clientId}(${f.error})`).join(', ')}`);
    }
    if (skippedClients.length > 0) {
      console.log(`[ProjectManager]    ⊘ Skipped ${skippedClients.length} client(s): ${skippedClients.map(s => `${s.clientId}(${s.reason})`).join(', ')}`);
    }
    console.log(`[ProjectManager] ═══════════════════════════════════════════\n`);
  }

  /**
   * Load or create project
   */
  loadProject(projectId, nodes = [], edges = [], apis = [], stepDelay = 1000, categoryId = null) {
    if (!this.projects.has(projectId)) {
      this.projects.set(projectId, {
        id: projectId,
        name: projectId,
        categoryId: categoryId || projectId,
        nodes: nodes,
        edges: edges,
        status: 'stopped',
        storeVars: {},
        activeNodeId: null,
        activeEdgeId: null,
        apis: apis,
        stepDelay: stepDelay
      });
      this.log(`Project loaded: ${projectId}`);
    } else {
      // Update nodes/edges if provided
      const project = this.projects.get(projectId);
      project.id = project.id || projectId;
      project.name = project.name || projectId;
      if (nodes && nodes.length > 0) project.nodes = nodes;
      if (edges && edges.length > 0) project.edges = edges;
      if (apis) project.apis = apis;
      if (stepDelay) project.stepDelay = stepDelay;
    }
    return this.projects.get(projectId);
  }

  /**
   * Schedule auto-save to runs_store.json (debounced, default 5 seconds)
   * For critical updates like node labels, use shorter delay (500ms)
   */
  scheduleSave(delayMs = 5000) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await this.saveToDisk(this.diskSavePath);
        console.log('[ProjectManager] ✓ Auto-saved to runs_store.json');
      } catch (e) {
        console.error('[ProjectManager] ✗ Auto-save failed:', e);
      }
    }, delayMs);
  }

  /**
   * Update project workflow (nodes/edges)
   */
  updateProjectWorkflow(projectId, nodes, edges) {
    let project = this.projects.get(projectId);
    if (!project) {
      // Create project lazily so brand-new workflows can sync before first run
      this.loadProject(projectId, nodes || [], edges || [], [], 1000);
      project = this.projects.get(projectId);
    }

    if (!project) return;

    const validNodes = Array.isArray(nodes) ? nodes : (project.nodes || []);
    const rawEdges = Array.isArray(edges) ? edges : (project.edges || []);
    
    // Clean up orphaned edges where source or target node doesn't exist
    const nodeIds = new Set(validNodes.map(n => String(n.id || n.nodeId || '')).filter(Boolean));
    const cleanedEdges = rawEdges.filter((e) => {
      const source = String(e.source || e.from || '');
      const target = String(e.target || e.to || '');
      const isValid = source && target && nodeIds.has(source) && nodeIds.has(target);
      if (!isValid && (source || target)) {
        console.log(`[ProjectManager] Removing orphaned edge: ${e.id} (source: ${source}, target: ${target})`);
      }
      return isValid;
    });

    project.nodes = validNodes;
    project.edges = cleanedEdges;

    this.sendNodes(projectId);
    
    // Auto-save to disk after workflow changes
    this.scheduleSave();
  }

  /**
   * Get project workflow (nodes/edges)
   */
  getProjectWorkflow(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      return null;
    }
    return {
      nodes: project.nodes || [],
      edges: project.edges || []
    };
  }

  /**
   * Get workflow runtime/shape statuses for all workflows.
   */
  getAllWorkflowStatus() {
    console.log("[getAllWorkflowStatus]");
    return Array.from(this.projects.entries()).map(([projectId, project]) => {
      // Prefer an explicit project name; if missing or identical to id,
      // try to derive a friendly name from the first node's label/name.
      let displayName = (project && project.name) ? String(project.name) : '';
      if (!displayName || displayName === projectId) {
        const firstNode = Array.isArray(project?.nodes) && project.nodes.length > 0 ? project.nodes[0] : null;
        if (firstNode) {
          displayName = firstNode?.data?.label || firstNode?.data?.name || firstNode?.label || firstNode?.name || projectId;
        } else {
          displayName = projectId;
        }
      }

      return {
        id: projectId,
        name: displayName,
        nodeNumber: Array.isArray(project?.nodes) ? project.nodes.length : 0,
        edgeNumber: Array.isArray(project?.edges) ? project.edges.length : 0,
        runningStatus: (project?.status || 'stopped') === 'running'
      };
    });
  }

  /**
   * Get full workflow data for one workflow id.
   */
  getWorkflowData(projectId) {
    const project = this.projects.get(projectId);
    if (!project) return null;
    return {
      id: projectId,
      name: project.name || projectId,
      categoryId: project.categoryId || projectId,
      nodes: project.nodes || [],
      edges: project.edges || [],
      apis: project.apis || [],
      status: project.status || 'stopped',
      storeVars: project.storeVars || {},
      activeNodeId: project.activeNodeId || null,
      activeEdgeId: project.activeEdgeId || null,
      stepDelay: project.stepDelay || 1000
    };
  }

  /**
   * Update workflow style only (e.g. position/viewport) by node/edge id.
   */
  updateWorkflowStyle(projectId, nodes = [], edges = []) {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const nodeById = new Map((project.nodes || []).map((n) => [String(n.id), n]));
    for (const incoming of (Array.isArray(nodes) ? nodes : [])) {
      if (!incoming || !incoming.id) continue;
      const id = String(incoming.id);
      const existing = nodeById.get(id);
      if (!existing) continue;
      if (incoming.position && typeof incoming.position === 'object') {
        existing.position = { ...(existing.position || {}), ...incoming.position };
      }
      if (incoming.positionAbsolute && typeof incoming.positionAbsolute === 'object') {
        existing.positionAbsolute = { ...(existing.positionAbsolute || {}), ...incoming.positionAbsolute };
      }
      if (incoming.style && typeof incoming.style === 'object') {
        existing.style = { ...(existing.style || {}), ...incoming.style };
      }
      if (incoming.width !== undefined) existing.width = incoming.width;
      if (incoming.height !== undefined) existing.height = incoming.height;
      if (incoming.selected !== undefined) existing.selected = incoming.selected;
      if (incoming.dragging !== undefined) existing.dragging = incoming.dragging;
    }

    const edgeById = new Map((project.edges || []).map((e) => [String(e.id), e]));
    for (const incoming of (Array.isArray(edges) ? edges : [])) {
      if (!incoming || !incoming.id) continue;
      const id = String(incoming.id);
      const existing = edgeById.get(id);
      if (!existing) continue;
      if (incoming.style && typeof incoming.style === 'object') {
        existing.style = { ...(existing.style || {}), ...incoming.style };
      }
      if (incoming.type !== undefined) existing.type = incoming.type;
      if (incoming.animated !== undefined) existing.animated = incoming.animated;
      if (incoming.selected !== undefined) existing.selected = incoming.selected;
      if (incoming.labelX !== undefined) existing.labelX = incoming.labelX;
      if (incoming.labelY !== undefined) existing.labelY = incoming.labelY;
      if (incoming.data && typeof incoming.data === 'object') {
        existing.data = { ...(existing.data || {}), ...incoming.data };
      }
    }

    this.sendNodes(projectId);
    this.scheduleSave();
    return this.getWorkflowData(projectId);
  }

  /**
   * Delete selected nodes and edges, clean up orphaned edges, and notify watchers
   */
  deleteSelectedItems(projectId, selectedIds) {
    if (!projectId || !Array.isArray(selectedIds) || !selectedIds.length) return null;
    const project = this.projects.get(projectId);
    if (!project) return null;

    const getNodeId = (n) => String(n?.id ?? n?.nodeId ?? '');
    const getEdgeId = (e) => String(e?.id ?? '');
    const getEndpointId = (value) => {
      if (value && typeof value === 'object') return String(value.id ?? value.nodeId ?? '');
      return String(value ?? '');
    };

    // Separate nodeIds by finding which selectedIds correspond to nodes
    const nodeIds = new Set();
    const edgeIds = new Set();
    
    for (const id of selectedIds) {
      const idStr = String(id);
      const isNode = (project.nodes || []).some(n => getNodeId(n) === idStr);
      if (isNode) {
        nodeIds.add(idStr);
      } else {
        edgeIds.add(idStr);
      }
    }

    // Step 1: Remove selected nodes and edges
    let newNodes = (project.nodes || []).filter(n => !nodeIds.has(getNodeId(n)));
    let newEdges = (project.edges || []).filter(e => !edgeIds.has(getEdgeId(e)));

    // Step 2: Remove edges connected to deleted nodes
    const edgesBeforeNodeCascade = newEdges.length;
    newEdges = newEdges.filter(e => {
      const source = getEndpointId(e.source ?? e.from);
      const target = getEndpointId(e.target ?? e.to);
      const isConnected = nodeIds.has(source) || nodeIds.has(target);
      if (isConnected) {
        console.log(`[ProjectManager] Removing edge ${e.id} connected to deleted node`);
      }
      return !isConnected;
    });

    // Step 3: Clean up orphaned edges (edges with invalid source/target in this workflow)
    const existingNodeIds = new Set(newNodes.map((n) => getNodeId(n)).filter(Boolean));
    const originalEdgeCount = newEdges.length;
    newEdges = newEdges.filter(e => {
      const source = getEndpointId(e.source ?? e.from);
      const target = getEndpointId(e.target ?? e.to);
      const isValid = source && target && existingNodeIds.has(source) && existingNodeIds.has(target);
      if (!isValid) {
        console.log(`[ProjectManager] Removing orphaned edge ${e.id} (source: ${source}, target: ${target})`);
      }
      return isValid;
    });

    const cascadeEdgeCount = edgesBeforeNodeCascade - originalEdgeCount;
    const orphanedCount = originalEdgeCount - newEdges.length;
    project.nodes = newNodes;
    project.edges = newEdges;

    console.log(`[ProjectManager] Deleted ${nodeIds.size} nodes, ${edgeIds.size} selected edges, ${cascadeEdgeCount} connected edges, ${orphanedCount} orphaned edges`);

    this.sendNodes(projectId, 0);
    this.scheduleSave();
    
    return {
      removedNodeIds: Array.from(nodeIds),
      removedEdgeIds: Array.from(edgeIds),
      orphanedEdgeCount: orphanedCount,
      remainingNodes: newNodes,
      remainingEdges: newEdges
    };
  }

  /**
   * Add a single edge to a project's workflow and notify watchers with a lightweight event
   */
  addProjectEdge(projectId, edge) {
    if (!projectId || !edge) return null;
    let project = this.projects.get(projectId);
    if (!project) {
      // create empty project so edge can be added
      project = this.loadProject(projectId, [], [], [], 1000);
    }

    // normalize edge object
    const id = String(edge.id || `edge_${Date.now()}`);
    const normalized = {
      id,
      source: String(edge.source || edge.from || ''),
      target: String(edge.target || edge.to || ''),
      label: edge.label || '',
      sourceHandle: edge.sourceHandle !== undefined ? edge.sourceHandle : undefined,
      targetHandle: edge.targetHandle !== undefined ? edge.targetHandle : undefined,
      type: edge.type || edge.edgeType || 'next'
    };

    // prevent duplicate id
    project.edges = Array.isArray(project.edges) ? project.edges : [];
    if (!project.edges.find(e => String(e.id) === String(normalized.id))) {
      project.edges.push(normalized);
    } else {
      // replace existing
      project.edges = project.edges.map(e => String(e.id) === String(normalized.id) ? normalized : e);
    }

    // Persist minimal changes
    this.scheduleSave();

    // Notify watchers with a lightweight edge-only event
    this.broadcastToProject(projectId, 'sendEdge', { projectId, edge: normalized });

    return normalized;
  }

  /**
   * Update a single node's properties (e.g. label, nodeLabel, description) and notify watchers
   */
  updateNode(projectId, nodeId, updates = {}) {
    if (!projectId || !nodeId) return null;
    const project = this.projects.get(projectId);
    if (!project) return null;

    project.nodes = Array.isArray(project.nodes) ? project.nodes : [];
    const nodeIndex = project.nodes.findIndex(n => String(n.id) === String(nodeId));
    if (nodeIndex === -1) return null;

    const node = project.nodes[nodeIndex];
    const data = { ...(node.data || {}) };

    console.log('[Update Label]', projectId, nodeId, updates );

    // Apply updates to node.data (single source of truth)
    // Handle both top-level updates (e.g., updates.fnString) and updates.data (e.g., updates.data.fnString)
    
    // Merge from top-level updates (backward compatibility)
    if (updates.labelText !== undefined) data.labelText = updates.labelText;
    if (updates.label !== undefined) data.label = updates.label;
    if (updates.nodeLabel !== undefined) data.nodeLabel = updates.nodeLabel;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.fnString !== undefined) data.fnString = updates.fnString; // fnString is canonical in data only
    
    // Merge from updates.data if provided (preferred format, takes precedence)
    if (updates.data && typeof updates.data === 'object') {
      for (const [k, v] of Object.entries(updates.data)) {
        // avoid overwriting with undefined
        if (v === undefined) continue;
        data[k] = v;
      }
    }

    project.nodes[nodeIndex] = { ...node, data };

    // Persist changes immediately (500ms delay for label/description updates)
    this.scheduleSave(500);

    // Notify watchers with a lightweight node-update event
    this.broadcastToProject(projectId, 'node_updated', {
      projectId,
      nodeId,
      updates,
      updatedData: data
    });

    return project.nodes[nodeIndex];
  }

  /**
   * Broadcast workflow nodes/edges to project watchers (debounced, default 500ms).
   */
  sendNodes(projectId, delayMs = 500) {
    const project = this.projects.get(projectId);
    if (!project) return;

    const currentTimer = this.sendNodesTimers.get(projectId);
    if (currentTimer) clearTimeout(currentTimer);

    const timer = setTimeout(() => {
      this.sendNodesTimers.delete(projectId);
      const latest = this.projects.get(projectId);
      if (!latest) return;
      const payload = {
        projectId,
        workflowId: projectId,
        nodes: latest.nodes || [],
        edges: latest.edges || []
      };
      this.broadcastToProject(projectId, 'sendNodes', payload);
      this.broadcastToProject(projectId, 'workflow_updated', payload);
    }, Math.max(0, Number(delayMs) || 0));

    this.sendNodesTimers.set(projectId, timer);
  }

  /**
   * Broadcast all workflow statuses to ALL clients.
   */
  sendAllWorkflowStatus() {
    const statuses = this.getAllWorkflowStatus();
    this.broadcastToAllClients('sendAllWorkflowStatus', statuses);
    const legacyStatuses = {};
    for (const item of statuses) {
      legacyStatuses[item.id] = item.runningStatus ? 'running' : 'stopped';
    }
    this.broadcastToAllClients('all_project_statuses', legacyStatuses);
  }

  /**
   * Update project status (run/stop)
   */
  setProjectStatus(projectId, status) {
    const project = this.projects.get(projectId);
    if (!project) return;

    const oldStatus = project.status;
    project.status = status;
    //console.log(`[ProjectManager] setProjectStatus: ${projectId} ${oldStatus} -> ${status}`);

    // Broadcast to ALL clients, not just watchers
    this.broadcastToAllClients('project_status_change', {
      projectId,
      status
    });
  }

  /**
   * Update project execution state (activeNode, storeVars, etc.)
   * 這個不會改變 project status，只更新執行細節
   */
  updateProjectState(projectId, updates) {
    const project = this.projects.get(projectId);
    if (!project) return;

    Object.assign(project, updates);

    // 只廣播執行狀態，不包含 status
    this.broadcastToProject(projectId, 'execution_state', {
      projectId,
      ...updates
    });

    // During execution, keep all tabs updated with workflow runtime status snapshots
    this.sendAllWorkflowStatus();
  }

  /**
   * Broadcast event to ALL connected clients (regardless of what they're watching)
   */
  broadcastToAllClients(event, data) {
    //console.log(`[ProjectManager] Broadcasting ${event} to ALL ${this.clients.size} clients:`, data);

    for (const [clientId, client] of this.clients.entries()) {
      if (client && client.socket) {
        client.socket.emit(event, data);
      }
    }
  }

  /**
   * Broadcast event to all clients watching a project
   */
  broadcastToProject(projectId, event, data) {
    const watchers = this.projectWatchers.get(projectId);
    if (!watchers) {
      //console.log(`[ProjectManager] No watchers for project ${projectId}, cannot broadcast ${event}`);
      return;
    }

    //console.log(`[ProjectManager] Broadcasting ${event} to ${watchers.size} watchers of project ${projectId}:`, data);

    for (const clientId of watchers) {
      const client = this.clients.get(clientId);
      if (client && client.socket) {
        client.socket.emit(event, data);
        //console.log(`[ProjectManager] Sent ${event} to client ${clientId}`);
      } else {
        //console.log(`[ProjectManager] Client ${clientId} not found or socket missing`);
      }
    }
  }

  /**
   * Get project state
   */
  getProject(projectId) {
    return this.projects.get(projectId);
  }

  /**
   * Get all project statuses (projectId -> status)
   */
  getAllProjectStatuses() {
    const statuses = {};
    for (const [projectId, project] of this.projects.entries()) {
      statuses[projectId] = project.status || 'stopped';
    }
    return statuses;
  }

  /**
   * Start the execution loop that continuously checks and runs projects
   */
  startExecutionLoop() {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
    }

    // Check every 500ms for projects that need to be executed
    this.executionInterval = setInterval(() => {
      this.checkAndExecuteProjects();
    }, 500);

    //console.log('[ProjectManager] Execution loop started');
  }

  /**
   * Check all projects and execute those with status 'running'
   */
  checkAndExecuteProjects() {
    for (const [projectId, project] of this.projects.entries()) {
      if (project.status === 'running') {
        const runInfo = this.runningProjects.get(projectId);
        
        // If not already executing, start execution
        if (!runInfo || !runInfo.executing) {
          this.executeProject(projectId);
        }
      } else if (project.status === 'stopped') {
        // If project is stopped but still in runningProjects, abort it
        const runInfo = this.runningProjects.get(projectId);
        if (runInfo && runInfo.executing) {
          //console.log(`[ProjectManager] checkAndExecuteProjects: marking abort for ${projectId}, runInfo before:`, runInfo);
          runInfo.abort = true;
          this.runningProjects.delete(projectId);
          //console.log(`[ProjectManager] checkAndExecuteProjects: deleted runInfo for ${projectId}`);
          this.log(`Aborted project: ${projectId}`);
        }
      }
    }
  }

  /**
   * Execute a project workflow
   */
  async executeProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project || project.status !== 'running') return;

    // Mark as executing and store waitResolvers container
    const waitResolvers = {};
    this.runningProjects.set(projectId, { executing: true, abort: false, waitResolvers });
    //console.log(`[ProjectManager] executeProject: created runInfo for ${projectId}`, this.runningProjects.get(projectId));
    this.log(`Starting execution: ${projectId}`);

    // Fetch categoryId for this project early so broadcast knows it
    let categoryId = null;
    try {
      const rule = db.prepare('SELECT category_id FROM rules WHERE id = ? LIMIT 1').get(projectId);
      if (rule && rule.category_id) {
        categoryId = rule.category_id;
        console.log(`[ProjectManager] 📍 Fetched categoryId for project ${projectId}: ${categoryId}`);
      } else {
        console.warn(`[ProjectManager] ⚠️ No categoryId found for project ${projectId}`);
      }
    } catch (e) {
      console.warn(`[ProjectManager] ❌ Failed to fetch categoryId:`, e.message);
    }

    try {
      // Read customStartNodeId if set (for forced jump or initial node override)
      const startNodeId = project.customStartNodeId || null;
      if (startNodeId) {
        console.log(`[ProjectManager] Starting workflow from custom node: ${startNodeId}`);
      }

      // Execute workflow with broadcasting capability
      await executeWorkflow({
        projectId,
        // pass getter functions so executeWorkflow can read latest nodes/edges during run
        nodes: () => this.projects.get(projectId)?.nodes || [],
        edges: () => this.projects.get(projectId)?.edges || [],
        apis: () => this.projects.get(projectId)?.apis || [],
        stepDelay: project.stepDelay || 1000,
        initialStoreVars: project.storeVars || {},
        startNodeId: startNodeId,
        waitResolvers: waitResolvers,
        broadcastCallback: (event, data) => {
          // Special handling for clientJS events
          if (event === 'client_js_exec') {
            console.log(`[ProjectManager] 📤 Broadcasting clientJS (categoryId: ${categoryId || 'NONE'})`);
            
            // 1. Broadcast to all clients with matching categoryId (if categoryId exists)
            if (categoryId) {
              console.log(`[ProjectManager]    - Sending to category watchers`);
              this.broadcastToProjectCategory(categoryId, event, { projectId, ...data });
            }
            
            // 2. ALSO broadcast to project watchers (editor/executor always gets their own clientJS)
            console.log(`[ProjectManager]    - Also sending to project watchers`);
            this.broadcastToProject(projectId, event, { projectId, ...data });
          } else {
            // For other events, use the standard project broadcast (to watchers of this specific project)
            this.broadcastToProject(projectId, event, { projectId, ...data });
          }
        },
        updateStateCallback: (updates) => {
          this.updateProjectState(projectId, updates);
        },
        checkAbort: () => {
          const runInfo = this.runningProjects.get(projectId);
          const val = runInfo ? runInfo.abort : true;
          if (val) console.log(`[ProjectManager] checkAbort() => ${val} for ${projectId}`, runInfo);
          return val;
        }
      });

      //console.log(`[ProjectManager] Completed execution: ${projectId}`);
    } catch (err) {
      //console.error(`[ProjectManager] Execution error for ${projectId}:`, err);
    } finally {
      // Clean up running state
      this.runningProjects.delete(projectId);
      
      // Set project status to stopped (broadcasts to ALL clients)
      const currentProject = this.projects.get(projectId);
      if (currentProject) {
        currentProject.activeNodeId = null;
        currentProject.activeEdgeId = null;
        // Clear customStartNodeId after execution completes
        delete currentProject.customStartNodeId;
        
        // Use setProjectStatus to broadcast to all clients
        this.setProjectStatus(projectId, 'stopped');
        
        // Also broadcast workflow_complete to watchers
        this.broadcastToProject(projectId, 'workflow_complete', { projectId });
      }
    }
  }

  /**
   * Request project to start (sets status to 'running')
   */
  startProject(projectId, nodes, edges, apis, stepDelay) {
    let project = this.projects.get(projectId);
    if (!project) {
      project = this.loadProject(projectId, nodes || [], edges || [], apis || [], stepDelay || 1000);
    } else {
      if (apis) project.apis = apis;
      if (stepDelay) project.stepDelay = stepDelay;
    }
    
    if (project.status === 'running') {
      //console.log(`[ProjectManager] Project ${projectId} already running, re-broadcasting status`);
      // Still broadcast to ensure all clients get the status
      this.setProjectStatus(projectId, 'running');
      return;
    }

    // Use setProjectStatus to broadcast to all clients
    this.setProjectStatus(projectId, 'running');
    //console.log(`[ProjectManager] Project ${projectId} status set to running and broadcasted to all clients`);
  }

  /**
   * Request project to stop (sets status to 'stopped')
   */
  stopProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project) return;

    // Mark for abort
    const runInfo = this.runningProjects.get(projectId);
    if (runInfo) {
      //console.log(`[ProjectManager] stopProject called: set runInfo.abort=true for ${projectId}, runInfo before:`, runInfo);
      runInfo.abort = true;
      //console.log(`[ProjectManager] stopProject: runInfo after:`, runInfo);
    }

    // Use setProjectStatus to broadcast to all clients
    this.setProjectStatus(projectId, 'stopped');
    //console.log(`[ProjectManager] Project ${projectId} stopped and broadcasted to all clients`);
  }

  /**
   * Find workflow by name (case-insensitive)
   * Returns { projectId, project } or null
   */
  findWorkflowByName(name) {
    if (!name) return null;
    const searchName = String(name).toLowerCase().trim();
    
    for (const [projectId, project] of this.projects.entries()) {
      const projectName = String(project.name || '').toLowerCase().trim();
      if (projectName === searchName) {
        return { projectId, project };
      }
    }
    return null;
  }

  /**
   * Find node by label within a project
   * Returns node object or null
   */
  findNodeByLabel(projectId, label) {
    const project = this.projects.get(projectId);
    if (!project || !Array.isArray(project.nodes)) return null;
    
    const searchLabel = String(label).toLowerCase().trim();
    return project.nodes.find(n => {
      const nodeLabel = String(n.data?.nodeLabel || '').toLowerCase().trim();
      return nodeLabel === searchLabel;
    }) || null;
  }

  /**
   * Set waiting_wait state for a workflow
   * @param {string} projectId - The workflow/project ID
   * @param {boolean} waitingState - true to pause, false to resume
   */
  setWaitingState(projectId, waitingState) {
    console.log(`[ProjectManager] setWaitingState called for ${projectId} with state: ${waitingState}`);
    const project = this.projects.get(projectId);
    if (!project) {

      console.error(`[ProjectManager] Project not found ${projectId} not found`);
      return { 
            success: false, error: 'Project not found' 
          };

    }else{
      console.log(`[ProjectManager] Current project storeVars:`, project.storeVars);
    }

    
    // Update storeVars with namespaced key
    const waitKey = `${projectId}__waiting_wait`;
    console.log(`[ProjectManager] setWaitingState: ${projectId}(${project.storeVars[waitKey]}) -> ${waitingState}`);
    if (!project.storeVars) project.storeVars = {};
    project.storeVars[waitKey] = waitingState;
    
    // Also set non-namespaced key for backward compatibility
    project.storeVars['waiting_wait'] = waitingState;

    // Broadcast state update to watchers
    this.broadcastToProject(projectId, 'store_vars_update', {
      projectId,
      storeVars: project.storeVars
    });

    // If resuming (waitingState = false), trigger waitResolvers to resume execution
    let activeRun = false;
    let resolvedCount = 0;
    
    if (!waitingState) {
      const runInfo = this.runningProjects.get(projectId);
      activeRun = !!runInfo && !!runInfo.executing;
      if (runInfo && runInfo.waitResolvers) {
        resolvedCount = Object.keys(runInfo.waitResolvers).length;
        console.log(`[ProjectManager] Resuming workflow ${projectId}, waitResolvers keys:`, Object.keys(runInfo.waitResolvers));
        // Resolve all waiting promises
        for (const [nodeId, resolver] of Object.entries(runInfo.waitResolvers)) {
          if (typeof resolver === 'function') {
            try {
              resolver();
              console.log(`[ProjectManager] Resolved wait for node ${nodeId}`);
            } catch (e) {
              console.error(`[ProjectManager] Error resolving wait for node ${nodeId}:`, e);
            }
          }
        }
        // Clear resolvers after resuming
        runInfo.waitResolvers = {};
      } else {
        console.log(`[ProjectManager] No active waitResolvers found for ${projectId}`);
      }
    }

    return {
      success: true,
      waiting_wait: waitingState,
      activeRun,
      resolvedCount,
      canResume: waitingState ? true : (resolvedCount > 0)
    };
  }

  /**
   * Force jump to a specific node (abort current execution, clear wait flags, restart from nodeId)
   * Used for /trigger/:workflowName/:nodeLabel when workflow is already running
   */
  async forceJumpToNode(projectId, nodeId) {
    const project = this.projects.get(projectId);
    if (!project) return { success: false, error: 'Project not found' };

    console.log(`[ProjectManager] Force jump: ${projectId} -> node ${nodeId}`);
    // If the project is currently running, enqueue the desired jump
    const runInfo = this.runningProjects.get(projectId);
    if (runInfo && runInfo.executing) {
      // Place queued node id into the shared waitResolvers object so the runner can see it
      try {
        if (!runInfo.waitResolvers) runInfo.waitResolvers = {};
        runInfo.waitResolvers.__queued_next_node = String(nodeId);
      } catch (e) { /* ignore */ }

      // Also set it into project.storeVars (namespaced + non-namespaced) so clients can observe
      const queuedKey = `${projectId}__queued_next_node`;
      if (!project.storeVars) project.storeVars = {};
      project.storeVars[queuedKey] = String(nodeId);
      project.storeVars['queued_next_node'] = String(nodeId);

      // Broadcast update to watchers
      this.broadcastToProject(projectId, 'store_vars_update', { projectId, storeVars: project.storeVars });

      // If runner is currently waiting, nudge it by resolving any wait resolvers so it can check the queue
      if (runInfo.waitResolvers) {
        for (const [nid, resolver] of Object.entries(runInfo.waitResolvers)) {
          if (nid === '__queued_next_node') continue;
          if (typeof resolver === 'function') {
            try { resolver(); } catch (e) { /* ignore */ }
          }
        }
      }

      console.log(`[ProjectManager] Enqueued jump for ${projectId} -> ${nodeId}`);
      return { success: true, queued: true, nodeId };
    }

    // If not running, fall back to previous behavior: set customStartNodeId and restart
    // 1. Clear waiting_wait flag (namespaced key)
    const waitKey = `${projectId}__waiting_wait`;
    if (project.storeVars && project.storeVars[waitKey]) {
      project.storeVars[waitKey] = false;
      console.log(`[ProjectManager] Cleared ${waitKey}`);
    }

    // 2. Small delay to let any running tear-down proceed
    await new Promise(resolve => setTimeout(resolve, 150));

    // 3. Set customStartNodeId and restart
    project.customStartNodeId = nodeId;
    this.setProjectStatus(projectId, 'stopped');
    await new Promise(resolve => setTimeout(resolve, 50));
    this.startProject(projectId, project.nodes, project.edges, project.apis, project.stepDelay);

    return { success: true, queued: false, nodeId };
  }
}

export default new ProjectManager();

