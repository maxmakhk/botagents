import { useState, useCallback, useRef } from 'react';
import { useNodesState, useEdgesState, addEdge } from 'reactflow';

/**
 * useWorkflowGraph hook
 * Manages React Flow workflow visualization state
 */
export default function useWorkflowGraph({ onEdgeAdd } = {}) {
  // React Flow editable state
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);
  const [rfInstance, setRfInstance] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  // Node/edge editing
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [selectedNodeDetails, setSelectedNodeDetails] = useState(null); // node data for details popup

  // Workflow data management
  const [workflowData, setWorkflowData] = useState(null);
  // layout direction state (TB | LR)
  const [layoutDirection, setLayoutDirection] = useState('TB');

  // References
  const tabSwitchLockRef = useRef(false);

  // Handle new connections
  const onConnect = useCallback(
    (connection) => {
      try {
        const newEdge = {
          id: String(connection.id || `edge_${Date.now()}`),
          source: String(connection.source || ''),
          target: String(connection.target || ''),
          label: connection.label || '',
          sourceHandle: connection.sourceHandle !== undefined ? String(connection.sourceHandle) : undefined,
          targetHandle: connection.targetHandle !== undefined ? String(connection.targetHandle) : undefined,
          type: connection.type || 'next'
        };
        setRfEdges((prev = []) => [...(prev || []), newEdge]);
        if (typeof onEdgeAdd === 'function') {
          try { onEdgeAdd(newEdge); } catch (e) { /* ignore */ }
        }
        try {
          document.dispatchEvent(new CustomEvent('workflowEdgeCreated', { detail: { edge: newEdge } }));
        } catch (e) { /* ignore */ }
      } catch (e) {
        // fallback to reactflow addEdge
        try { setRfEdges((edges) => addEdge(connection, edges)); } catch (err) { console.error('onConnect failed', err); }
      }
    },
    [setRfEdges, onEdgeAdd]
  );

  // Handle selection changes
  const onSelectionChange = useCallback(({ nodes, edges }) => {
    const nodeIds = Array.isArray(nodes) ? nodes.map((n) => String(n.id)) : [];
    const edgeIds = Array.isArray(edges) ? edges.map((e) => String(e.id)) : [];
    const ids = [...nodeIds, ...edgeIds];
    setSelectedIds(ids);
  }, []);

  // Handle double-click on edge
  const [edgeEdit, setEdgeEdit] = useState(null); // { id, x, y, label }

  const onEdgeDoubleClick = useCallback((evt, edge) => {
    try {
      const rectX = (evt && evt.clientX) ? evt.clientX : 0;
      const rectY = (evt && evt.clientY) ? evt.clientY : 0;
      setEdgeEdit({ id: String(edge.id), x: rectX, y: rectY, label: edge.label || '' });
    } catch (e) {
      console.log('Edge double-clicked (fallback):', edge);
      setEdgeEdit({ id: String(edge.id), x: 0, y: 0, label: edge.label || '' });
    }
  }, []);

  const commitEdgeLabel = useCallback((edgeId, newLabel) => {
    setRfEdges((prev = []) => {
      return (prev || []).map((e) => {
        if (String(e.id) === String(edgeId)) {
          return { ...e, label: newLabel };
        }
        return e;
      });
    });
    setEdgeEdit(null);
  }, [setRfEdges]);

  const cancelEdgeEdit = useCallback(() => { setEdgeEdit(null); }, []);

  // Handle double-click on node - DISABLED (use info button instead)
  const onNodeDoubleClick = useCallback((evt, node) => {
    // Check if called from info button (evt is null) or actual double-click (evt exists)
    // If from info button, open details. If from double-click, do nothing.
    if (evt === null) {
      setSelectedNodeDetails(node || null);
    }
  }, []);

  // Handle node click
  const onNodeClick = useCallback((evt, node) => {
    //it is outdated popupbox
    console.log('Node clicked:', node);
    //setSelectedNodeDetails(node || null);
  }, []);

  // Load workflow data into React Flow nodes/edges
  const loadWorkflowIntoFlow = useCallback((workflow) => {
    console.log('Loading workflow into flow:', workflow);
    if (!workflow) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    try {
      const nodes = Array.isArray(workflow.nodes)
        ? workflow.nodes.map((n) => {
            const metadata = n.metadata || (n.data && n.data.metadata) || {};
            const sizeRatio = n?.data?.scale || n?.data?.size || metadata.size || '2:1';
            const [widthRatio, heightRatio] = String(sizeRatio).split(':').map((v) => parseInt(v, 10) || 1);
            const fallbackWidth = widthRatio * 96;
            const fallbackHeight = heightRatio * 96;
            const width = Number(n?.data?.width) || fallbackWidth;
            const height = Number(n?.data?.height) || fallbackHeight;
            const baseStyle = (n.style && typeof n.style === 'object') ? n.style : {};
            
            // Restore labelText and label from n.data first, fallback to n.label or n.id
            const restoredLabelText = n.data?.labelText || n.label || n.id;
            const restoredLabel = n.data?.label || n.label || n.id;
            const restoredFnString = n.data?.fnString || '';
            
            return {
              id: String(n.id),
              position: { x: Number(n?.position?.x ?? 0), y: Number(n?.position?.y ?? 0) },
              type: n.type || 'workflowNode',
              metadata, // Also store at root level for export consistency
              data: {
                labelText: restoredLabelText,
                description: n.description || n.type || '',
                label: restoredLabel,
                nodeLabel: n.data?.nodeLabel || '', // Preserve node label from server
                fnString: restoredFnString,
                actions: Array.isArray(n.actions) ? n.actions : (n.data && Array.isArray(n.data.actions) ? n.data.actions : []),
                metadata,
                backgroundColor: n.backgroundColor || (n.data && n.data.backgroundColor) || undefined,
                textColor: n.textColor || (n.data && n.data.textColor) || undefined,
                width,
                height,
                scale: sizeRatio,
              },
              style: {
                ...baseStyle,
                width,
                height,
                minHeight: height,
              },
            };
          })
        : [];

      if (nodes.length) {
        console.log('Loaded workflow nodes (size info):', nodes.map((n) => ({
          id: n.id,
          scale: n?.data?.scale,
          width: n?.data?.width,
          height: n?.data?.height,
          metadataSize: n?.data?.metadata?.size,
        })));
      }

      const nodeIds = new Set(nodes.map((n) => String(n.id)));
      const edges = Array.isArray(workflow.edges)
        ? workflow.edges
            .map((e, idx) => {
              const rawFrom = e?.from ?? e?.source ?? null;
              const rawTo = e?.to ?? e?.target ?? null;
              const source = rawFrom ? String(rawFrom?.id ?? rawFrom) : '';
              const target = rawTo ? String(rawTo?.id ?? rawTo) : '';
              if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
                console.log(`[Cleanup] Removing orphaned edge during load: ${e.id || `edge_${idx}`} (source: ${source}, target: ${target})`);
                return null;
              }

              const edge = { id: String(e.id || `edge_${idx}`), source, target, label: e.label || '' };
              if (e.sourceHandle !== undefined && e.sourceHandle !== null && String(e.sourceHandle) !== 'undefined' && String(e.sourceHandle) !== '') {
                edge.sourceHandle = String(e.sourceHandle);
              }
              if (e.targetHandle !== undefined && e.targetHandle !== null && String(e.targetHandle) !== 'undefined' && String(e.targetHandle) !== '') {
                edge.targetHandle = String(e.targetHandle);
              }
              // if handles not provided, prefer existing rfEdges handles, otherwise apply defaults based on current layoutDirection
              if (!edge.sourceHandle) {
                const existing = (rfEdges || []).find(re => String(re.id) === String(edge.id));
                if (existing && existing.sourceHandle) {
                  edge.sourceHandle = existing.sourceHandle;
                } else if (layoutDirection === 'LR') {
                  edge.sourceHandle = 'right';
                }
              }
              if (!edge.targetHandle) {
                const existing = (rfEdges || []).find(re => String(re.id) === String(edge.id));
                if (existing && existing.targetHandle) {
                  edge.targetHandle = existing.targetHandle;
                } else if (layoutDirection === 'LR') {
                  edge.targetHandle = 'left';
                }
              }
              return edge;
            })
            .filter(Boolean)
        : [];

      console.log('Loaded workflow nodes:', nodes);
      console.log('Loaded workflow edges:', edges);


      setRfNodes(nodes);
      setRfEdges(edges);
      // store the raw workflow object so callers can access the authoritative flow
      try { setWorkflowData(workflow); } catch (e) { /* ignore */ }
    } catch (err) {
      console.error('Error loading workflow into flow:', err);
    }
  }, [setRfNodes, setRfEdges, layoutDirection]);

  // Export current nodes/edges to workflow format
  const exportWorkflow = useCallback(() => {
    const exportNodes = (rfNodes || []).map((n) => ({
      id: String(n.id),
      type: n.type || 'action',
      label: n.data?.labelText || n.data?.label || String(n.id),
      description: n.data?.description || '',
      position: n.position || { x: 0, y: 0 },
      metadata: n.metadata || n.data?.metadata || {},
      actions: Array.isArray(n.data?.actions) ? n.data.actions : [],
      data: {
        nodeLabel: n.data?.nodeLabel || '',
        fnString: n.data?.fnString || '' // Preserve node fnString when exporting
      }
    }));

    // Create nodeIds set for validation
    const nodeIds = new Set(exportNodes.map(n => String(n.id)));
    
    // Clean up orphaned edges before exporting
    const exportEdges = (rfEdges || [])
      .filter((e) => {
        const source = String(e.source || e.from || '');
        const target = String(e.target || e.to || '');
        const isValid = source && target && nodeIds.has(source) && nodeIds.has(target);
        if (!isValid) {
          console.log(`[Cleanup] Filtering orphaned edge from export: ${e.id} (source: ${source}, target: ${target})`);
        }
        return isValid;
      })
      .map((e) => ({
        id: String(e.id || ''),
        from: String(e.source || e.from || ''),
        to: String(e.target || e.to || ''),
        label: e.label || '',
      }));

    return {
      nodes: exportNodes,
      edges: exportEdges,
    };
  }, [rfNodes, rfEdges]);

  return {
    // React Flow state
    rfNodes,
    setRfNodes,
    onRfNodesChange,
    rfEdges,
    setRfEdges,
    onRfEdgesChange,
    rfInstance,
    setRfInstance,
    selectedIds,
    setSelectedIds,

    // Callbacks
    onConnect,
    onSelectionChange,
    onEdgeDoubleClick,
    onNodeDoubleClick,
    onNodeClick,
    // edge edit helpers
    edgeEdit,
    commitEdgeLabel,
    cancelEdgeEdit,

    // Node/edge editing
    nodeModalOpen,
    setNodeModalOpen,
    selectedNodeDetails,
    setSelectedNodeDetails,

    // Workflow data
    workflowData,
    setWorkflowData,
    loadWorkflowIntoFlow,
    exportWorkflow,
    // layout direction (TB | LR)
    layoutDirection,
    setLayoutDirection,

    // References
    tabSwitchLockRef,
  };
}
