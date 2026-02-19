import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import NodeToolsFloating from './NodeToolsFloating';

// Module-level node component to keep a stable reference for React Flow
const injectedCssMap = new Map();

const ensureInjectedCss = (cssText) => {
  if (!cssText) return;
  try {
    if (injectedCssMap.has(cssText)) return;
    const el = document.createElement('style');
    el.setAttribute('data-vm-api-css', '1');
    el.innerHTML = cssText;
    document.head.appendChild(el);
    injectedCssMap.set(cssText, el);
  } catch (e) {
    // ignore
  }
};

const WorkflowNode = ({ id, data }) => {
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  const onOpenActionRule = data?.onOpenActionRule;
  const onToggleNodeLock = data?.onToggleNodeLock;
  const onNodePromptSubmit = data?.onNodePromptSubmit;
  const onGetRelated = data?.getRelated;
  const rfNodes = data?.rfNodes;
  const rfEdges = data?.rfEdges;
  const activeNodeId = data?.activeNodeId;

  const isEntryNode = !!(data?.metadata?.sourceRuleId || data?.metadata?.entryForRuleId || String(data?.labelText || '').startsWith('Entry:'));
  const isActive = String(id) === String(activeNodeId);
  
  const bgColor = data?.backgroundColor || (isEntryNode ? '#fffbeb' : '#ffffff');
  const textColor = data?.textColor || (isEntryNode ? '#92400e' : '#0f172a');
  let containerStyle = {
    position: 'relative',
    width: 220,
    padding: 10,
    background: isActive ? '#fbbf24' : bgColor,
    color: isActive ? '#1f2937' : textColor,
    borderRadius: 8,
    border: isActive ? '2px solid #f59e0b' : (isEntryNode ? '1px solid #fde68a' : undefined),
    boxShadow: isActive ? '0 0 20px rgba(251, 146, 60, 0.6)' : (isEntryNode ? '0 6px 18px rgba(250,204,21,0.12)' : '0 6px 18px rgba(2,6,23,0.4)'),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center'
  };

  // If API supplied CSS is present, avoid inline background/color/border/boxShadow
  const cssTextPresent = Boolean(data?.metadata?.cssStyle);
  if (cssTextPresent) {
    delete containerStyle.background;
    delete containerStyle.color;
    delete containerStyle.border;
    delete containerStyle.boxShadow;
  }

  const extractActionLabel = (label) => {
    const first = String(label || '').split('\n')[0] || '';
    return first.replace(/^Entry:\s*/i, '').trim();
  };

  const renderActionRow = (a, i) => {
    const actionName = (typeof a === 'string') ? a : (a.action || a.name || 'action');
    const linked = (typeof a === 'string') ? false : (!!(a.linkedRuleId || a.ruleId || a.linkedRuleName || a.name));
    return (
      <div key={`act_${i}`} style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding: '4px 6px', borderRadius:6, background: isEntryNode ? 'rgba(250, 204, 21, 0.04)' : 'transparent', marginTop: i === 0 ? 8 : 6}} onClick={(ev) => ev.stopPropagation()}>
        <div style={{fontSize: '0.85rem', color: isEntryNode ? '#92400e' : '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160}} title={actionName}>{actionName}</div>
        <div style={{display:'flex', gap:6, alignItems:'center'}}>
          {linked && (
            <button
              className="open-linked-rule-btn"
              title="Open linked rule"
              onClick={(ev) => { ev.stopPropagation(); if (typeof onOpenActionRule === 'function') onOpenActionRule(a); }}
              style={{backgroundColor: '#021827', border: 'none', cursor: 'pointer', color: isEntryNode ? '#92400e' : '#0ea5b7', fontSize: 16}}
            >
              🔗
            </button>
          )}
        </div>
      </div>
    );
  };

  const flowInstanceRef = useRef(null);

  const localZoomIn = useCallback(() => {
    try { flowInstanceRef.current?.zoomIn?.(); } catch (e) {}
  }, []);
  const localZoomOut = useCallback(() => {
    try { flowInstanceRef.current?.zoomOut?.(); } catch (e) {}
  }, []);
  const localFitView = useCallback(() => {
    try { flowInstanceRef.current?.fitView?.(); } catch (e) {}
  }, []);

  const handleInit = (inst) => {
    flowInstanceRef.current = inst;
    try { if (typeof onInitFlow === 'function') onInitFlow(inst); } catch (e) {}
  };

  const handleBaseStyle = {
    width: 18,
    height: 18,
    borderRadius: 9,
    border: '2px solid #021827',
    boxShadow: '0 4px 10px rgba(2,6,23,0.5)'
  };

  const imageName = data?.metadata?.image || data?.metadata?.icon;
  const hasIcon = !!imageName;
  let imageUrl = null;
  if (hasIcon) {
    const asStr = String(imageName || '').trim();
    imageUrl = asStr.startsWith('http://') || asStr.startsWith('https://') ? asStr : `https://www.maxsolo.co.uk/images/${asStr}`;
  }

  // Apply CSS from API metadata when present
  const cssText = data?.metadata?.cssStyle;
  useEffect(() => { if (cssText) ensureInjectedCss(cssText); }, [cssText]);

  const extraClass = cssText ? 'api-node' : '';
  const apiIdClass = data?.metadata?.apiId ? `api-node-${String(data.metadata.apiId).replace(/[^a-z0-9_-]/gi, '')}` : '';

  return (
    <div style={containerStyle} className={`entry-btn ${extraClass} ${apiIdClass}`.trim()}>
      {/* lock button + prompt icon top-right */}
      <div style={{position:'absolute', right:8, top:8, display:'flex', gap:6}}>
        <button
          title={data?.locked || data?.metadata?.locked ? 'Unlock node' : 'Lock node'}
          onClick={(ev) => { ev.stopPropagation(); try { if (typeof onToggleNodeLock === 'function') onToggleNodeLock(id); } catch(e){} }}
          style={{backgroundColor:'#021827', border:'none', cursor:'pointer', fontSize:14}}
        >
          {data?.locked || data?.metadata?.locked ? '🔒' : '🔓'}
        </button>
        <PromptButton onNodeId={id} onSubmit={onNodePromptSubmit} onGetRelated={onGetRelated} rfNodes={rfNodes} rfEdges={rfEdges} />
      </div>
      <Handle
        type="target"
        position={Position.Top}
        style={{
          ...handleBaseStyle,
          background: isEntryNode ? '#f59e0b' : '#60a5fa',
          transform: 'translateY(-6px)'
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          ...handleBaseStyle,
          background: isEntryNode ? '#92400e' : '#34d399',
          transform: 'translateY(6px)'
        }}
      />
      <div style={{display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'stretch'}}>
        {hasIcon && (
          <div style={{width: 56, display: 'flex', alignItems: 'stretch'}}>
            <img src={imageUrl} alt="icon" style={{width: 56, height: '100%', objectFit: 'cover', borderRadius: 6}} onError={(e) => { e.target.style.display = 'none'; }} />
          </div>
        )}
        <div style={{textAlign: 'left', flex: 1}}>
        <div style={{fontWeight:700, fontSize:'1rem'}}>{String(data?.labelText || data?.label || 'Step').split('\n')[0]}</div>
        <div style={{fontSize: '0.72rem', color: '#6b7280', marginTop: 4}}>ID: {String(id)}</div>
        {((String(data?.labelText || data?.label || '').split('\n').slice(1).join(' ') || data?.metadata?.ruleId) && (
          <div title={data?.metadata?.ruleId || undefined} style={{fontSize: '0.7rem', color: isEntryNode ? '#92400e' : '#6b7280', marginTop: 6, lineHeight: 1.05, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
            {(String(data?.labelText || data?.label || '').split('\n').slice(1).join(' ') || data?.metadata?.ruleId)}
          </div>
        ))}
      </div>
      </div>
      {actions && actions.length > 0 && (
        <div style={{display: 'flex', flexDirection: 'column', marginTop: 8}}>
          {actions.slice(0, 6).map((a, i) => renderActionRow(a, i))}
          {actions.length > 6 && (
            <div style={{fontSize:'0.75rem', color:'#9ca3af', marginTop:6}}>+{actions.length - 6} more</div>
          )}
        </div>
      )}

    </div>
  );
};

const NODE_TYPES = {
  default: WorkflowNode,
  start: WorkflowNode,
  workflowNode: WorkflowNode,
  api: WorkflowNode,
  action: WorkflowNode,
  loop: WorkflowNode,
  condition: WorkflowNode,
  decision: WorkflowNode,
  parallel: WorkflowNode,
  transform: WorkflowNode,
  end: WorkflowNode
};

// Prompt button + small popup positioned near cursor (top-right)
const PromptButton = ({ onNodeId, onSubmit, onGetRelated, rfNodes, rfEdges }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const handleClick = (ev) => {
    ev.stopPropagation();
    const related = (typeof onGetRelated === 'function') ? onGetRelated(onNodeId) : { relatedNode: [], relatedEdge: [] };
    // compute connected node ids from rfEdges
    const allEdges = Array.isArray(rfEdges) ? rfEdges : [];
    const incomingIds = Array.from(new Set(allEdges.filter((e) => String(e.target) === String(onNodeId)).map((e) => String(e.source))));
    const outgoingIds = Array.from(new Set(allEdges.filter((e) => String(e.source) === String(onNodeId)).map((e) => String(e.target))));
    const connectedNodesIDs = { incoming: incomingIds, outgoing: outgoingIds };

    console.log('Prompt icon clicked - full data:', {
      nodeId: onNodeId,
      related,
      full: {
        nodes: rfNodes || [],
        edges: rfEdges || []
      },
      connectedNodesIDs
    });
    setOpen(true);
  };

  const handleCancel = () => { setOpen(false); setText(''); };

  const handleSubmit = () => {
    try {
      const related = (typeof onGetRelated === 'function') ? onGetRelated(onNodeId) : { relatedNode: [], relatedEdge: [] };
      const allEdges = Array.isArray(rfEdges) ? rfEdges : [];
      const incomingIds = Array.from(new Set(allEdges.filter((e) => String(e.target) === String(onNodeId)).map((e) => String(e.source))));
      const outgoingIds = Array.from(new Set(allEdges.filter((e) => String(e.source) === String(onNodeId)).map((e) => String(e.target))));
      const connectedNodesIDs = { incoming: incomingIds, outgoing: outgoingIds };
      const relatedWithConnected = { ...(related || {}), connectedNodesIDs };
      if (typeof onSubmit === 'function') onSubmit(onNodeId, text, relatedWithConnected);
      else console.log('Prompt submit:', onNodeId, text, relatedWithConnected);
    } catch (e) { console.error(e); }
    setOpen(false);
    setText('');
  };

  return (
    <div>
      <button title="Prompt" onClick={handleClick} style={{backgroundColor:'#021827', border:'none', cursor:'pointer', fontSize:14}}>💬</button>
      {open && (
        <div style={{position:'absolute', left: '50px', top: '-130px', zIndex: 9999, background:'#021827', border:'1px solid #13353b', padding:8, borderRadius:6, minWidth:220}} onClick={(e) => e.stopPropagation()}>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} style={{width:'100%', resize:'none', background:'#071427', color:'#e6f6ff', border:'1px solid #13353b', padding:6, borderRadius:4}} placeholder="Type prompt..." />
          <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:6}}>
            <button className="btn-cancel" onClick={handleCancel}>Close</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={!text.trim()}>Submit</button>
          </div>
        </div>
      )}
    </div>
  );
};

