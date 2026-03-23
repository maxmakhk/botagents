// server/edgeHelpers.js
import projectManager from './projectManager.js';

export async function addEdgeToWorkflow({ workflowId, source, target, id, label, expression }) {
    console.log("0320 addEdgeToWorkflow[in]", { workflowId, source, target, id, label, expression });
  if (!workflowId) throw { code: 400, error: 'workflowId required' };
  if (!source) throw { code: 400, error: 'source required' };
  if (!target) throw { code: 400, error: 'target required' };

  const edge = {};
  if (id) edge.id = String(id);
  edge.source = String(source);
  edge.target = String(target);
  if (label !== undefined) edge.label = label;
  if (expression !== undefined) edge.expression = expression;

  const added = projectManager.addProjectEdge(workflowId, edge);

  if (!added) {
    const wf = projectManager.getProject(workflowId) || projectManager.getWorkflowData(workflowId);
    if (!wf) throw { code: 404, error: 'Workflow not found' };
    throw { code: 500, error: 'Failed to add edge' };
  }

  console.log(`[addEdgeToWorkflow] ${workflowId}:`, edge);
  return { success: true, projectId: workflowId, edge: added };
}