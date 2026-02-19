import dagre from 'dagre';

export function getLayoutedNodesAndEdges(nodes = [], edges = [], direction = 'TB') {
  // create a fresh graph for each layout run to avoid stale state
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  const rankDir = direction || 'TB';
  let graphConfig = { 
    rankdir: rankDir, 
    // increase spacing between ranks and nodes to accommodate larger nodes
    ranksep: direction === 'TB' ? 220 : 120,
    nodesep: direction === 'LR' ? 240 : 120,
    marginx: 40, marginy: 40 
    };
    console.log('Running auto-layout with config:', graphConfig);
  dagreGraph.setGraph(graphConfig);

  // Double default node size to make nodes bigger by default
  const defaultNodeWidth = 440;
  const defaultNodeHeight = 160;

  // add nodes to dagre with measured or default sizes (scale measured sizes to match larger defaults)
  nodes.forEach((node) => {
    const measuredW = (node?.data && node.data.width) ? Number(node.data.width) * 2 : defaultNodeWidth;
    const measuredH = (node?.data && node.data.height) ? Number(node.data.height) * 2 : defaultNodeHeight;
    dagreGraph.setNode(node.id, { width: Math.max(120, measuredW), height: Math.max(80, measuredH) });
  });

  // add edges
  edges.forEach((edge) => {
    try { dagreGraph.setEdge(edge.source, edge.target); } catch (e) { /* ignore bad edges */ }
  });

  // run layout
  try {
    dagre.layout(dagreGraph);
  } catch (err) {
    // layout failed — return original
    return { nodes, edges };
  }

  const layoutedNodes = nodes.map((node) => {
    const n = dagreGraph.node(node.id);
    if (!n) return node;
    const w = (node?.data && node.data.width) ? Number(node.data.width) * 2 : defaultNodeWidth;
    const h = (node?.data && node.data.height) ? Number(node.data.height) * 2 : defaultNodeHeight;
    const position = {
      x: n.x - w / 2,
      y: n.y - h / 2
    };

    return {
      ...node,
      position,
      // keep data intact
      data: { ...(node.data || {}) }
    };
  });

  return { nodes: layoutedNodes, edges };
}

export default getLayoutedNodesAndEdges;
