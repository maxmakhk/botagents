// server/systemPromptGenerator.js
// Standalone generator for system prompts, usable on both server and client if needed.

function normalizeTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim());
  if (typeof raw === 'string') return raw.split(',').map((t) => t.trim());
  return [];
}

function generateSystemPrompt({ userPrompt = '', functionsList = [], apis = [], globalStoreVars = null } = {}) {
  try {
    const physicalObjects = [];
    const seenObjectIds = new Set();
    // Prefer using workflow memory `globalStoreVars.objects` if provided (current-workflow source of truth)
    if (globalStoreVars && Array.isArray(globalStoreVars.objects)) {
      (globalStoreVars.objects || []).forEach((obj, idx) => {
        try {
          const finalName = obj.name || obj.label || `object_${idx}`;
          const finalId = obj.id ?? obj.name ?? `object_${idx}`;
          const finalDescription = obj.description || obj.type || '';
          const finalTags = Array.isArray(obj.tags) ? obj.tags : (typeof obj.tags === 'string' ? normalizeTags(obj.tags) : []);
          physicalObjects.push({
            name: finalName,
            id: finalId,
            apiName: obj.apiName || '',
            description: finalDescription,
            tags: finalTags,
          });
        } catch (e) {
          // ignore malformed entries
        }
      });
    } else if (Array.isArray(functionsList)) {
      functionsList.forEach((rule) => {
        try {
          let wf = rule.workflowObject;
          if (!wf) return;
          if (typeof wf === 'string') {
            try {
              wf = JSON.parse(wf);
            } catch (e) {
              // ignore parse errors
              return;
            }
          }
          if (!Array.isArray(wf.nodes)) return;

          wf.nodes.forEach((node) => {
            const apiName = node.metadata?.apiName;
            if (!apiName) return;

            let latestComponent = null;
            if (Array.isArray(apis)) {
              const apiNameLower = String(apiName).toLowerCase();
              latestComponent = apis.find((api) => (api.name || '').toLowerCase() === apiNameLower);
            }

            let tags = [];
            if (latestComponent && latestComponent.tags) {
              tags = normalizeTags(latestComponent.tags);
            } else {
              tags = normalizeTags(node.metadata?.tags || []);
            }

            if (tags.some((tag) => tag.toLowerCase() === 'object')) {
              const uniqueKey = `${String(node.id)}_${String(apiName)}`;
              if (!seenObjectIds.has(uniqueKey)) {
                seenObjectIds.add(uniqueKey);
                const finalName = latestComponent?.name || apiName;
                const finalDescription = latestComponent?.description || node.description || node.data?.description || '';
                const finalTags = tags;
                physicalObjects.push({
                  name: finalName,
                  id: node.id,
                  apiName: apiName,
                  description: finalDescription,
                  tags: finalTags,
                });
              }
            }
          });
        } catch (err) {
          // continue on error
        }
      });
    }

    const physicalObjectTags = new Set();
    physicalObjects.forEach((obj) => {
      const tags = obj.tags || [];
      tags.forEach((tag) => {
        if (tag.toLowerCase() !== 'object') {
          physicalObjectTags.add(tag.toLowerCase());
        }
      });
    });

    // objectVariables: prefer globalStoreVars.objects (current workflow memory), fallback to derived from physicalObjects
    const objectVariables = (globalStoreVars && Array.isArray(globalStoreVars.objects))
      ? globalStoreVars.objects
      : physicalObjects.map((obj) => ({
          name: obj.name,
          id: obj.id,
          apiName: obj.apiName,
          description: obj.description,
          tags: obj.tags || []
        }));

    const actionComponents = [];
    if (Array.isArray(apis)) {
      apis.forEach((api) => {
        const tagsArray = normalizeTags(api.tags);
        const lowerTags = tagsArray.map((t) => String(t).toLowerCase());
        const hasOpen = lowerTags.includes('open');
        const hasAction = lowerTags.includes('action');
        const matchingTags = tagsArray.filter(
          (tag) =>
            physicalObjectTags.has(String(tag).toLowerCase()) &&
            String(tag).toLowerCase() !== 'action' &&
            String(tag).toLowerCase() !== 'open'
        );
        //const shouldInclude = hasOpen || (hasAction && matchingTags.length > 0);
        const shouldInclude = hasOpen || hasAction;
        if (shouldInclude) {
          let functionInput = null;
          if (api.functionInput) {
            if (typeof api.functionInput === 'string') {
              // Try direct JSON.parse first
              try { 
                functionInput = JSON.parse(api.functionInput); 
              } catch (e1) {
                // Try with unquoted-key heuristic: replace `key:` with `"key":`
                try {
                  let fixed = api.functionInput.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
                  functionInput = JSON.parse(fixed);
                } catch (e2) {
                  // Fallback: try to evaluate as JS object
                  try {
                    functionInput = (new Function('return ' + api.functionInput))();
                  } catch (e3) {
                    // Keep as string if all else fails
                    functionInput = api.functionInput;
                  }
                }
              }
            } else { 
              functionInput = api.functionInput; 
            }
          }

          actionComponents.push({
            name: api.name,
            id: api.id || '',
            description: api.description || '',
            functionInput: functionInput,
            //matchingTags: matchingTags,
            //isOpen: hasOpen,
            //isAction: hasAction,
          });
        }
      });
    }

    // Build component input descriptions (parse functionInput when present)
    const componentInputs = [];
    if (Array.isArray(apis)) {
      apis.forEach((api) => {
        let fi = api.functionInput;
        if (typeof fi === 'string') {
          try { fi = JSON.parse(fi); } catch (e) { /* keep string if not JSON */ }
        }
        componentInputs.push({ name: api.name || api.id || 'unknown', id: api.id || '', functionInput: fi });
      });
    }

    let output = '';
    output += 'Physically Objects:\n';
    physicalObjects.forEach((obj) => {
      output += `${obj.name}, ${obj.id}, ${obj.description}\n`;
    });
    output += '\nAction Components:\n';
    actionComponents.forEach((comp) => {
      output += `${comp.name}, ${comp.id}, ${comp.description}`;
      const tags = [];
      if (Array.isArray(comp.matchingTags) && comp.matchingTags.length) {
        tags.push(`matchingTags: ${comp.matchingTags.join('|')}`);
      }
      if (comp.isOpen) tags.push('open');
      if (comp.isAction) tags.push('action');
      if (tags.length > 0) output += `, [${tags.join(', ')}]`;
      output += '\n';
      output += '\nComponent Inputs (defaults):\n';
      componentInputs.forEach((ci) => {
        let fiStr = '';
        try { fiStr = (typeof ci.functionInput === 'string') ? ci.functionInput : JSON.stringify(ci.functionInput, null, 2); } catch (e) { fiStr = String(ci.functionInput); }
        output += `${ci.name} (${ci.id}): ${fiStr}\n`;
      });
    });

    const systemPrompt = `it is a industry lab

Rules:
- Reusable components
- Think carefully about how to complete a full structure
- Number of nodes should be within 20
- Output JSON Result only, no markdown, no explanation, no code block, just pure JSON.
- edges can have optional "expression" field to indicate execution conditions (e.g., "varA > 10"), but if not provided, assume always true. the variables is collected from globalStoreVars, which is the memory of current workflow, it can be updated by each node execution, and it can be used for condition judgement for edges.

if you have phycisly object here:
${output}
When using component defaults: if a component's "Component Inputs (defaults)" entry is ` + "undefined" + `, skip providing an input for that component when generating nodes (do not include a 'value' or an empty object).
Base on user prompt, to create a workflow, as a array format as below:
const nodes = [
 {id: "node1", action:"CameraInput",value:"", label:"start", input:{}, description:""} ,
 {id: "node2", action:"worldPosition",value:"", label:"node2", input:{}, description:""} ,
 {id: "node3", action:"wait",value:2000, label:"end", input:{}, description:""} 
]
const edges = [
  {source: "node1", target: "node2", label: "next", expression:"varA > 10"} ,
  {source: "node2", target: "node3", label: "next", expression:"varB < 5"} ,
  {source: "node3", target: "node1", label: "repeat", expression:"varC === true"},
]`;

    // systemPrompt2: include a machine-friendly JSON snippet of detected physical objects
    let systemPrompt2 = `
it is a workflow engineer, you will be responsible for creating workflow based on user prompt, the workflow should be created base on the physical objects and action components you have, and the workflow should make sense to achieve the user goal.

Rules:
- Reusable components
- Think carefully about how to complete a full structure
- Number of nodes should be within 20
- Output JSON Result only, no markdown, no explanation, no code block, just pure JSON.

Your Physical objects here (JSON array):
${JSON.stringify(objectVariables, null, 2)}

Available action components (JSON):
${JSON.stringify(actionComponents, null, 2)}

When using component defaults: if a component's "Component Inputs (defaults)" entry is ` + "undefined" + `, skip providing an input for that component when generating nodes (do not include a 'value' or an empty object).
Base on user prompt, to create a workflow, as a array format as below:
const nodes = [
 {id: "node1", action:"CameraInput",value:"", label:"start", input:{} },
 {id: "node2", action:"worldPosition",value:"", label:"node2", input:{} },
 {id: "node3", action:"wait",value:2000, label:"end", input:{} }
]
const edges = [
  {source: "node1", target: "node2", label: "next"},
  {source: "node2", target: "node3", label: "next"},
  {source: "node3", target: "node1", label: "repeat"},
]`;

    return { 
      userPrompt: userPrompt || '', 
      systemPrompt, 
      'systemPrompt2': systemPrompt2, 
      physicalObjects, 
      actionComponents, 
      objectVariables, 
      globalStoreVars,
      apis
    };
  } catch (err) {
    console.error('generateSystemPrompt error', err);
    return { userPrompt: userPrompt || '', systemPrompt: '', systemPrompt2: '', physicalObjects: [], actionComponents: [], objectVariables: [] };
  }
}

export { generateSystemPrompt };
