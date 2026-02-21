/**
 * Project Manager - Manages workflow projects and client subscriptions
 * Coordinates between multiple clients watching the same project
 * Executes projects independently from client connections
 */

import { executeWorkflow } from './workflowRunner.js';

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
    
    // Execution loop interval
    this.executionInterval = null;
  }

  /**
   * Initialize with Socket.IO instance
   */
  init(io) {
    this.io = io;
    this.startExecutionLoop();
    console.log('[ProjectManager] Initialized with execution loop');
  }

  /**
   * Register a client connection
   */
  registerClient(clientId, socket) {
    this.clients.set(clientId, { socket, projectId: null });
    console.log(`[ProjectManager] Client registered: ${clientId}`);
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
    console.log(`[ProjectManager] Client unregistered: ${clientId}`);
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

    console.log(`[ProjectManager] Client ${clientId} watching project ${projectId}`);

    // Send current project state to client
    const project = this.projects.get(projectId);
    if (project) {
      client.socket.emit('project_state', {
        projectId,
        nodes: project.nodes,
        edges: project.edges,
        status: project.status,
        storeVars: project.storeVars,
        activeNodeId: project.activeNodeId,
        activeEdgeId: project.activeEdgeId
      });
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
    console.log(`[ProjectManager] Client ${clientId} unwatched project ${projectId}`);
  }

  /**
   * Load or create project
   */
  loadProject(projectId, nodes = [], edges = [], apis = [], stepDelay = 1000) {
    if (!this.projects.has(projectId)) {
      this.projects.set(projectId, {
        nodes: nodes,
        edges: edges,
        status: 'stopped',
        storeVars: {},
        activeNodeId: null,
        activeEdgeId: null,
        apis: apis,
        stepDelay: stepDelay
      });
      console.log(`[ProjectManager] Project loaded: ${projectId}`);
    } else {
      // Update nodes/edges if provided
      const project = this.projects.get(projectId);
      if (nodes && nodes.length > 0) project.nodes = nodes;
      if (edges && edges.length > 0) project.edges = edges;
      if (apis) project.apis = apis;
      if (stepDelay) project.stepDelay = stepDelay;
    }
    return this.projects.get(projectId);
  }

  /**
   * Update project workflow (nodes/edges)
   */
  updateProjectWorkflow(projectId, nodes, edges) {
    const project = this.projects.get(projectId);
    if (!project) {
      console.warn(`[ProjectManager] Project not found: ${projectId}`);
      return;
    }

    project.nodes = nodes || project.nodes;
    project.edges = edges || project.edges;

    // Broadcast to all watching clients
    this.broadcastToProject(projectId, 'workflow_updated', {
      projectId,
      nodes: project.nodes,
      edges: project.edges
    });
  }

  /**
   * Update project status (run/stop)
   */
  setProjectStatus(projectId, status) {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.status = status;

    this.broadcastToProject(projectId, 'project_status', {
      projectId,
      status
    });
  }

  /**
   * Update project execution state
   */
  updateProjectState(projectId, updates) {
    const project = this.projects.get(projectId);
    if (!project) return;

    Object.assign(project, updates);

    this.broadcastToProject(projectId, 'project_state', {
      projectId,
      ...updates
    });
  }

  /**
   * Broadcast event to all clients watching a project
   */
  broadcastToProject(projectId, event, data) {
    const watchers = this.projectWatchers.get(projectId);
    if (!watchers) return;

    for (const clientId of watchers) {
      const client = this.clients.get(clientId);
      if (client && client.socket) {
        client.socket.emit(event, data);
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

    console.log('[ProjectManager] Execution loop started');
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
          runInfo.abort = true;
          this.runningProjects.delete(projectId);
          console.log(`[ProjectManager] Aborted project: ${projectId}`);
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
    
    console.log(`[ProjectManager] Starting execution: ${projectId}`);

    try {
      // Execute workflow with broadcasting capability
      await executeWorkflow({
        projectId,
        nodes: project.nodes,
        edges: project.edges,
        apis: project.apis || [],
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
          return runInfo ? runInfo.abort : true;
        }
      });

      console.log(`[ProjectManager] Completed execution: ${projectId}`);
    } catch (err) {
      console.error(`[ProjectManager] Execution error for ${projectId}:`, err);
    } finally {
      // Clean up running state
      this.runningProjects.delete(projectId);
      
      // Set project status to stopped
      const currentProject = this.projects.get(projectId);
      if (currentProject) {
        currentProject.status = 'stopped';
        currentProject.activeNodeId = null;
        currentProject.activeEdgeId = null;
        
        this.broadcastToProject(projectId, 'project_status', {
          projectId,
          status: 'stopped'
        });
        
        this.broadcastToProject(projectId, 'workflow_complete', { projectId });
      }
    }
  }

  /**
   * Request project to start (sets status to 'running')
   */
  startProject(projectId, nodes, edges, apis, stepDelay) {
    const project = this.loadProject(projectId, nodes, edges, apis, stepDelay);
    
    if (project.status === 'running') {
      console.log(`[ProjectManager] Project ${projectId} already running`);
      return;
    }

    project.status = 'running';
    console.log(`[ProjectManager] Project ${projectId} status set to running`);

    this.broadcastToProject(projectId, 'project_status', {
      projectId,
      status: 'running'
    });
  }

  /**
   * Request project to stop (sets status to 'stopped')
   */
  stopProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.status = 'stopped';
    console.log(`[ProjectManager] Project ${projectId} status set to stopped`);

    // Mark for abort
    const runInfo = this.runningProjects.get(projectId);
    if (runInfo) {
      runInfo.abort = true;
    }

    this.broadcastToProject(projectId, 'project_status', {
      projectId,
      status: 'stopped'
    });
  }
}

export default new ProjectManager();

