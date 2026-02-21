import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export default function useRunDemo({ rfNodes = [], rfEdges = [], stepDelay = 1000, apis = [] } = {}) {
  const [runActive, setRunActive] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [activeEdgeId, setActiveEdgeId] = useState(null);
  const [storeVars, setStoreVars] = useState({});
  const socketRef = useRef(null);
  const [promptProcessing, setPromptProcessing] = useState(false);
  const [promptStatus, setPromptStatus] = useState('');
  const promptCallbackRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    // Only connect once, assuming the backend runs on port 3001
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    socketRef.current = io(backendUrl);

    socketRef.current.on('connect', () => {
      console.log('Socket connected to backend for workflow execution');
    });

    socketRef.current.on('node_start', (data) => {
      setActiveNodeId(data.nodeId);
      setActiveEdgeId(null);
    });

    socketRef.current.on('edge_start', (data) => {
      setActiveEdgeId(data.edgeId);
    });

    socketRef.current.on('store_vars_update', (data) => {
      setStoreVars(data);
    });

    socketRef.current.on('node_wait', (data) => {
      // Dispatch standard event so frontend knows to show "waiting user input" UI
      document.dispatchEvent(new CustomEvent('workflowPaused', {
        detail: { nodeId: data.nodeId, reason: data.reason }
      }));
    });

    socketRef.current.on('node_error', (data) => {
      console.error(`[Backend] Node ${data.nodeId} error:`, data.error);
    });

    socketRef.current.on('node_log', (data) => {
      if (data.level === 'error') {
        console.error(`[backend node ${data.nodeId}]`, ...(data.args || []));
      } else if (data.level === 'warn') {
        console.warn(`[backend node ${data.nodeId}]`, ...(data.args || []));
      } else {
        console.log(`[backend node ${data.nodeId}]`, ...(data.args || []));
      }
    });

    socketRef.current.on('workflow_complete', () => {
      setRunActive(false);
      setActiveNodeId(null);
      setActiveEdgeId(null);
      console.log('Workflow execution completed on backend');
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

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

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

  // Wrapper for manual UI edits to storeVars so they sync with the backend
  const updateStoreVars = (newVarsOrUpdater) => {
    setStoreVars((prev) => {
      const nextVars = typeof newVarsOrUpdater === 'function' ? newVarsOrUpdater(prev) : newVarsOrUpdater;
      // Sync manual changes to the backend runner if it's currently active
      if (socketRef.current) {
        socketRef.current.emit('update_store_vars', nextVars);
      }
      return nextVars;
    });
  };

  // Trigger backend execution
  async function runProject() {
    if (runActive) {
      // Toggle off
      socketRef.current?.emit('stop_workflow');
      setRunActive(false);
      setActiveNodeId(null);
      setActiveEdgeId(null);
      return;
    }

    setRunActive(true);
    // DO NOT clear storeVars so Node.js can start with existing UI variables
    setActiveNodeId(null);
    setActiveEdgeId(null);

    // Filter valid nodes/edges
    const validNodes = (rfNodes || []).filter(n => n.id);
    const validEdges = (rfEdges || []).filter(e => e.id);

    // Send payload to backend with our existing variables
    socketRef.current?.emit('run_workflow', {
      nodes: validNodes,
      edges: validEdges,
      apis: apis,
      stepDelay: stepDelay,
      initialStoreVars: storeVars
    });
  }

  // When the user edits nodes/edges while workflow is running, push updates to backend
  useEffect(() => {
    if (!socketRef.current) return;
    if (!runActive) return;
    try {
      const validNodes = (rfNodes || []).filter(n => n && n.id);
      const validEdges = (rfEdges || []).filter(e => e && e.id);
      socketRef.current.emit('update_workflow', { nodes: validNodes, edges: validEdges });
    } catch (e) { /* ignore */ }
  }, [rfNodes, rfEdges, runActive]);

  // Submit a prompt to the server-side pipeline.
  // onReady(result) is called when 'workflow_ready' fires with { nodes, edges, workflowData, metadata }.
  const submitPrompt = useCallback((nodeId, promptText, apis = [], workflowData = null, onReady) => {
    promptCallbackRef.current = onReady || null;
    socketRef.current?.emit('process_prompt', { nodeId, promptText, apis, workflowData });
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
    promptProcessing,
    promptStatus,
  };
}