const WorkflowGraph = ({
  rfNodes,
  rfEdges,
  apis = [],
  onAddApiNode,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
  onEdgeDoubleClick,
  onNodeDoubleClick,
  onNodeClick,
  edgeEdit,
  onCommitEdgeLabel,
  cancelEdgeEdit,
  onAddNode,
  onDeleteSelected,
  onGenerateFunction,
  onRun,
  runActive,
  onZoomIn,
  onZoomOut,
  onFitView,
  onInitFlow,
  onOpenActionRule,
  onToggleNodeLock,
  onAutoLayout,
  onNodePromptSubmit,
  selectedCount,
  activeNodeId,
  activeEdgeId,
  aiLoading
}) => {
  const hasNodes = rfNodes && rfNodes.length > 0;

  const [localEdgeText, setLocalEdgeText] = useState('');
  useEffect(() => {
    if (edgeEdit && edgeEdit.label !== undefined) setLocalEdgeText(edgeEdit.label);
    else setLocalEdgeText('');
  }, [edgeEdit]);

  const nodesWithHandlers = useMemo(() => {
    return (rfNodes || []).map((n) => ({
      ...n,
      // make the outer react-flow node wrapper transparent so our inner
      // `data.backgroundColor` shows without a white border/margin
      style: {
        ...(n.style || {}),
        background: 'transparent',
        padding: 0,
        border: 'none',
        boxShadow: 'none'
      },
      data: {
        ...(n.data || {}),
        // ensure actions are available on data.actions whether they were stored
        // on the node as `n.actions` (legacy) or `n.data.actions` (preferred)
        actions: Array.isArray(n.data?.actions) ? n.data.actions : (Array.isArray(n.actions) ? n.actions : n.data?.actions),
        onOpenActionRule,
        onToggleNodeLock,
        onNodePromptSubmit,
        rfNodes,
        rfEdges,
        activeNodeId,
        activeEdgeId,
        // provide a helper to collect related nodes and edges for this node
        getRelated: (nodeId) => {
          const nodesArr = Array.isArray(rfNodes) ? rfNodes : [];
          const edgesArr = Array.isArray(rfEdges) ? rfEdges : [];
          const clicked = nodesArr.find((nn) => String(nn.id) === String(nodeId));
          const relatedEdge = edgesArr.filter((e) => String(e.source) === String(nodeId) || String(e.target) === String(nodeId));
          return { relatedNode: clicked ? [clicked] : [], relatedEdge };
        }
      }
    }));
  }, [rfNodes, rfEdges, onOpenActionRule, onToggleNodeLock, onNodePromptSubmit, activeNodeId, activeEdgeId]);

  const edgesWithHighlight = useMemo(() => {
    return (rfEdges || []).map((e) => {
      const isActive = String(e.id) === String(activeEdgeId);
      
      // Detect backward/cycle edges by checking if target is above or at same level as source
      const sourceNode = (rfNodes || []).find(n => String(n.id) === String(e.source));
      const targetNode = (rfNodes || []).find(n => String(n.id) === String(e.target));
      const isBackwardEdge = sourceNode && targetNode && targetNode.position.y <= sourceNode.position.y;
      
      return {
        ...e,
        type: e.type || 'smoothstep', // Use smoothstep for better curves
        pathOptions: isBackwardEdge ? { offset: 60, borderRadius: 20 } : { borderRadius: 20 }, // Add offset for backward edges
        style: {
          ...(e.style || {}),
          stroke: isActive ? '#f59e0b' : undefined,
          strokeWidth: isActive ? 3 : undefined,
          filter: isActive ? 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.6))' : undefined
        }
      };
    });
  }, [rfEdges, activeEdgeId, rfNodes]);

  // capture React Flow instance for local view controls when parent handlers are not provided
  const flowInstanceRef = useRef(null);
  const localZoomIn = useCallback(() => { try { flowInstanceRef.current?.zoomIn?.(); } catch (e) {} }, []);
  const localZoomOut = useCallback(() => { try { flowInstanceRef.current?.zoomOut?.(); } catch (e) {} }, []);
  const localFitView = useCallback(() => { try { flowInstanceRef.current?.fitView?.(); } catch (e) {} }, []);
  const handleInit = (inst) => { flowInstanceRef.current = inst; try { if (typeof onInitFlow === 'function') onInitFlow(inst); } catch (e) {} };

  return (
    <div style={{marginTop:12, border:'1px solid #1f2937', borderRadius:8, background:'#020817', padding:10}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
        <strong>Task Function &gt; Visual Workflow</strong>
        <div style={{fontSize:'0.85em', color:'#9ca3af'}}>{rfNodes.length} node(s), {rfEdges.length} edge(s)</div>
      </div>
      <div style={{height: 1420, overflow: 'hidden'}}>
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edgesWithHighlight}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeClick={onNodeClick}
          onInit={handleInit}
          zoomOnScroll={false}
          panOnScroll={false}
          defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
        >
          <MiniMap />
          <Background />
        </ReactFlow>
      </div>

      {/* Inline edge label editor (positioned near click) */}
      {typeof edgeEdit !== 'undefined' && edgeEdit && (
        <div style={{position:'fixed', left: edgeEdit.x, top: edgeEdit.y, zIndex: 10000}} onClick={(e) => e.stopPropagation()}>
          <div style={{background:'#021827', border:'1px solid #13353b', padding:8, borderRadius:6, minWidth:220}}>
            <div style={{fontSize:'0.85rem', color:'#9dd3ff', marginBottom:6}}>Edit edge label</div>
            <input autoFocus value={localEdgeText} onChange={(e) => setLocalEdgeText(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); try { if (typeof onCommitEdgeLabel === 'function') onCommitEdgeLabel(edgeEdit.id, localEdgeText); } catch(e){} }
              if (e.key === 'Escape') { try { if (typeof cancelEdgeEdit === 'function') cancelEdgeEdit(); } catch(e){} }
            }} style={{width: '100%', padding:6, borderRadius:4, border:'1px solid #13353b', background:'#071427', color:'#e6f6ff'}} />
            <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:8}}>
              <button className="btn-cancel" onClick={() => { try { if (typeof cancelEdgeEdit === 'function') cancelEdgeEdit(); } catch(e){} }}>Cancel</button>
              <button className="btn-primary" onClick={() => { try { if (typeof onCommitEdgeLabel === 'function') onCommitEdgeLabel(edgeEdit.id, localEdgeText); } catch(e){} }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Floating node tools panel */}
      <NodeToolsFloating
        onAddNode={onAddNode}
        onAutoLayout={onAutoLayout}
        onDeleteSelected={onDeleteSelected}
        onGenerateFunction={onGenerateFunction}
        onRun={onRun}
        runActive={runActive}
        onZoomIn={onZoomIn || localZoomIn}
        onZoomOut={onZoomOut || localZoomOut}
        onFitView={onFitView || localFitView}
        selectedCount={selectedCount}
        hasNodes={hasNodes}
        aiLoading={aiLoading}
        rfNodes={rfNodes}
        rfEdges={rfEdges}
        apis={apis}
        onAddApiNode={onAddApiNode}
      />
    </div>
  );
};

export default WorkflowGraph;
