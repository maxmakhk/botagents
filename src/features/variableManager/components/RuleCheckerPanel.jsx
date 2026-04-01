import React, { useEffect, useState } from 'react';

export default function RuleCheckerPanel() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedMainId, setSelectedMainId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const fetchWorkflows = async () => {
    setLoading(true);
    setError(null);
    try {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const res = await fetch(`${backendUrl}/getworkflows/all`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const list = Array.isArray(payload.workflows) ? payload.workflows : [];
      console.log("workflows", list);
      setWorkflows(list);
    } catch (err) {
      console.warn('Failed to fetch workflows:', err);
      setError(String(err));
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  };

  const populateCategories = async () => {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const toFetch = workflows.filter(w => !w.categoryId);
    if (!toFetch.length) return;
    setLoading(true);
    try {
      const concurrency = 5;
      const results = [];
      for (let i = 0; i < toFetch.length; i += concurrency) {
        const batch = toFetch.slice(i, i + concurrency);
        const promises = batch.map(w => fetch(`${backendUrl}/getworkflow/${encodeURIComponent(w.id)}`).then(r => r.ok ? r.json() : { error: `HTTP ${r.status}` }).catch(e => ({ error: String(e) })));
        // await batch
        // eslint-disable-next-line no-await-in-loop
        const batchResults = await Promise.all(promises);
        batchResults.forEach((res, idx) => {
          const wf = batch[idx];
          if (res && res.workflow) {
            const cat = res.workflow.categoryId || res.workflow.category || res.workflow.category_id || null;
            results.push({ id: wf.id, categoryId: cat });
          }
        });
      }

      if (results.length) {
        setWorkflows((prev) => prev.map(w => {
          const found = results.find(r => r.id === w.id);
          return found ? { ...w, categoryId: found.categoryId } : w;
        }));
      }
    } catch (e) {
      console.warn('populateCategories failed', e);
    } finally {
      setLoading(false);
    }
  };

  function splitRuntimesByEdges(nodes, edges) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adj = new Map();

    // 初始化 adjacency list
    nodes.forEach(node => {
      adj.set(node.id, new Set());
    });

    // 建立無向連接關係
    edges.forEach(edge => {
      if (!adj.has(edge.source)) adj.set(edge.source, new Set());
      if (!adj.has(edge.target)) adj.set(edge.target, new Set());

      adj.get(edge.source).add(edge.target);
      adj.get(edge.target).add(edge.source);
    });

    const visited = new Set();
    const runtimes = [];

    for (const node of nodes) {
      if (visited.has(node.id)) continue;

      const queue = [node.id];
      const componentNodeIds = new Set();

      while (queue.length) {
        const current = queue.shift();
        if (visited.has(current)) continue;

        visited.add(current);
        componentNodeIds.add(current);

        for (const next of adj.get(current) || []) {
          if (!visited.has(next)) {
            queue.push(next);
          }
        }
      }

      const runtimeNodes = nodes.filter(n => componentNodeIds.has(n.id));
      const runtimeEdges = edges.filter(
        e => componentNodeIds.has(e.source) && componentNodeIds.has(e.target)
      );

      runtimes.push({
        runtimeId: `runtime_${runtimes.length + 1}`,
        nodes: runtimeNodes,
        edges: runtimeEdges
      });
    }

    return runtimes;
  }

  const fetchWorkflowDetails = async (id) => {
    try {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      console.log(`[Workflow Viewer] Fetching workflow ${id} from ${backendUrl}`);
      const res = await fetch(`${backendUrl}/getworkflow/${encodeURIComponent(id)}`);
      const data = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
      console.log('[getworkflow response]', id, data);
      return data;
    } catch (e) {
      console.warn('fetchWorkflowDetails failed', e);
      return { error: String(e) };
    }
  };

  const combineWorkflows = async () => {
    if (!selectedMainId || !selectedTemplateId) {
      console.warn('[Workflow Combinder] Please select both main and template workflows');
      return;
    }
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    try {
      console.log(`[Workflow Combinder] Fetching main: ${selectedMainId}`);
      const mainResp = await fetch(`${backendUrl}/getworkflow/${encodeURIComponent(selectedMainId)}`);
      const mainData = mainResp.ok ? await mainResp.json() : { error: `HTTP ${mainResp.status}` };
      console.log('[Workflow Combinder] main response', selectedMainId, mainData);

      console.log(`[Workflow Combinder] Fetching template: ${selectedTemplateId}`);
      const tplResp = await fetch(`${backendUrl}/getworkflow/${encodeURIComponent(selectedTemplateId)}`);
      const tplData = tplResp.ok ? await tplResp.json() : { error: `HTTP ${tplResp.status}` };
      console.log('[Workflow Combinder] template response', selectedTemplateId, tplData);

      let mainWorkflow = splitRuntimesByEdges(mainData.workflow.nodes, mainData.workflow.edges);
      //every node just keep 
      /*
      mainWorkflow[][{nodes, edges}]
      id
      data.label
      data.nodelabel
      data.description
      data.functionInput
      */
      // Reduce node objects to only keep requested fields
      if (Array.isArray(mainWorkflow)) {
        mainWorkflow = mainWorkflow.map(rt => ({
          runtimeId: rt.runtimeId,
          nodes: (rt.nodes || []).map(n => ({
            id: n.id,
            refWorkflowId: selectedMainId,  
            refNodeId: n.id,
            label: n.data?.label || null,
            nodelabel: n.data?.nodeLabel || n.data?.nodelabel || null,
            description: n.data?.description || null,
            functionInput: n.data?.functionInput || n.data?.function_input || null
          })),
          edges: (rt.edges || []).map(e => ({ 
            id: e.id, 
            refWorkflowId: selectedMainId,
            refEdgeId: e.id,
            source: e.source, 
            target: e.target, 
            label: e.label 
          }))
        }));
      }
      console.log("splitRuntimesByEdges[A]", mainWorkflow);

      let mainWorkflowB = splitRuntimesByEdges(tplData.workflow.nodes, tplData.workflow.edges);
      if (Array.isArray(mainWorkflowB)) {
        mainWorkflowB = mainWorkflowB.map(rt => ({
          runtimeId: rt.runtimeId,
          nodes: (rt.nodes || []).map(n => ({
            id: n.id,
            refWorkflowId: selectedTemplateId,
            refNodeId: n.id,
            label: n.data?.label || null,
            nodelabel: n.data?.nodeLabel || n.data?.nodelabel || null,
            description: n.data?.description || null,
            functionInput: n.data?.functionInput || n.data?.function_input || null
          })),
          edges: (rt.edges || []).map(e => ({ 
            id: e.id, 
            refWorkflowId: selectedTemplateId,
            refEdgeId: e.id,
            source: e.source, 
            target: e.target, 
            label: e.label }))
        }));
      }
      console.log("splitRuntimesByEdges[B]", mainWorkflowB);

      let combineWorkflowsPayload = { 
        systemPrompt:"",
        prompt: `You are a workflow combiner. Your task is to combine the template workflow into the main workflow by replacing every node in the main workflow whose label is "actionController" or whose nodelabel is "action" with the entire template workflow.

When performing the replacement:

Treat the template workflow’s entry node as the node whose nodelabel is "start" in runtime_1.

Reconnect all incoming edges of the replaced node so that they now point to this entry node.

Treat the last node in the template’s runtime_1 chain (the node with no outgoing edge inside that runtime) as the exit node.

Reconnect all outgoing edges of the replaced node so that they now originate from this exit node.

Keep all template runtimes (runtime_1 to runtime_4) in the combined workflow.

Ensure that all id values for nodes and edges remain unique; generate new IDs for any cloned nodes or edges if necessary.

Here are the two workflows:

Main Workflow:
${JSON.stringify(mainWorkflow, null, 2)}

Template Workflow:
${JSON.stringify(mainWorkflowB, null, 2)}

Return ONLY the combined workflow as a single valid JSON object, with no extra explanation text.
`,
        mainWorkflow: mainWorkflow, 
        mainWorkflowB: mainWorkflowB 
      };
      console.log('[Workflow Combinder] Combined payload:', combineWorkflowsPayload);

      //i want to send endpoint here, /combineworkflows POST
      /*
      combineWorkflowsPayload
      */
      const combineResp = await fetch(`${backendUrl}/combineworkflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(combineWorkflowsPayload)
      });
      const combineResult = combineResp.ok ? await combineResp.json() : { error: `HTTP ${combineResp.status}` };
      console.log('[Workflow Combiner] Combine response', combineResult);
      

    } catch (e) {
      console.error('[Workflow Combinder] Error fetching workflows', e);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  return (
    <div id="ruleCheckSection" style={{ padding: 16, background: '#111827', borderRadius: '0 0 8px 8px', color: '#e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Workflow Viewer</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={fetchWorkflows} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn-secondary" onClick={populateCategories} disabled={loading || workflows.every(w => w.categoryId)} title="Fetch missing categories">
            Populate Categories
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12, padding: 12, background: '#0b1220', borderRadius: 6 }}>
        <h3 style={{ margin: 0 }}>Workflow Combinder</h3>
        <div id="workflowCombinderForm" style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <div>
            <div style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: 6 }}>Main Workflow</div>
            <select value={selectedMainId} onChange={(e) => setSelectedMainId(e.target.value)} style={{ minWidth: 260 }}>
              <option value="">-- select main workflow --</option>
              {workflows.map(w => (<option key={w.id} value={w.id}>{w.name || w.id}</option>))}
            </select>
          </div>
          <div>
            <div style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: 6 }}>Template Workflow</div>
            <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} style={{ minWidth: 260 }}>
              <option value="">-- select template workflow --</option>
              {workflows.map(w => (<option key={w.id} value={w.id}>{w.name || w.id}</option>))}
            </select>
          </div>
          <div>
            <button id="combineWorkflowsButton" className="btn-primary" onClick={combineWorkflows} style={{ height: 40, alignSelf: 'end' }}>Combine</button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, color: '#fda4af' }}>Error: {error}</div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '8px 12px' }}>Project Category</th>
              <th style={{ padding: '8px 12px' }}>Workflow Name</th>
              <th style={{ padding: '8px 12px' }}>ID</th>
              <th style={{ padding: '8px 12px' }}>Node #</th>
              <th style={{ padding: '8px 12px' }}>Edge #</th>
              <th style={{ padding: '8px 12px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {workflows.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: '#9ca3af' }}>No workflows found.</td>
              </tr>
            ) : (
              workflows.map((w) => (
                <tr key={w.id} style={{ borderBottom: '1px solid #0f172a' }}>
                  <td style={{ padding: '8px 12px' }}>{w.categoryId || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>{w.name || '(unnamed)'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.85rem' }}>{w.id}</td>
                  <td style={{ padding: '8px 12px' }}>{w.nodeNumber ?? w.nodeCount ?? (w.nodes ? w.nodes.length : '-')}</td>
                  <td style={{ padding: '8px 12px' }}>{w.edgeNumber ?? w.edgeCount ?? (w.edges ? w.edges.length : '-')}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <button className="btn-secondary" onClick={() => fetchWorkflowDetails(w.id)}>Load</button>
                  </td>
                </tr>
              ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
