/**
 * Project Manager - Manages workflow projects and client subscriptions
 * Coordinates between multiple clients watching the same project
 * Executes projects independently from client connections
 */

import { executeWorkflow } from './workflowRunner.js';
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
    
    // Map: projectId -> { abortController, executing }
    this.runningProjects = new Map();
    
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
            stepDelay: p.stepDelay || 1000
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
          stepDelay: p.stepDelay || 1000
        });
      }
      const out = { savedAt: new Date().toISOString(), projects };
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
    this.clients.set(clientId, { socket, projectId: null });
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
   * Load or create project
   */
  loadProject(projectId, nodes = [], edges = [], apis = [], stepDelay = 1000) {
    if (!this.projects.has(projectId)) {
      this.projects.set(projectId, {
        id: projectId,
        name: projectId,
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
   * Schedule auto-save to runs_store.json (debounced 5 seconds)
   */
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await this.saveToDisk(this.diskSavePath);
        console.log('[ProjectManager] ✓ Auto-saved to runs_store.json');
      } catch (e) {
        console.error('[ProjectManager] ✗ Auto-save failed:', e);
      }
    }, 5000);
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

    project.nodes = Array.isArray(nodes) ? nodes : (project.nodes || []);
    project.edges = Array.isArray(edges) ? edges : (project.edges || []);

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

    // Mark as executing
    this.runningProjects.set(projectId, { executing: true, abort: false });
    //console.log(`[ProjectManager] executeProject: created runInfo for ${projectId}`, this.runningProjects.get(projectId));
    this.log(`Starting execution: ${projectId}`);

    try {
      // Execute workflow with broadcasting capability
      await executeWorkflow({
        projectId,
        // pass getter functions so executeWorkflow can read latest nodes/edges during run
        nodes: () => this.projects.get(projectId)?.nodes || [],
        edges: () => this.projects.get(projectId)?.edges || [],
        apis: () => this.projects.get(projectId)?.apis || [],
        stepDelay: project.stepDelay || 1000,
        initialStoreVars: project.storeVars || {},
        broadcastCallback: (event, data) => {
          this.broadcastToProject(projectId, event, { projectId, ...data });
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
}

export default new ProjectManager();

