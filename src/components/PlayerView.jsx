import React, { useEffect, useRef, useState } from 'react';
import useRunDemo from '../features/variableManager/hooks/useRunDemo';

export default function PlayerView({ onBack }) {
  const { socketRef, allWorkflows, setGlobalVar, globalStoreVars, storeVars } = useRunDemo();
  const [lines, setLines] = useState([]);
  const containerRef = useRef(null);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const currentProjectIdRef = useRef(currentProjectId);

  useEffect(() => { currentProjectIdRef.current = currentProjectId; }, [currentProjectId]);

  useEffect(() => {
    const push = (obj) => setLines((prev) => [...prev, { ts: Date.now(), ...obj }]);

    const attach = () => {
      const s = socketRef?.current;
      if (!s) return;

      const onClientJS = (data) => {
        // only capture events that include clientJS payload
        if (!data) return;
        // try common locations for client JS code
        const code = data.clientJS || data.clientJs || data.client_code || (data.payload && (data.payload.clientJS || data.payload.clientJs));
        if (!code || typeof code !== 'string' || !code.trim()) return;

        // optionally filter by project if payload contains projectId/workflowId
        const pid = data?.projectId || data?.workflowId || data?.project || (data.payload && data.payload.projectId) || null;
        if (pid && currentProjectIdRef.current && String(pid) !== String(currentProjectIdRef.current)) return;

        const nodeId = data.nodeId || data.node_id || (data.payload && data.payload.nodeId) || null;
        const nodeName = data.nodeName || data.node_name || (data.payload && data.payload.nodeName) || null;

        // Execute client JS in a controlled wrapper. Provide helpers similar to runtime.
        const getGlobalVar = (key) => {
          try { return (globalStoreVars || {})[key]; } catch (e) { return undefined; }
        };
        const setGlobalVarForClientJS = (key, value) => {
          try {
            if (!key) throw new Error('Key required');
            // call the hook's setGlobalVar (may return a Promise)
            try { setGlobalVar(key, value); } catch (e) { /* ignore */ }
            return true;
          } catch (e) { return false; }
        };

        try {
          const fn = new Function('setGlobalVar', 'getGlobalVar', 'globalStoreVars', 'storeVars', code);
          // execute; don't capture/print source — only log execution
          fn(setGlobalVarForClientJS, getGlobalVar, globalStoreVars || {}, storeVars || {});
          push({ type: 'client_js_exec', data: { nodeId, nodeName, message: 'executed' } });
        } catch (e) {
          push({ type: 'client_js_exec_error', data: { nodeId, nodeName, error: String(e) } });
        }
      };

      s.on('client_js_exec', onClientJS);

      // cleanup
      return () => {
        try { s.off('client_js_exec', onClientJS); } catch (e) {}
      };
    };

    let cleanupFn = null;
    if (socketRef && socketRef.current) {
      cleanupFn = attach();
    }

    const onConnect = () => {
      if (cleanupFn) return;
      cleanupFn = attach();
    };

    try { socketRef?.current?.on('connect', onConnect); } catch (e) {}

    return () => {
      try { socketRef?.current?.off('connect', onConnect); } catch (e) {}
      if (typeof cleanupFn === 'function') cleanupFn();
    };
  }, [socketRef]);

  // emit watch/unwatch when currentProjectId changes
  useEffect(() => {
    const s = socketRef?.current;
    if (!s) return;
    let previous = null;
    try {
      previous = currentProjectIdRef.current;
    } catch (e) { previous = null; }

    // unwatch previous
    if (previous) {
      try { s.emit('unwatch_project', { projectId: previous }); } catch (e) {}
    }

    if (currentProjectId) {
      try {
        s.emit('watch_project', { projectId: currentProjectId });
        setLines((prev) => [...prev, { ts: Date.now(), type: 'info', data: `Watching project ${currentProjectId}` }]);
      } catch (e) {}
    }

    return () => {
      try { if (currentProjectId) s.emit('unwatch_project', { projectId: currentProjectId }); } catch (e) {}
    };
  }, [currentProjectId, socketRef]);

  useEffect(() => {
    // auto-scroll to bottom when new lines arrive
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const onSelectProject = (ev) => {
    const id = ev?.target?.value || null;
    setCurrentProjectId(id || null);
  };

  return (
    <div style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
      <div style={{padding: 8, display:'flex', gap:8, alignItems:'center'}}>
        <button onClick={onBack}>Back</button>
        <div style={{marginLeft:16}}>
          <label style={{marginRight:8}}>Project:</label>
          <select value={currentProjectId || ''} onChange={onSelectProject}>
            <option value="">-- Select project --</option>
            {(allWorkflows || []).map((w) => (
              <option key={String(w.id)} value={String(w.id)}>{w.name || w.id} ({w.nodeNumber || 0} nodes)</option>
            ))}
          </select>
        </div>
      </div>
      <div id="ms-apiresults-body" ref={containerRef} >
      </div>
    </div>
  );
}
