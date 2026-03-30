import React from 'react';

const NodeDetailsModal = ({
  selectedNodeDetails,
  setSelectedNodeDetails,
  addActionToNode,
  actionLinkSelections,
  setActionLinkSelections,
  visibleRuleIndices,
  ruleNames,
  rulePrompts,
  functionsList,
  openActionRule,
  createOwnRuleForAction,
  linkActionToRule,
  deleteActionFromNode,
  updateActionOnNode,
  updateNodeDetails,
  projectIdForRun
}) => {
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState('');
  
  if (!selectedNodeDetails) return null;

  // ===== NEW: Save all node details to server =====
  const handleSaveNodeDetails = async () => {
    try {
      if (!projectIdForRun) {
        setSaveMessage('Error: No project ID available');
        setTimeout(() => setSaveMessage(''), 3000);
        return;
      }

      setIsSaving(true);
      const updates = {
        labelText: selectedNodeDetails.data?.labelText || selectedNodeDetails.data?.label || '',
        nodeLabel: selectedNodeDetails.data?.nodeLabel || '',
        description: selectedNodeDetails.data?.description || ''
      };

      const response = await fetch('http://localhost:3001/updatenode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedNodeDetails.id,
          projectId: projectIdForRun,
          ...updates
        })
      });

      const result = await response.json();
      if (result.success) {
        setSaveMessage('✓ Saved successfully');
        setTimeout(() => setSaveMessage(''), 2000);
      } else {
        setSaveMessage('✗ Save failed: ' + (result.error || 'Unknown error'));
        setTimeout(() => setSaveMessage(''), 3000);
      }
    } catch (err) {
      console.error('[handleSaveNodeDetails] Error:', err);
      setSaveMessage('✗ Error: ' + err.message);
      setTimeout(() => setSaveMessage(''), 3000);
    } finally {
      setIsSaving(false);
    }
  };
  // ===== END NEW FUNCTION =====

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10002,
        backdropFilter: 'blur(2px)'
      }}
      onClick={() => setSelectedNodeDetails(null)}
    >
      <div
        id="popup-node-details"
        style={{
          background: '#0b1220',
          border: '2px solid #7dd3fc',
          borderRadius: 8,
          padding: 20,
          maxWidth: 720,
          width: '90%',
          maxHeight: '80%',
          overflow: 'auto',
          color: '#e5e7eb',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div 
        id="node-basic-details"
        style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12}}>
          <div style={{flex:1, marginRight:12}}>
            <div style={{fontSize:'0.8rem', color:'#9ca3af', marginBottom:4}}>Node Name</div>
            <input
              id="nodeName"
              type="text"
              value={selectedNodeDetails.data?.labelText || selectedNodeDetails.data?.label || ''}
              onChange={(e) => setSelectedNodeDetails((s) => ({ ...s, data: { ...(s.data || {}), labelText: e.target.value, label: e.target.value } }))}
              placeholder="Node Name"
              style={{width:'100%', padding:8, borderRadius:6, border:'1px solid #334155', background:'#021827', color:'#e5e7eb', boxSizing: 'border-box'}}
            />
            <div style={{fontSize:'0.8rem', color:'#9ca3af', marginBottom:4, marginTop:8}}>Node Label (optional)</div>
            <input
              id="nodeLabel"
              type="text"
              value={selectedNodeDetails.data?.nodeLabel || ''}
              onChange={(e) => setSelectedNodeDetails((s) => ({ ...s, data: { ...(s.data || {}), nodeLabel: e.target.value } }))}
              placeholder="Short label (shown in workflow)"
              style={{width:'100%', padding:8, borderRadius:6, border:'1px solid #334155', background:'#021827', color:'#e5e7eb', boxSizing: 'border-box'}}
            />
            <textarea
              id="nodeDescription"
              rows={2}
              value={selectedNodeDetails.data?.description || ''}
              onChange={(e) => setSelectedNodeDetails((s) => ({ ...s, data: { ...(s.data || {}), description: e.target.value } }))}
              placeholder="Node description"
              style={{width:'100%', marginTop:8, padding:8, borderRadius:6, border:'1px solid #334155', background:'#021827', color:'#e5e7eb', boxSizing: 'border-box'}}
            />
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:8, alignItems:'flex-end'}}>
            <button onClick={() => setSelectedNodeDetails(null)} style={{background:'#3b82f6', border:'none', color:'#e5e7eb', fontSize:20, cursor:'pointer', padding:'4px 8px', borderRadius:4}}>x</button>
            <button 
              onClick={handleSaveNodeDetails} 
              disabled={isSaving}
              style={{
                background: isSaving ? '#475569' : '#10b981',
                border:'none', 
                color:'#e5e7eb', 
                padding:'8px 16px',
                borderRadius:6,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                fontSize:'0.9rem',
                fontWeight:'600'
              }}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            {saveMessage && (
              <div style={{fontSize:'0.85rem', color: saveMessage.includes('✓') ? '#10b981' : '#ef4444', marginTop:4}}>
                {saveMessage}
              </div>
            )}
          </div>
        </div>

        <div 
        style={{background:'#021827', padding:14, borderRadius:10, border:'1px solid #11333d'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
            <h4 style={{margin:0}}>Actions ({(selectedNodeDetails.data?.actions||[]).length})</h4>
            <div style={{display:'flex', gap:8}}>
              <button onClick={(e) => { e.stopPropagation(); addActionToNode(selectedNodeDetails.id); }} className="btn-primary" style={{padding:'6px 10px', fontSize:'0.85rem'}}>New Action</button>
            </div>
          </div>

          {(selectedNodeDetails.data?.actions||[]).length === 0 ? (
            <div style={{color:'#94a3b8'}}>No actions defined for this node.</div>
          ) : (
            <div style={{display:'grid', gap:10}}>
              {(selectedNodeDetails.data.actions || []).map((a, idx) => {
                const key = `${selectedNodeDetails.id}_${idx}`;
                let defaultRuleIdx = '';
                const linkedId = (typeof a === 'string') ? null : (a.linkedRuleId || null);
                const linked = (typeof a === 'string') ? null : (a.linkedFunctionName || null);
                if (linkedId && functionsList && functionsList.length) {
                  const found = functionsList.findIndex((f) => String(f.id || '') === String(linkedId));
                  if (found >= 0) defaultRuleIdx = String(found);
                }
                if (defaultRuleIdx === '' && linked && functionsList && functionsList.length) {
                  const found = functionsList.findIndex((f) => (f.name || '').toLowerCase() === String(linked).toLowerCase());
                  if (found >= 0) defaultRuleIdx = String(found);
                }
                const selVal = actionLinkSelections[key] !== undefined ? actionLinkSelections[key] : defaultRuleIdx;
                const currentAction = (selectedNodeDetails.data?.actions || [])[idx] || a;
                return (
                  <div key={idx} style={{display:'flex', gap:12, padding:12, borderRadius:8, background:'#041827', border:'1px solid #0f1724', alignItems:'flex-start'}}>
                    <div style={{flex:1, minWidth:0}}>
                      <input
                        type="text"
                        value={currentAction.action || ''}
                        onChange={(e) => setSelectedNodeDetails((s) => {
                          const actionsArr = Array.isArray(s.data?.actions) ? s.data.actions.slice() : [];
                          while (actionsArr.length <= idx) actionsArr.push({});
                          actionsArr[idx] = { ...(typeof actionsArr[idx] === 'string' ? { action: actionsArr[idx] } : (actionsArr[idx] || {})), action: e.target.value };
                          return { ...s, data: { ...(s.data || {}), actions: actionsArr } };
                        })}
                        onBlur={() => updateActionOnNode(selectedNodeDetails.id, idx, { action: ((selectedNodeDetails.data?.actions || [])[idx]?.action) || '' })}
                        placeholder="Action name"
                        style={{width:'100%', padding:8, borderRadius:6, border:'1px solid #263544', background:'#021827', color:'#e5e7eb', boxSizing: 'border-box'}}
                      />
                      <textarea
                        rows={2}
                        value={currentAction.notes || ''}
                        onChange={(e) => setSelectedNodeDetails((s) => {
                          const actionsArr = Array.isArray(s.data?.actions) ? s.data.actions.slice() : [];
                          while (actionsArr.length <= idx) actionsArr.push({});
                          actionsArr[idx] = { ...(typeof actionsArr[idx] === 'string' ? { action: actionsArr[idx] } : (actionsArr[idx] || {})), notes: e.target.value };
                          return { ...s, data: { ...(s.data || {}), actions: actionsArr } };
                        })}
                        onBlur={() => updateActionOnNode(selectedNodeDetails.id, idx, { notes: ((selectedNodeDetails.data?.actions || [])[idx]?.notes) || '' })}
                        placeholder="Notes / description"
                        style={{width:'100%', marginTop:8, padding:8, borderRadius:6, border:'1px solid #263544', background:'#021827', color:'#cbd5e1', boxSizing: 'border-box'}}
                      />
                    </div>
                    <div style={{width:220, display:'flex', flexDirection:'column', gap:8}}>
                      <select value={selVal} onChange={(e) => setActionLinkSelections((s) => ({...s, [key]: e.target.value}))} style={{padding:8, borderRadius:6, border:'1px solid #263544', background:'#021827', color:'#e5e7eb', boxSizing: 'border-box'}}>
                        <option value="">(link to existing)</option>
                        {visibleRuleIndices.map((ridx) => (
                          <option key={ridx} value={ridx}>{(ruleNames[ridx] && ruleNames[ridx] !== '') ? ruleNames[ridx] : (rulePrompts[ridx] || `Rule ${ridx+1}`)}</option>
                        ))}
                      </select>
                        <div style={{display:'flex', gap:8}}>
                          <button onClick={(e) => { e.stopPropagation(); openActionRule(a); }} className="btn-primary" style={{padding:'6px 8px', fontSize:'0.85rem'}}>Open</button>
                          <button onClick={(e) => { e.stopPropagation(); const v = actionLinkSelections[key] !== undefined ? actionLinkSelections[key] : defaultRuleIdx; console.log('Action Link clicked', { selectedRuleIdx: v, nodeId: selectedNodeDetails && selectedNodeDetails.id, actionIdx: idx, action: a }); linkActionToRule(v === '' ? -1 : Number(v), selectedNodeDetails.id, idx); }} className="btn-secondary" style={{padding:'6px 8px', fontSize:'0.85rem'}}>Link</button>
                          <button onClick={(e) => { e.stopPropagation(); createOwnRuleForAction(a, selectedNodeDetails.id, idx); }} className="btn-secondary" style={{padding:'6px 8px', fontSize:'0.85rem'}}>Create</button>
                          <button onClick={(e) => { e.stopPropagation(); if (window.confirm && !window.confirm('Delete this action?')) return; deleteActionFromNode(selectedNodeDetails.id, idx); }} className="btn-danger" style={{padding:'6px 8px', fontSize:'0.85rem'}}>Delete</button>
                        </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function updateNodeLabel(selectedNodeDetails, updateActionOnNode) {
  if (!selectedNodeDetails) return;
  // persist label change using updateNodeDetails/updateActionOnNode as in original file
  updateActionOnNode && updateActionOnNode(selectedNodeDetails.id, 0, {});
}

function updateNodeDetails(selectedNodeDetails, updateActionOnNode) {
  if (!selectedNodeDetails) return;
  updateActionOnNode && updateActionOnNode(selectedNodeDetails.id, 0, {});
}

export default NodeDetailsModal;
