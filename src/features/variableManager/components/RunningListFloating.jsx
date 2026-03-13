import React, { useEffect, useRef, useState } from 'react';
import './runningListFloating.css';

export default function RunningListFloating({ socket, onClose = () => {} }) {
  const nodeRef = useRef(null);
  const [runflows, setRunflows] = useState([]);
  const [pos, setPos] = useState({ right: 20, top: 150 });
  const draggingRef = useRef(null);

  // Fetch initial running list
  useEffect(() => {
    const fetchRunlist = async () => {
      try {
        const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const res = await fetch(`${backendUrl}/api/run/list`);
        if (res.ok) {
          const data = await res.json();
          console.log('[RunningListFloating] Fetched runflows:', data.runflows);
          setRunflows(data.runflows || []);
        } else {
          console.warn('[RunningListFloating] Failed to fetch runflows, status:', res.status);
        }
      } catch (e) {
        console.error('[RunningListFloating] Failed to fetch runflows:', e);
      }
    };
    
    fetchRunlist();
  }, []);

  // Listen for running_list_update socket events
  useEffect(() => {
    if (!socket) {
      console.warn('[RunningListFloating] Socket not available');
      return;
    }
    
    console.log('[RunningListFloating] Socket connected, listening for updates. Connected:', socket.connected);
    
    const handleRunningListUpdate = (data) => {
      console.log('[RunningListFloating] Received running_list_update:', data);
      if (data && data.runflows) {
        setRunflows(data.runflows);
      }
    };
    
    socket.on('running_list_update', handleRunningListUpdate);
    
    return () => {
      socket.off('running_list_update', handleRunningListUpdate);
    };
  }, [socket]);

  // Handle Escape key
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Cleanup dragging listeners on unmount
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        try {
          if (draggingRef.current.onMove) window.removeEventListener('mousemove', draggingRef.current.onMove);
          if (draggingRef.current.onUp) window.removeEventListener('mouseup', draggingRef.current.onUp);
          if (draggingRef.current.onMove) window.removeEventListener('touchmove', draggingRef.current.onMove);
          if (draggingRef.current.onUp) window.removeEventListener('touchend', draggingRef.current.onUp);
        } catch (e) {}
      }
      document.body.style.userSelect = '';
    };
  }, []);

  const handleMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRight = pos.right;
    const startTop = pos.top;
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const clientX = ev.clientX != null ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX);
      const clientY = ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY);
      if (clientX == null || clientY == null) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      const newRight = Math.max(0, Math.round(startRight - dx));
      const newTop = Math.max(0, Math.round(startTop + dy));
      setPos({ right: newRight, top: newTop });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      draggingRef.current = null;
      document.body.style.userSelect = '';
    };

    draggingRef.current = { onMove, onUp };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
  };

  const handleStopRunflow = (runflowId) => {
    console.log(`[RunningListFloating] Stopping runflowId: ${runflowId}`);
    
    // Immediately remove from list (no real pause feature, just removal)
    setRunflows((prev) => {
      const updated = prev.filter((rf) => rf.runflowId !== runflowId);
      console.log(`[RunningListFloating] Removed runflowId from list. Remaining: ${updated.length}`);
      return updated;
    });
    
    // Send stop event to server
    if (socket && socket.connected) {
      socket.emit('run.control', { runflowId, event: 'stop', payload: {} });
      console.log(`[RunningListFloating] ✅ Sent run.control stop event to server`);
    } else {
      console.warn(`[RunningListFloating] Socket not connected, stop event not sent`);
    }
  };

  const handleDeleteRunflow = async (runflowId) => {
    try {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const res = await fetch(`${backendUrl}/api/run/${encodeURIComponent(runflowId)}`, { method: 'DELETE' });
      if (res.ok) {
        console.log(`[RunningListFloating] Deleted run ${runflowId}`);
        setRunflows((prev) => prev.filter((rf) => rf.runflowId !== runflowId));
      } else {
        console.warn('[RunningListFloating] Failed to delete runflow', runflowId, res.status);
      }
    } catch (e) {
      console.error('[RunningListFloating] Error deleting runflow:', e);
    }
  };

  const handleRunNext = (runflowId) => {
    console.log(`[RunningListFloating] Requesting next for runflowId: ${runflowId}`);
    if (socket && socket.connected) {
      // server expects `runId` and `event` fields
      socket.emit('run.control', { runId: runflowId, event: 'next', payload: {} });
      console.log('[RunningListFloating] ✅ Sent run.control next event to server');
    } else {
      console.warn('[RunningListFloating] Socket not connected, next event not sent');
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString();
    } catch (e) {
      return isoString;
    }
  };


  return (
    <div 
      ref={nodeRef}
      className="running-list-floating"
      style={{ right: `${pos.right}px`, top: `${pos.top}px` }}
    >
      <div 
        className="running-list-header"
        onMouseDown={handleMouseDown}
        onTouchStart={handleMouseDown}
      >
        <span>Running Flows ({runflows.length})</span>
        <button className="running-list-close-btn" onClick={onClose}>✕</button>
      </div>
      
      <div className="running-list-content">
        {runflows.length === 0 ? (
          <div className="running-list-empty">No running flows</div>
        ) : (
          <table className="running-list-table">
            <thead>
              <tr>
                <th>RunflowID</th>
                <th>WorkflowID</th>
                <th>ProjectID</th>
                <th>Node</th>
                <th>Index</th>
                <th>Status</th>
                <th>StartedAt</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {runflows.map((rf) => (
                <tr key={rf.runflowId} className={`running-list-row status-${rf.status}`}>
                  <td className="running-list-id" title={rf.runflowId}>
                    {rf.runflowId.substring(0, 12)}...
                  </td>
                  <td title={rf.workflowId}>{rf.workflowId}</td>
                  <td title={rf.projectId}>{rf.projectId}</td>
                  <td title={rf.currentNodeName || rf.currentNodeId} className="running-list-node">
                    {rf.currentNodeName ? (
                      <span>{rf.currentNodeName} <small style={{opacity:0.7}}>({String(rf.currentNodeId || '').substring(0,8)}...)</small></span>
                    ) : (
                      <span style={{opacity:0.7}}>—</span>
                    )}
                  </td>
                  <td className="running-list-node-index">{rf.currentNodeIndex && rf.currentNodeIndex > 0 ? rf.currentNodeIndex : '-'}</td>
                  <td className={`running-list-status status-${rf.status}`}>
                    <span className="status-badge">{rf.status}</span>
                  </td>
                  <td className="running-list-time">{formatTime(rf.startedAt)}</td>
                  <td className="running-list-action">
                    {rf.status === 'running' && (
                      <button 
                        className="running-list-stop-btn"
                        onClick={() => handleStopRunflow(rf.runflowId)}
                        title="Stop this runflow"
                      >
                        Stop
                      </button>
                    )}
                    <button
                      className="running-list-delete-btn"
                      onClick={() => handleDeleteRunflow(rf.runflowId)}
                      title="Delete this runflow from server"
                    >
                      Delete
                    </button>

                    <button
                      className="runNextBtn"
                      title="Next Node"
                      onClick={() => handleRunNext(rf.runflowId)}
                    >
                      Next
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
