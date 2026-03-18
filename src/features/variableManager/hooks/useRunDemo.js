import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * useRunDemo Hook - Observer mode for workflow execution
 * 
 * Architecture:
 * - Node.js server runs projects independently (continues even if clients disconnect)
 * - Client is an OBSERVER: watches project state and receives updates
 * - When client enters workflow, it retrieves current project progress
 * - Run/Stop controls only set project status on server, don't directly trigger execution
 * - Server's execution loop continuously checks and runs projects with 'running' status
 */
export default function useRunDemo({ rfNodes = [], rfEdges = [], stepDelay = 1000, apis = [], projectId = null } = {}) {
  const [runActive, setRunActive] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [activeEdgeId, setActiveEdgeId] = useState(null);
  const [storeVars, setStoreVars] = useState({});
  const [globalStoreVars, setGlobalStoreVars] = useState({});
  const [allProjectStatuses, setAllProjectStatuses] = useState({}); // projectId -> 'running' | 'stopped'
  const [allWorkflows, setAllWorkflows] = useState([]); // full workflow list from server (id,name,nodeNumber,edgeNumber,runningStatus)
  const [runningFlows, setRunningFlows] = useState([]); // centralized running flows list for UI indicators
  const socketRef = useRef(null);
  const runIdRef = useRef(null);
  const [promptProcessing, setPromptProcessing] = useState(false);
  const [promptStatus, setPromptStatus] = useState('');
  const promptCallbackRef = useRef(null);
  const projectIdRef = useRef(projectId || null);
  const [currentProjectId, setCurrentProjectId] = useState(projectId);
  const storeVarsRef = useRef(storeVars);
  const globalStoreVarsRef = useRef(globalStoreVars);
  const hasSyncedWorkflowRef = useRef(new Set());
  const hasReceivedAllWorkflowsRef = useRef(false);

  useEffect(() => {
    storeVarsRef.current = storeVars;
  }, [storeVars]);

  useEffect(() => {
    globalStoreVarsRef.current = globalStoreVars;
  }, [globalStoreVars]);

  // Initialize socket connection
  useEffect(() => {
    // Only connect once, assuming the backend runs on port 3001
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    socketRef.current = io(backendUrl);

    socketRef.current.on('connect', () => {
      console.log('Socket connected to backend for workflow execution');
      
      // Watch current project immediately after connection
      if (currentProjectId) {
        console.log(`[ProjectSync] Watching project on connect: ${currentProjectId}`);
        socketRef.current.emit('watch_project', { projectId: currentProjectId });
      }
      // Server already emits the full workflow list on connect; no need to request it here
    });

    // Expose socket on window for debugging & UI helpers (cleaned up on disconnect)
    try {
      if (typeof window !== 'undefined') {
        window.socket = socketRef.current;
        window.ioSocket = socketRef.current;
      }
    } catch (e) { /* ignore */ }

    // Socket lifecycle debug logs
    socketRef.current.on('disconnect', (reason) => {
      try {
        console.warn('[CLIENT SOCKET] disconnected:', reason, 'socketId=', socketRef.current?.id);
      } catch (e) { console.warn('[CLIENT SOCKET] disconnect handler error', e); }
    });

    socketRef.current.on('connect_error', (err) => {
      console.error('[CLIENT SOCKET] connect_error', err);
    });

    socketRef.current.on('reconnect_attempt', (attempt) => {
      console.log('[CLIENT SOCKET] reconnect_attempt', attempt);
    });

    socketRef.current.on('reconnect', (attempt) => {
      console.log('[CLIENT SOCKET] reconnect successful after attempts:', attempt);
    });

    socketRef.current.on('reconnect_failed', () => {
      console.error('[CLIENT SOCKET] reconnect_failed');
    });

    // Receive ALL project statuses on connection
    socketRef.current.on('all_project_statuses', (statuses) => {
      try {
        //console.log('📋 [CLIENT] Received all project statuses:', statuses);
        setAllProjectStatuses(statuses || {});
        // Update cached allWorkflows runningStatus flags based on statuses map
        if (Array.isArray(allWorkflows) && statuses && Object.keys(statuses).length) {
          setAllWorkflows((prev) => (prev || []).map((w) => {
            if (!w || !w.id) return w;
            const s = statuses[String(w.id)];
            return { ...w, runningStatus: s === 'running' };
          }));
        }
      } catch (e) { console.error('[CLIENT] all_project_statuses handler error', e); }
    });

    // New status payload format: [{ id, name, nodeNumber, edgeNumber, runningStatus }]
    socketRef.current.on('sendAllWorkflowStatus', (statusList) => {
      try {
        //console.log('[CLIENT] Received sendAllWorkflowStatus payload:', statusList);
        if (!Array.isArray(statusList)) return;

        // If we've already loaded the full list once, ignore subsequent
        // non-runtime updates. Allow runtime updates (when any workflow is running).
        const hasRunning = (statusList || []).some(i => !!(i && i.runningStatus));
        if (hasReceivedAllWorkflowsRef.current && !hasRunning) {
          return;
        }

        // keep full list for UI (project/workflow lists)
        setAllWorkflows(statusList || []);
        const mapped = statusList.reduce((acc, item) => {
          if (!item || !item.id) return acc;
          acc[item.id] = item.runningStatus ? 'running' : 'stopped';
          return acc;
        }, {});
        setAllProjectStatuses((prev) => ({ ...(prev || {}), ...mapped }));
        hasReceivedAllWorkflowsRef.current = true;
      } catch (e) { console.error('[CLIENT] sendAllWorkflowStatus handler error', e); }
    });

    // Receive GLOBAL project status changes (sent to all clients)
    socketRef.current.on('project_status_change', (data) => {
      try {
        console.log('🔔 [CLIENT] Project status changed:', data);
        const { projectId: changedProjectId, status } = data || {};
        if (changedProjectId) {
          setAllProjectStatuses((prev) => ({
            ...prev,
            [changedProjectId]: status
          }));

          // Update cached allWorkflows running flag so UI clears the running badge
          setAllWorkflows((prev) => (prev || []).map((w) => {
            if (!w || String(w.id) !== String(changedProjectId)) return w;
            return { ...w, runningStatus: status === 'running' };
          }));

          // Also update runActive if this is the current project
          if (changedProjectId === currentProjectId) {
            if (status === 'running') {
              console.log('🟢 [CLIENT STATUS CHANGE] Current project running, setting runActive to TRUE');
              setRunActive(true);
            } else if (status === 'stopped') {
              console.log('🔴 [CLIENT STATUS CHANGE] Current project stopped, setting runActive to FALSE');
              setRunActive(false);
            }
          }
        }
      } catch (e) { console.error('[CLIENT] project_status_change handler error', e); }
    });

    // Receive project STATUS updates (只更新 run/stop 按鈕狀態)
    socketRef.current.on('project_status', (data) => {
      try {
        console.log('🔵 [CLIENT STATUS UPDATE] Received project_status:', data);
        const pid = data?.projectId || data?.workflowId || null;
        if (pid) {
          // mirror into allWorkflows so UI tab reflects stopped state
          setAllWorkflows((prev) => (prev || []).map((w) => {
            if (!w || String(w.id) !== String(pid)) return w;
            return { ...w, runningStatus: data.status === 'running' };
          }));
        }
        if (data.status === 'running') {
          console.log('🟢 [CLIENT STATUS UPDATE] Setting runActive to TRUE');
          setRunActive(true);
        } else if (data.status === 'stopped') {
          console.log('🔴 [CLIENT STATUS UPDATE] Setting runActive to FALSE');
          setRunActive(false);
        }
      } catch (e) { console.error('[CLIENT] project_status handler error', e); }
    });

    // Receive execution STATE updates (只更新執行細節，不影響按鈕)
    socketRef.current.on('execution_state', (data) => {
      try {
        if (data.activeNodeId !== undefined) setActiveNodeId(data.activeNodeId);
        if (data.activeEdgeId !== undefined) setActiveEdgeId(data.activeEdgeId);
        if (data.storeVars) setStoreVars((prev) => ({ ...(prev || {}), ...(data.storeVars || {}) }));
        if (data.globalStoreVars) setGlobalStoreVars((prev) => ({ ...(prev || {}), ...(data.globalStoreVars || {}) }));
      } catch (e) { /* ignore malformed */ }
    });

    socketRef.current.on('workflow_updated', (data) => {
      console.log('[ProjectSync] Workflow updated by another client');
      // Note: In VariableManager, you could sync rfNodes/rfEdges here if needed
    });

    // New server event: sendNodes (debounced by server after node/edge/workflow changes)
    socketRef.current.on('sendNodes', (data) => {
      try {
        console.log('[CLIENT] Received sendNodes:', data);
        const targetProjectId = data?.projectId || data?.workflowId;
        if (!targetProjectId || targetProjectId !== currentProjectId) return;
        const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
        const edges = Array.isArray(data?.edges) ? data.edges : [];
        document.dispatchEvent(new CustomEvent('workflowNodesUpdated', {
          detail: { projectId: targetProjectId, nodes, edges }
        }));
      } catch (e) { console.error('[CLIENT] sendNodes handler error', e); }
    });

    // Receive single-edge updates from server
    socketRef.current.on('sendEdge', (data) => {
      try {
        console.log('[CLIENT] Received sendEdge:', data);
        const targetProjectId = data?.projectId || data?.workflowId;
        const edge = data?.edge;
        if (!targetProjectId || targetProjectId !== currentProjectId) return;
        if (!edge) return;
        document.dispatchEvent(new CustomEvent('workflowEdgeUpdated', { detail: { projectId: targetProjectId, edge } }));
      } catch (e) { console.error('[CLIENT] sendEdge handler error', e); }
    });

    // Receive single-node updates from server (e.g., label changes)
    socketRef.current.on('node_updated', (data) => {
      try {
        console.log('[CLIENT] Received node_updated:', data);
        const targetProjectId = data?.projectId;
        const nodeId = data?.nodeId;
        const updates = data?.updates || {};
        const updatedData = data?.updatedData || {};
        if (!targetProjectId || targetProjectId !== currentProjectId) return;
        if (!nodeId) return;
        document.dispatchEvent(new CustomEvent('workflowNodeUpdated', {
          detail: { projectId: targetProjectId, nodeId, updates, updatedData }
        }));
      } catch (e) { console.error('[CLIENT] node_updated handler error', e); }
    });

    // Log workflow data responses (new and legacy)
    socketRef.current.on('workflow_data_response', (data) => {
      try {
        console.log('[CLIENT] workflow_data_response received:', data);
      } catch (e) { console.error('[CLIENT] workflow_data_response log error', e); }
    });

    socketRef.current.on('project_workflow_response', (data) => {
      try {
        console.log('[CLIENT] project_workflow_response (legacy) received:', data);
      } catch (e) { console.error('[CLIENT] project_workflow_response log error', e); }
    });

    socketRef.current.on('node_start', (data) => {
      setActiveNodeId(data.nodeId);
      setActiveEdgeId(null);
    });

    socketRef.current.on('edge_start', (data) => {
      setActiveEdgeId(data.edgeId);
    });

    socketRef.current.on('store_vars_update', (data) => {
      try {
        // Always merge incoming storeVars so the client accumulates variables across projects
        const incoming = data && data.storeVars ? data.storeVars : data || {};
        setStoreVars((prev) => ({ ...(prev || {}), ...(incoming || {}) }));
      } catch (e) { /* ignore malformed payloads */ }
    });

    // Global store vars updates (single-layer global store)
    socketRef.current.on('global_store_vars_update', (data) => {
      try {
        // server sends { globalStoreVars: {...} }, extract the inner object
        const incoming = (data && data.globalStoreVars) ? data.globalStoreVars : (data || {});
        setGlobalStoreVars(incoming);
      } catch (e) { /* ignore malformed payloads */ }
    });

    // Centralized listener for running flows updates (used by UI indicators)
    socketRef.current.on('running_list_update', (data) => {
      try {
        //console.log('[useRunDemo] 📥 Received running_list_update:', data?.runflows?.length || 0, 'flows');
        if (data && Array.isArray(data.runflows)) {
          setRunningFlows(data.runflows);
        }
      } catch (e) { 
        console.error('[useRunDemo] running_list_update handler error', e); 
      }
    });

    socketRef.current.on('node_wait', (data) => {
      // Dispatch standard event so frontend knows to show "waiting user input" UI
      document.dispatchEvent(new CustomEvent('workflowPaused', {
        detail: { nodeId: data.nodeId, reason: data.reason }
      }));
    });

    // No REST fallback: rely on server's initial `sendAllWorkflowStatus` emission on connect

    socketRef.current.on('node_error', (data) => {
      console.error(`[Backend] Node ${data.nodeId} error:`, data.error);
    });

    /*
    //socketRef.current.on('node_log', (data) => {
      if (data.level === 'error') {
        console.error(`[backend node ${data.nodeId}]`, ...(data.args || []));
      } else if (data.level === 'warn') {
        console.warn(`[backend node ${data.nodeId}]`, ...(data.args || []));
      } else {
        console.log(`[backend node ${data.nodeId}]`, ...(data.args || []));
      }
    });
    */

    // Receive node/edge deletion updates from server
    socketRef.current.on('nodes_edges_deleted', (data) => {
      try {
        const { projectId: deletedProjectId, removedNodeIds, removedEdgeIds, orphanedEdgeCount, remainingNodes, remainingEdges } = data || {};
        if (!deletedProjectId || String(deletedProjectId) !== String(currentProjectId)) return;

        console.log('[CLIENT] Received nodes_edges_deleted:', {
          removedNodeIds,
          removedEdgeIds,
          orphanedEdgeCount,
          nodesCount: remainingNodes?.length,
          edgesCount: remainingEdges?.length
        });

        document.dispatchEvent(new CustomEvent('workflowNodesEdgesDeleted', {
          detail: {
            projectId: deletedProjectId,
            removedNodeIds,
            removedEdgeIds,
            orphanedEdgeCount,
            remainingNodes,
            remainingEdges
          }
        }));
      } catch (e) { console.error('[CLIENT] nodes_edges_deleted handler error', e); }
    });

    socketRef.current.on('workflow_complete', () => {
      setRunActive(false);
      setActiveNodeId(null);
      setActiveEdgeId(null);
      runIdRef.current = null;
      console.log('Workflow execution completed on backend');
    });

    // server-side run started (created a runId)
    socketRef.current.on('run.started', (data) => {
      try {
        runIdRef.current = data?.runId || null;
        if (runIdRef.current) {
          socketRef.current.emit('run.subscribe', { runId: runIdRef.current });
          setRunActive(true);
        }
      } catch (e) { }
    });

    // generic run events
    socketRef.current.on('run_status', (data) => {
      try {
        console.log('🏃 [CLIENT RUN STATUS] Received run_status:', data);
        if (!data) return;
        if (data.runId) runIdRef.current = data.runId;
        if (data.status === 'running') setRunActive(true);
        else setRunActive(false);
        if (data.currentNodeId) setActiveNodeId(data.currentNodeId);
        if (data.storeVars) setStoreVars((prev) => ({ ...(prev || {}), ...(data.storeVars || {}) }));
      } catch (e) {
        console.error('[CLIENT RUN STATUS] run_status handler error', e);
      }
    });

    // Prompt pipeline progress events
    socketRef.current.on('prompt_processing_start', () => {
      setPromptProcessing(true);
      setPromptStatus('Processing prompt…');
    });

    socketRef.current.on('prompt_normalized', () => {
      setPromptStatus('Generating function…');
    });

    socketRef.current.on('function_generated', () => {
      setPromptStatus('Building workflow…');
    });

    socketRef.current.on('workflow_ready', (data) => {
      setPromptProcessing(false);
      setPromptStatus('');
      if (typeof promptCallbackRef.current === 'function') {
        promptCallbackRef.current(data);
      }
    });

    socketRef.current.on('prompt_error', (data) => {
      setPromptProcessing(false);
      setPromptStatus('');
      console.error('[Prompt pipeline error]', data?.message || data);
    });

    // Execute clientJS immediately when received, without checking OutputView
    socketRef.current.on('client_js_exec', (data) => {
      //console.log(`[useRunDemo] A`, data);
      try {
        if (data && data.clientJS && typeof data.clientJS === 'string') {
          //console.log(`[useRunDemo] B [clientJS]`, data.clientJS);

          const getGlobalVar = (key) => {
            try {
              const k = String(key || '').trim();
              if (!k) return undefined;
              return (globalStoreVarsRef.current || {})[k];
            } catch (e) {
              return undefined;
            }
          };

          const setGlobalVarForClientJS = (key, value) => {
            const k = String(key || '').trim();
            if (!k) throw new Error('Variable key is required');
            if (!socketRef.current || !socketRef.current.connected) {
              throw new Error('Socket not connected');
            }
            socketRef.current.emit('set_global_var', { key: k, value });
            return true;
          };

          // Inject helper functions into clientJS scope so script can call setGlobalVar/getGlobalVar directly
          const fn = new Function(
            'setGlobalVar',
            'getGlobalVar',
            'globalStoreVars',
            'storeVars',
            data.clientJS
          );
          fn(
            setGlobalVarForClientJS,
            getGlobalVar,
            globalStoreVarsRef.current || {},
            storeVarsRef.current || {}
          );
        }
      } catch (e) {
        console.error('[useRunDemo] clientJS execution error:', e);
      }
    });

    return () => {
      try {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
        if (typeof window !== 'undefined') {
          if (window.socket === socketRef.current) window.socket = null;
          if (window.ioSocket === socketRef.current) window.ioSocket = null;
        }
      } catch (e) { }
    };
  }, [currentProjectId]);

  // Watch project when projectId changes
  useEffect(() => {
    if (socketRef.current && socketRef.current.connected && currentProjectId) {
      console.log(`[ProjectSync] Watching project: ${currentProjectId}`);
      socketRef.current.emit('watch_project', { projectId: currentProjectId });
    }
  }, [currentProjectId]);

  // Set up resume listener from frontend UI
  useEffect(() => {
    const resumeHandler = (ev) => {
      const nodeId = ev?.detail?.nodeId;
      if (!nodeId || !socketRef.current) return;

      // Tell backend to resume
      socketRef.current.emit('workflow_resume', { nodeId });
    };

    document.addEventListener('workflowResume', resumeHandler);
    return () => {
      document.removeEventListener('workflowResume', resumeHandler);
    };
  }, []);

  // When projectId changes, query backend run status and auto-subscribe if a run exists
  useEffect(() => {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const pid = projectIdRef.current;
    if (!pid) return;
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/run/status?projectId=${encodeURIComponent(pid)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data) return;
        if (data.runId) {
          runIdRef.current = data.runId;
          // join run room to receive updates
          socketRef.current?.emit('run.subscribe', { runId: data.runId });
          if (data.status === 'running') setRunActive(true);
          if (data.currentNodeId) setActiveNodeId(data.currentNodeId);
          if (data.storeVars) setStoreVars((prev) => ({ ...(prev || {}), ...(data.storeVars || {}) }));
          if (data.globalStoreVars) setGlobalStoreVars((prev) => ({ ...(prev || {}), ...(data.globalStoreVars || {}) }));
        }
      } catch (e) { /* ignore */ }
    })();
  }, []);

  // Wrapper for manual UI edits to storeVars so they sync with the backend
  const updateStoreVars = (newVarsOrUpdater) => {
    setStoreVars((prev) => {
      let nextVars;
      if (typeof newVarsOrUpdater === 'function') {
        nextVars = newVarsOrUpdater(prev);
      } else if (newVarsOrUpdater && typeof newVarsOrUpdater === 'object') {
        // merge incoming object into previous vars
        nextVars = { ...(prev || {}), ...newVarsOrUpdater };
      } else {
        nextVars = newVarsOrUpdater;
      }
      // Sync manual changes to the backend runner if it's currently active
      if (socketRef.current) {
        socketRef.current.emit('update_store_vars', nextVars);
      }
      return nextVars;
    });
  };

