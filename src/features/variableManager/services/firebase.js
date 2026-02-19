import { collection, query, where, getDocs, getDoc, doc, updateDoc } from 'firebase/firestore';

export async function saveRuleToFirebase(db, payLoad) {
  if (!db || !payLoad || !payLoad.id) {
    console.warn('saveRuleToFirebase: missing db or payload id');
    return { success: false, reason: 'missing-id' };
  }

  try {
    const docRef = doc(db, 'VariableManager-rules', String(payLoad.id));
    const existingDoc = await getDoc(docRef);
    console.log('saveRuleToFirebase: existingDoc', existingDoc.exists(), existingDoc.data());

    if (!existingDoc.exists()) {
      // Requirement: do not create new docs
      console.warn('saveRuleToFirebase: doc not found, skipping create', payLoad.id);
      return { success: false, reason: 'not-found' };
    }
    // Normalize workflowObject into an object { nodes: [], edges: [] } and strip injected UI-only nodes
    let parsed = null;
    const raw = payLoad.workflowObject;
    try {
      if (typeof raw === 'string' && raw.trim()) {
        parsed = JSON.parse(raw);
      } else if (Array.isArray(raw)) {
        // treat as nodes-only
        parsed = { nodes: raw, edges: [] };
      } else if (raw && typeof raw === 'object') {
        parsed = raw;
      }
    } catch (e) {
      console.warn('saveRuleToFirebase: failed to parse workflowObject, will save empty workflow', e);
      parsed = null;
    }

    const nodes = (parsed && Array.isArray(parsed.nodes)) ? parsed.nodes : [];
    const edges = (parsed && Array.isArray(parsed.edges)) ? parsed.edges : [];

    const filteredNodes = nodes.filter((n) => {
      if (!n) return false;
      if (n.metadata && n.metadata.sourceRuleId) return false;
      if (String(n.id || '').startsWith('entry_')) return false;
      if (String(n.label || '').toLowerCase().startsWith('entry')) return false;
      return true;
    });

    // Remove edges that reference filtered-out nodes
    const validNodeIds = new Set(filteredNodes.map((n) => String(n.id)));
    const filteredEdges = edges.filter((e) => {
      if (!e) return false;
      const from = String(e.from || e.source || '');
      const to = String(e.to || e.target || '');
      return validNodeIds.has(from) && validNodeIds.has(to);
    });

    // Save as Firestore-native object (not a JSON string)
    const workflowObjectToSave = { nodes: filteredNodes, edges: filteredEdges };

    const updatePayload = {
      name: payLoad.name,
      expr: payLoad.expr,
      detectPrompt: payLoad.detectPrompt,
      systemPrompt: payLoad.systemPrompt,
      relatedFields: payLoad.relatedFields,
      categoryId: payLoad.categoryId,
      type: payLoad.type,
      workflowObject: workflowObjectToSave,
      updatedAt: new Date(),
    };

    // Remove keys with undefined values to avoid Firestore update errors
    const finalPayload = {};
    Object.keys(updatePayload).forEach((k) => {
      const v = updatePayload[k];
      if (v !== undefined) finalPayload[k] = v;
    });

    console.log('saveRuleToFirebase: updating doc', payLoad.id, { ...finalPayload, workflowObjectNodeCount: filteredNodes.length, workflowObjectEdgeCount: filteredEdges.length });
    await updateDoc(docRef, finalPayload);

    return { success: true };
  } catch (err) {
    console.error('saveRuleToFirebase: update failed', err);
    return { success: false, error: err };
  }
}

export async function loadRulesFromFirebaseService(opts = {}) {
  const { db, categoryId } = opts;
  
  try {
    let q;
    if (categoryId && categoryId !== 'all') {
      // Query rules by category
      q = query(collection(db, 'VariableManager-rules'), where('categoryId', '==', categoryId));
    } else {
      // Get all rules
      q = query(collection(db, 'VariableManager-rules'));
    }

    const snapshot = await getDocs(q);
    const rules = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
        // Normalize workflowObject: accept stringified object ({nodes,edges}) or legacy array and return as object
        console.log('loadRulesFromFirebaseService: processing doc', doc.id, data);
        let workflowRaw = data.workflowObject;
        let workflowObj = { nodes: [], edges: [] };
        try {
          if (typeof workflowRaw === 'string') {
            // parse JSON string
            try {
              const parsed = JSON.parse(workflowRaw);
              if (parsed && typeof parsed === 'object') workflowObj = parsed;
            } catch (e) {
              console.warn('loadRulesFromFirebaseService: invalid workflowObject JSON for', doc.id, e);
              workflowObj = { nodes: [], edges: [] };
            }
          } else if (Array.isArray(workflowRaw)) {
            // Legacy: nodes array only -> convert to object
            workflowObj = { nodes: workflowRaw, edges: [] };
          } else if (workflowRaw && typeof workflowRaw === 'object') {
            // Already an object with nodes/edges
            workflowObj = workflowRaw;
          } else {
            workflowObj = { nodes: [], edges: [] };
          }
        } catch (e) {
          console.warn('loadRulesFromFirebaseService: failed to normalize workflowObject for', doc.id, e);
          workflowObj = { nodes: [], edges: [] };
        }

        rules.push({
        id: data.id || doc.id,
        ruleId: data.ruleId || doc.id,
        type: data.type || 'Rule Checker',
        name: data.name || '',
        expr: data.expr || '',
        detectPrompt: data.detectPrompt || '',
        systemPrompt: data.systemPrompt || '',
        relatedFields: data.relatedFields || '',
        categoryId: data.categoryId || '',
          workflowObject: workflowObj,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    });

    // Convert to legacy arrays format (for backward compatibility)
    const ruleSource = rules.map(r => r.expr);
    const rulePrompts = rules.map(r => r.detectPrompt);
    const ruleNames = rules.map(r => r.name);
    const ruleTypes = rules.map(r => r.type);
    const ruleSystemPrompts = rules.map(r => r.systemPrompt);
    const ruleDetectPrompts = rules.map(r => r.detectPrompt);
    const ruleRelatedFields = rules.map(r => r.relatedFields);
    const ruleCategoryIds = rules.map(r => r.categoryId);
    const functionsList = rules;

    return {
      success: true,
      ruleSource,
      rulePrompts,
      ruleNames,
      ruleTypes,
      ruleSystemPrompts,
      ruleDetectPrompts,
      ruleRelatedFields,
      ruleCategoryIds,
      functionsList,
      count: rules.length,
    };
  } catch (err) {
    console.error('Error loading rules from Firebase:', err);
    return { success: false, error: err, count: 0 };
  }
}

