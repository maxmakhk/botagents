import dagre from 'dagre';

export function getLayoutedNodesAndEdges(nodes = [], edges = [], direction = 'TB') {
  // create a fresh graph for each layout run to avoid stale state
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  const rankDir = direction || 'TB';
  let graphConfig = { 
    rankdir: rankDir, 
    ranksep: direction === 'TB' ? 100 : 60,  // 直向層距大啲
    nodesep: direction === 'LR' ? 120 : 60,   // 橫向 node 距大啲
    marginx: 20, marginy: 20 
    };
    console.log('Running auto-layout with config:', graphConfig);
  dagreGraph.setGraph(graphConfig);

  const defaultNodeWidth = 220;
  const defaultNodeHeight = 80;

  // add nodes to dagre with measured or default sizes
  nodes.forEach((node) => {
    const w = (node?.data && node.data.width) ? Number(node.data.width) : defaultNodeWidth;
    const h = (node?.data && node.data.height) ? Number(node.data.height) : defaultNodeHeight;
    dagreGraph.setNode(node.id, { width: Math.max(80, w), height: Math.max(40, h) });
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
    const w = (node?.data && node.data.width) ? Number(node.data.width) : defaultNodeWidth;
    const h = (node?.data && node.data.height) ? Number(node.data.height) : defaultNodeHeight;
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
