import React, { useEffect, useRef, useState } from 'react';
import './runningListFloating.css';

export default function RunningListFloating({ socket, onClose = () => {}, runningFlows = [] }) {
  const nodeRef = useRef(null);
  const [runflows, setRunflows] = useState([]);
  const [pos, setPos] = useState({ right: 20, top: 150 });
  const draggingRef = useRef(null);

  // Use runningFlows from prop instead of maintaining local state
  useEffect(() => {
    // Update from prop when it changes
    setRunflows(runningFlows || []);
  }, [runningFlows]);

  // Listen for workflow_status_update socket events only
  useEffect(() => {
    console.log('🔄 [RunningListFloating] useEffect EXECUTED - socket:', socket);
    if (!socket) {
      console.warn('[RunningListFloating] Socket not available');
      return;
    }
    
    console.log('✅ [RunningListFloating] Socket connected, listening for workflow_status_update. Connected:', socket.connected);

    const handleWorkflowStatusUpdate = (data) => {
      console.log('🔄 [RunningListFloating] Received workflow_status_update (from printWorkflowStatus):', data);
      if (data) {
        // Update the specific runflow with new node information
        setRunflows((prev) => {
          const updated = prev.map((rf) => {
            if (rf.runflowId === data.runflowId) {
              console.log(`   > Updated node for runflow ${data.runflowId.substring(0,12)}: ${data.currentNodeName}`);
              return {
                ...rf,
                currentNodeId: data.currentNodeId,
                currentNodeName: data.currentNodeName,
                currentNodeIndex: data.currentNodeIndex
              };
            }
            return rf;
          });
          return updated;
        });
      }
    };
    
    console.log('   > Registering workflow_status_update listener...');
    socket.on('workflow_status_update', handleWorkflowStatusUpdate);
    
    return () => {
      console.log('🧹 [RunningListFloating] Cleanup: Removing event listeners');
      socket.off('workflow_status_update', handleWorkflowStatusUpdate);
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
    console.log(`🛑 [RunningListFloating] handleStopRunflow called for: ${runflowId}`);
    
    // Immediately remove from list (no real pause feature, just removal)
    setRunflows((prev) => {
      const updated = prev.filter((rf) => rf.runflowId !== runflowId);
      console.log(`   > Removed from local list (Stop action). Remaining: ${updated.length}`);
      return updated;
    });
    
    // Send stop event to server
    if (socket && socket.connected) {
      socket.emit('run.control', { runflowId, event: 'stop', payload: {} });
      console.log(`[RunningListFloating] ✅ Sent run.control stop event to server`);
      console.log(`[RunningListFloating] ✅ Sent run.control stop event to server`);
    } else {
      console.warn(`[RunningListFloating] Socket not connected, stop event not sent`);
    }
  };

  const handleDeleteRunflow = async (runflowId) => {
    try {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const res = await fetch(`${backendUrl}/deleterun/${encodeURIComponent(runflowId)}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`🗑️ [RunningListFloating] Deleted run ${runflowId}`, data);
        setRunflows((prev) => {
          const updated = prev.filter((rf) => rf.runflowId !== runflowId);
          console.log(`   > Removed from local list (Delete action). Remaining: ${updated.length}`);
          return updated;
        });
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

  const handleRunNextEndpoint = async (runflowId) => {
    console.log(`[RunningListFloating] Requesting NEXT endpoint for runflowId: ${runflowId}`);
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    try {
      const res = await fetch(`${backendUrl}/next/${encodeURIComponent(runflowId)}`);
      if (res.ok) {
        const data = await res.json();
        console.log('[RunningListFloating] Next(EndPoint) response:', data);
      } else {
        console.warn('[RunningListFloating] Next(EndPoint) failed', res.status);
      }
    } catch (e) {
      console.error('[RunningListFloating] Next(EndPoint) error', e);
    }
  };

  const handleGoToNodeByLabel = async (runflowId) => {
    // Prompt user for node label
    const nodeLabel = prompt('Enter node label to jump to:');
    if (!nodeLabel) return;

    console.log(`[RunningListFloating] Requesting go_to_node endpoint: runflowId=${runflowId}, nodeLabel=${nodeLabel}`);
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    try {
      const res = await fetch(`${backendUrl}/go/${encodeURIComponent(runflowId)}/${encodeURIComponent(nodeLabel)}`);
      if (res.ok) {
        const data = await res.json();
        console.log('[RunningListFloating] Go to node response:', data);
        alert(`Jumped to node: ${data.nodeLabel}`);
      } else {
        const errorData = await res.json();
        console.warn('[RunningListFloating] Go to node failed:', errorData);
        alert(`Error: ${errorData.error}`);
      }
    } catch (e) {
      console.error('[RunningListFloating] Go to node error', e);
      alert(`Error: ${e.message}`);
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
      id="running-list-floating"
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
                <th>RunflowID / StartedAt</th>
                <th>WorkflowID / Category</th>
                <th>Node</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {runflows.map((rf) => (
                <tr key={rf.runflowId} className={`running-list-row status-${rf.status}`}>
                  <td className="running-list-id" title={rf.runflowId}>
                    {rf.runflowId.substring(0, 12)}<br/>{formatTime(rf.startedAt)}
                  </td>
                  <td title={rf.workflowId}>{rf.workflowId}<br/>{rf.categoryId || rf.projectId || '-'}</td>
                  <td title={rf.currentNodeName || rf.currentNodeId} className="running-list-node">
                    <div style={{display:'flex', alignItems:'center', gap:'6px'}}>
                      {(() => {
                        const hash = String(rf.runflowId || '').split('').reduce((h, c) => h + c.charCodeAt(0), 0);
                        const colors = ['#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#f97316', '#06b6d4', '#ef4444'];
                        const color = colors[hash % colors.length];
                        return (
                          <div style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: color,
                            flexShrink: 0
                          }} title={`Indicator: ${rf.runflowId.substring(0, 8)}...`} />
                        );
                      })()}
                      {rf.currentNodeName ? (
                        <span>{rf.currentNodeName} <small style={{opacity:0.7}}><br/>{String(rf.currentNodeId || '').substring(0,8)}... ({rf.currentNodeIndex && rf.currentNodeIndex > 0 ? rf.currentNodeIndex : '-'})</small> </span>
                      ) : (
                        <span style={{opacity:0.7}}>—</span>
                      )}
                    </div>
                  </td>
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
                      className="runNextEndpointBtn"
                      title="Next"
                      onClick={() => handleRunNextEndpoint(rf.runflowId)}
                      style={{ marginLeft: 6 }}
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