// Trigger backend execution
  // Note: This now starts a new runflow via /api/run/start which supports multiple concurrent runs
  async function runProject(nodeLabelName = null, workflowId = null) {
    console.log("[runProject] nodeLabelName:", nodeLabelName, "workflowId:", workflowId);
    
    const validNodes = (rfNodes || []).filter(n => n && n.id);
    const validEdges = (rfEdges || []).filter(e => e && e.id);
    const finalWorkflowId = workflowId || currentProjectId;
    
    try {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      
      // Use /runnew endpoint if nodeLabelName provided, otherwise use /api/run/start
      let response;
      if (nodeLabelName && nodeLabelName.trim()) {
        console.log('[ProjectSync] Calling GET', `${backendUrl}/runnew/${finalWorkflowId}/${encodeURIComponent(nodeLabelName)}`);
        response = await fetch(`${backendUrl}/runnew/${finalWorkflowId}/${encodeURIComponent(nodeLabelName)}`, {
          method: 'GET'
        });
      } else {
        
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[ProjectSync] Request failed with status:', response.status, 'body:', errorText);
        throw new Error(`Failed to start runflow: ${response.statusText}`);
      }
      
      const data = await response.json();
      const newRunflowId = data.runflowId || data.runId;
      const categoryId = data.categoryId;
      
      console.log('[ProjectSync] ✅ Runflow started with ID:', newRunflowId);
      console.log('[ProjectSync] CategoryId from response:', categoryId);
      runIdRef.current = newRunflowId;
      
      // Set client's project category so it receives broadcasts
      if (categoryId && socketRef.current) {
        console.log('[ProjectSync] 🎯 Setting project category to:', categoryId);
        socketRef.current.emit('set_project_category', { projectcategoryId: categoryId });
      }
      
      // Optimistically update UI
      console.log('[ProjectSync] OPTIMISTIC UPDATE: Setting runActive to TRUE');
      setRunActive(true);
      setActiveEdgeId(null);
      
      // Join socket room for this runflow to receive updates
      if (socketRef.current) {
        console.log('[ProjectSync] Emitting join_runflow with runflowId:', newRunflowId);
        socketRef.current.emit('join_runflow', { runflowId: newRunflowId });
      }
      
    } catch (err) {
      console.error('[ProjectSync] ❌ Failed to start runflow:', err);
      setRunActive(false);
      runIdRef.current = null;
    }
  }

  const setProjectId = useCallback((id) => {
    if (projectIdRef.current === id) {
      console.log(`[ProjectSync] Already watching project ${id}, skipping`);
      return; // Already watching this project
    }
    
    // Unwatch old project
    if (projectIdRef.current && socketRef.current) {
      socketRef.current.emit('unwatch_project');
    }
    
    if (runIdRef.current && socketRef.current) {
      socketRef.current.emit('run.unsubscribe', { runId: runIdRef.current });
    }
    
    projectIdRef.current = id;
    setCurrentProjectId(id);
    runIdRef.current = null;
    setRunActive(false);
    setActiveNodeId(null);
    setActiveEdgeId(null);
  }, []);

  // Explicit workflow update method (called only on user actions: move, add, delete nodes)
  const pushWorkflowUpdate = useCallback((nodes, edges) => {
    if (!socketRef.current || !socketRef.current.connected) {
      console.warn('[ProjectSync] Socket not connected, cannot push workflow');
      return;
    }
    if (!currentProjectId) {
      console.warn('[ProjectSync] No projectId set, cannot push workflow');
      return;
    }

    const validNodes = (nodes || []).filter(n => n && n.id);
    const validEdges = (edges || []).filter(e => e && e.id);

    console.log('[ProjectSync] Pushing workflow update to server (nodes:', validNodes.length, 'edges:', validEdges.length, ')');
    socketRef.current.emit('update_project_workflow', {
      projectId: currentProjectId,
      nodes: validNodes,
      edges: validEdges
    });
    hasSyncedWorkflowRef.current.add(currentProjectId);
  }, [currentProjectId]);

  // Submit a prompt to the server-side pipeline.
  // onReady(result) is called when 'workflow_ready' fires with { nodes, edges, workflowData, metadata }.
  const submitPrompt = useCallback((nodeId, promptText, apis = [], workflowData = null, onReady) => {
    promptCallbackRef.current = onReady || null;
    socketRef.current?.emit('process_prompt', { nodeId, promptText, apis, workflowData });
  }, []);

  // Fetch latest workflow from server memory
  const fetchLatestWorkflow = useCallback((projectId) => {
    console.log('fetchLatestWorkflow start')
    return new Promise((resolve, reject) => {
      console.log('[fetchLatestWorkflow] Will fetch workflow for project:', projectId, 'socketId=', socketRef.current?.id, 'connected=', !!socketRef.current?.connected);

      let done = false;
      let timeoutId = null;

      const finish = (value, isError = false) => {
        if (done) return;
        done = true;
        try { if (timeoutId) clearTimeout(timeoutId); } catch (e) {}
        if (isError) reject(value);
        else resolve(value);
      };

      const waitForConnect = () => {
        return new Promise((res, rej) => {
          if (socketRef.current && socketRef.current.connected) return res();
          const onConnect = () => {
            try { socketRef.current?.off('connect', onConnect); } catch (e) {}
            res();
          };
          const t = setTimeout(() => {
            try { socketRef.current?.off('connect', onConnect); } catch (e) {}
            rej(new Error('Socket did not connect in time'));
          }, 3000);
          try { socketRef.current?.on('connect', onConnect); } catch (e) { clearTimeout(t); rej(e); }
        });
      };

      const workflowDataHandler = (data) => {
        if (done) return;
        const receivedId = data?.workflowId || data?.projectId;
        if (String(receivedId || '') !== String(projectId || '')) return;
        console.log('[fetchLatestWorkflow] Received workflow_data_response (handler):', data);
        finish(data?.workflow || null);
      };

      const legacyHandler = (data) => {
        if (done) return;
        if (String(data?.projectId || '') !== String(projectId || '')) return;
        console.log('[fetchLatestWorkflow] Received project_workflow_response (legacy handler):', data);
        finish(data?.workflow || null);
      };

      (async () => {
        try {
          await waitForConnect();
        } catch (e) {
          finish(new Error('[fetchLatestWorkflow] Socket not connected'), true);
          return;
        }

        // Use once listeners to avoid leaking handlers across reconnects
        try {
          socketRef.current.once('workflow_data_response', workflowDataHandler);
          socketRef.current.once('project_workflow_response', legacyHandler);
        } catch (e) {
          try { socketRef.current.on('workflow_data_response', workflowDataHandler); socketRef.current.on('project_workflow_response', legacyHandler); } catch (err) { /* ignore */ }
        }

        try {
          console.log('[fetchLatestWorkflow] Emitting get_workflow_data & get_project_workflow for', projectId, 'socketId=', socketRef.current?.id);
          socketRef.current.emit('get_workflow_data', { workflowId: projectId });
          socketRef.current.emit('get_project_workflow', { projectId });
        } catch (e) {
          console.warn('[fetchLatestWorkflow] Emit failed:', e);
        }

        timeoutId = setTimeout(() => {
          finish(new Error('Timeout fetching workflow'), true);
        }, 8000);
      })();
    });
  }, []);

  // Set global variable on server
  const setGlobalVar = useCallback((key, value) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !socketRef.current.connected) {
        reject(new Error('Socket not connected'));
        return;
      }
      
      if (!key) {
        reject(new Error('Variable key is required'));
        return;
      }
      
      console.log('[setGlobalVar] Setting global var on server:', key, '=', value);
      
      // Set up one-time listener for response
      const responseHandler = (data) => {
        if (data && data.success) {
          console.log('[setGlobalVar] ✓ Global var set on server:', key, '=', value);
          resolve({ success: true, key, value });
        } else {
          console.error('[setGlobalVar] ✗ Failed to set global var:', data?.error);
          reject(new Error(data?.error || 'Failed to set global var'));
        }
      };
      
      socketRef.current.once('set_global_var_result', responseHandler);
      
      // Request to set global var on server
      socketRef.current.emit('set_global_var', { key, value });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        socketRef.current?.off('set_global_var_result', responseHandler);
        reject(new Error('Timeout setting global var'));
      }, 5000);
    });
  }, []);

  return {
    socketRef,
    runProject,
    runActive,
    activeNodeId,
    activeEdgeId,
    storeVars,
    setStoreVars: updateStoreVars, // Export wrapped version
    submitPrompt,
    fetchLatestWorkflow,
    pushWorkflowUpdate,
    setGlobalVar,
    promptProcessing,
    promptStatus,
    setProjectId,
    allProjectStatuses, // Export global project statuses
    allWorkflows, // full workflow list for UI
    globalStoreVars,
    runningFlows, // centralized running flows for UI indicators
  };
}
