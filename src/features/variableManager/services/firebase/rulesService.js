import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
} from 'firebase/firestore';

/**
 * Load rule sources (functionsList) from Firebase
 */
export async function loadRuleSources(db, normalizeLegacyFromFunctions, createRuleId) {
  try {
    const q = query(collection(db, 'VariableManager-rules'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    
    if (snap.docs.length > 0) {
      const doc = snap.docs[0].data();
      
      if (doc.functionsList && Array.isArray(doc.functionsList)) {
        const normalized = doc.functionsList.map((f, idx) => {
          const existingId = (f && (f.id || f.ruleId)) ? String(f.id || f.ruleId) : createRuleId();
          return { ...(f || {}), id: existingId, ruleId: (f && f.ruleId) ? f.ruleId : existingId };
        });
        
        const legacy = normalizeLegacyFromFunctions(normalized);
        return {
          functionsList: normalized,
          ruleSource: legacy.src,
          ruleExpressions: legacy.expr,
          ruleDetectPrompts: legacy.detectPrompts || [],
          ruleRelatedFields: legacy.relatedFields || [],
          ruleCategoryIds: legacy.categoryIds || [],
          rulePrompts: legacy.prompts,
          ruleNames: legacy.names,
          ruleTypes: legacy.types,
          ruleSystemPrompts: legacy.systemPrompts,
        };
      } else {
        // Legacy format
        return {
          ruleSource: doc.ruleSource || [],
          rulePrompts: doc.rulePrompts || [],
          ruleNames: doc.ruleNames || doc.rulePrompts?.slice() || [],
          ruleTypes: doc.ruleTypes || [],
          ruleSystemPrompts: doc.ruleSystemPrompts || [],
          ruleDetectPrompts: doc.ruleDetectPrompts || [],
          ruleRelatedFields: doc.ruleRelatedFields || [],
          ruleCategoryIds: doc.ruleCategoryIds || [],
          functionsList: doc.functionsList || buildFunctionsListFromLegacy(
            doc.ruleSource || [],
            doc.ruleNames || [],
            doc.ruleTypes || [],
            doc.ruleSystemPrompts || [],
            doc.ruleDetectPrompts || [],
            doc.ruleRelatedFields || [],
            doc.ruleCategoryIds || [],
            createRuleId
          ),
        };
      }
    }
    
    return null;
  } catch (err) {
    console.error('Error loading rule sources:', err);
    throw err;
  }
}

/**
 * Save rule sources to Firebase
 */
export async function saveRuleSources(
  db,
  override = null,
  {
    ruleSource,
    rulePrompts,
    ruleNames,
    ruleTypes,
    ruleSystemPrompts,
    ruleDetectPrompts,
    ruleRelatedFields,
    ruleCategoryIds,
    functionsList,
    normalizeLegacyFromFunctions,
    createRuleId,
  }
) {
  try {
    const effectiveRuleSource = override?.ruleSource ?? ruleSource;
    const effectiveRulePrompts = override?.rulePrompts ?? rulePrompts;
    const effectiveRuleNames = override?.ruleNames ?? ruleNames;
    const effectiveRuleTypes = override?.ruleTypes ?? ruleTypes;
    const effectiveRuleSystemPrompts = override?.ruleSystemPrompts ?? ruleSystemPrompts;
    const effectiveRuleDetectPrompts = override?.ruleDetectPrompts ?? ruleDetectPrompts;
    const effectiveRuleRelatedFields = override?.ruleRelatedFields ?? ruleRelatedFields;
    const effectiveRuleCategoryIds = override?.ruleCategoryIds ?? ruleCategoryIds;
    const effectiveFunctionsList = override?.functionsList ?? functionsList;

    let toSaveFunctions = (effectiveRuleSource && effectiveRuleSource.length)
      ? (effectiveRuleSource || []).map((expr, idx) => ({
          type: (effectiveRuleTypes && effectiveRuleTypes[idx]) ? effectiveRuleTypes[idx] : 'Rule Checker',
          name: (effectiveRuleNames && effectiveRuleNames[idx]) ? effectiveRuleNames[idx] : ((effectiveRulePrompts && effectiveRulePrompts[idx]) ? effectiveRulePrompts[idx] : `Rule ${idx + 1}`),
          expr: expr || '',
          detectPrompt: (effectiveRuleDetectPrompts && effectiveRuleDetectPrompts[idx]) ? effectiveRuleDetectPrompts[idx] : '',
          systemPrompt: (effectiveRuleSystemPrompts && effectiveRuleSystemPrompts[idx]) ? effectiveRuleSystemPrompts[idx] : '',
          relatedFields: (effectiveRuleRelatedFields && effectiveRuleRelatedFields[idx]) ? effectiveRuleRelatedFields[idx] : '',
          categoryId: (effectiveRuleCategoryIds && effectiveRuleCategoryIds[idx]) ? effectiveRuleCategoryIds[idx] : '',
          workflowObject: (effectiveFunctionsList && effectiveFunctionsList[idx] && effectiveFunctionsList[idx].workflowObject)
            ? effectiveFunctionsList[idx].workflowObject
            : ''
        }))
      : (effectiveFunctionsList || []);

    const normalizedFunctions = (toSaveFunctions && toSaveFunctions.length > 0)
      ? toSaveFunctions.map((f) => {
          const baseId = (f && (f.id || f.ruleId)) ? (f.id || f.ruleId) : createRuleId();
          return { ...(f || {}), id: baseId, ruleId: (f && f.ruleId) ? f.ruleId : baseId };
        })
      : [];

    const legacyFromFunctions = (normalizedFunctions && normalizedFunctions.length > 0)
      ? normalizeLegacyFromFunctions(normalizedFunctions)
      : null;
    
    const toSaveRuleSource = legacyFromFunctions ? legacyFromFunctions.src : effectiveRuleSource;
    const toSaveRulePrompts = legacyFromFunctions ? legacyFromFunctions.prompts : effectiveRulePrompts;
    const toSaveRuleNames = legacyFromFunctions ? legacyFromFunctions.names : effectiveRuleNames;
    const toSaveRuleTypes = legacyFromFunctions ? legacyFromFunctions.types : effectiveRuleTypes;
    const toSaveRuleSystemPrompts = legacyFromFunctions ? legacyFromFunctions.systemPrompts : effectiveRuleSystemPrompts;
    const toSaveRuleDetectPrompts = legacyFromFunctions ? legacyFromFunctions.detectPrompts : effectiveRuleDetectPrompts;
    const toSaveRuleRelatedFields = legacyFromFunctions ? legacyFromFunctions.relatedFields : effectiveRuleRelatedFields;
    const toSaveRuleCategoryIds = legacyFromFunctions ? legacyFromFunctions.categoryIds : effectiveRuleCategoryIds;

    await addDoc(collection(db, 'VariableManager-rules'), {
      ruleSource: toSaveRuleSource,
      rulePrompts: toSaveRulePrompts,
      ruleNames: toSaveRuleNames,
      ruleTypes: toSaveRuleTypes,
      ruleSystemPrompts: toSaveRuleSystemPrompts,
      ruleDetectPrompts: toSaveRuleDetectPrompts,
      ruleRelatedFields: toSaveRuleRelatedFields,
      ruleCategoryIds: toSaveRuleCategoryIds,
      functionsList: normalizedFunctions,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('Error saving rules:', err);
    throw err;
  }
}

/**
 * Build functionsList from legacy arrays
 */
function buildFunctionsListFromLegacy(
  ruleSource,
  ruleNames,
  ruleTypes,
  ruleSystemPrompts,
  ruleDetectPrompts,
  ruleRelatedFields,
  ruleCategoryIds,
  createRuleId
) {
  return (ruleSource || []).map((expr, idx) => {
    const newId = createRuleId();
    return {
      id: newId,
      ruleId: newId,
      type: (ruleTypes && ruleTypes[idx]) ? ruleTypes[idx] : 'Rule Checker',
      name: (ruleNames && ruleNames[idx]) ? ruleNames[idx] : `Rule ${idx + 1}`,
      expr: expr || '',
      systemPrompt: (ruleSystemPrompts && ruleSystemPrompts[idx]) ? ruleSystemPrompts[idx] : '',
      detectPrompt: (ruleDetectPrompts && ruleDetectPrompts[idx]) ? ruleDetectPrompts[idx] : '',
      relatedFields: (ruleRelatedFields && ruleRelatedFields[idx]) ? ruleRelatedFields[idx] : '',
      categoryId: (ruleCategoryIds && ruleCategoryIds[idx]) ? ruleCategoryIds[idx] : ''
    };
  });
}
