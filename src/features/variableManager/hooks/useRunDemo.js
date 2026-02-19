import { useEffect, useRef, useState } from 'react';

/**
 * @typedef {Object} WorkflowNodeData
 * @property {string} [labelText] - Display label for the node
 * @property {string} [label] - Alternative label property
 * @property {string} [type] - Node type (api, action, etc.)
 * @property {string} [url] - API URL or webhook URL
 * @property {string} [apiUrl] - Alternative API URL property
 * @property {string} [varName] - Variable name to store result
 * @property {string} [variable] - Alternative variable name property
 * @property {string} [checkVar] - Variable name for conditional checks
 * @property {string} [checkPath] - Dot-notation path within checkVar for nested access
 * @property {any} [config] - Configuration object for fnString scripts
 * @property {string} [fnString] - Custom async function body to execute for this node
 * @property {Array} [actions] - Array of action definitions
 */

export default function useRunDemo({ rfNodes = [], rfEdges = [], stepDelay = 1000, apis = [] } = {}) {
  const [runActive, setRunActive] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [activeEdgeId, setActiveEdgeId] = useState(null);
  const [storeVars, setStoreVars] = useState({});
  const controllerRef = useRef({ abort: false });
  const storeVarsRef = useRef(storeVars);

  // Keep ref in sync with state for live updates during execution
  useEffect(() => {
    storeVarsRef.current = storeVars;
  }, [storeVars]);

  useEffect(() => {
    return () => { try { controllerRef.current.abort = true; } catch (e) {} };
  }, []);

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  /**
   * Normalizes a variable name to lowercase and replaces dots with underscores
   * @param {string} name - The variable name
   * @returns {string} Normalized key for storeVars
   */
  const normalizeVarKey = (name) => {
    return String(name || '').toLowerCase().replace(/\./g, '_');
  };

  /**
   * Creates an execution context for fnString scripts
   * @param {Object} currentNode - The current workflow node
   * @returns {Object} Context object with APIs and utilities for scripts
   */
  const makeCtx = (currentNode) => {
    const setVar = (name, value) => {
      const key = normalizeVarKey(name);
      setStoreVars(prev => ({ ...prev, [key]: value }));
    };

    return {
      fetch: window.fetch.bind(window),
      console,
      alert: window.alert?.bind(window),
      node: currentNode,
      storeVars: storeVarsRef.current,
      setVar,
      config: currentNode.data?.config || {},
      apis, // keep existing apis array available for scripts
    };
  };

  async function runProject() {
    try {
      // toggle off if already running
      if (runActive) {
        controllerRef.current.abort = true;
        setRunActive(false);
        setActiveNodeId(null);
        setActiveEdgeId(null);
        return;
      }

      controllerRef.current = { abort: false };
      setRunActive(true);

      const nodesArr = Array.isArray(rfNodes) ? rfNodes : [];
      const edgesArr = Array.isArray(rfEdges) ? rfEdges : [];

      console.log('Starting runProject with nodes:', nodesArr, 'edges:', edgesArr, 'apis:', apis);

      // compute start nodes (no incoming edges)
      const incoming = {};
      edgesArr.forEach((e) => {
        if (!e) return;
        const t = String(e.target || e.to || '');
        if (!t) return;
        incoming[t] = (incoming[t] || 0) + 1;
      });
      const startNodes = nodesArr.filter((n) => !incoming[String(n.id)]);
      const startNode = startNodes && startNodes.length ? startNodes[0] : (nodesArr && nodesArr[0] ? nodesArr[0] : null);

      // create a deferred so runProject can await overall completion
      let finishResolve = null;
      const finishPromise = new Promise((res) => { finishResolve = res; });
      controllerRef.current.doneResolve = finishResolve;

      // runner that handles a single node and then schedules the next by calling itself
      const runNodeById = async (nodeId) => {
        try {
          if (controllerRef.current.abort) {
            controllerRef.current.doneResolve?.();
            return;
          }

          const currentNode = nodesArr.find((n) => String(n.id) === String(nodeId));
          if (!currentNode) {
            controllerRef.current.doneResolve?.();
            return;
          }

          setActiveNodeId(String(currentNode.id));
          setActiveEdgeId(null);
          console.log('Running node:', currentNode);

          // Try to obtain a function body to execute for this node.
          // Priority: node.data.fnString -> fallback to a matching `apis` entry's function
          const resolveApiFnFromApis = (node) => {
            try {
              if (!apis || !Array.isArray(apis) || apis.length === 0) return null;
              const rawLabel = String(node?.data?.label || node?.label || node?.data?.labelText || '').trim();
              const normalized = rawLabel.replace(/^api[:\s-]*/i, '').trim().toLowerCase();
              if (!normalized) return null;
              for (const a of apis) {
                const cand = String(a?.name || a?.label || a?.displayName || a?.id || '').trim().toLowerCase();
                if (!cand) continue;
                if (cand === normalized || cand.includes(normalized) || normalized.includes(cand)) {
                  return a?.function || a?.fnString || a?.functionBody || null;
                }
              }
            } catch (e) {
              // swallow
            }
            return null;
          };

          let source = currentNode.data?.fnString || null;
          if (!source) {
            const apiFn = resolveApiFnFromApis(currentNode);
            if (apiFn) {
              source = apiFn;
              console.log(`Node ${currentNode.id}: resolved fnString from apis collection`);
            }
          }

          if (source) {
            console.log(`Node ${currentNode.id}: executing fnString (source ${currentNode.data?.fnString ? 'node' : 'apis'})`, source);
            try {
              const wrapper = new Function(
                'ctx',
                `
                  const nodeFn = async (ctx) => {
                    ${source}

                    // Determine a sensible argument to pass to user functions:
                    // prefer ctx.node.data.input -> ctx.node.data.config -> ctx.config -> full ctx
                    const _arg = (ctx && ctx.node && ctx.node.data && (ctx.node.data.input ?? ctx.node.data.config ?? ctx.node.data.payload)) || ctx.config || ctx;

                    // Auto-invoke common entrypoints if the user only declared a function
                    if (typeof processRequest === 'function') return await processRequest(_arg);
                    if (typeof handler === 'function') return await handler(_arg);
                    if (typeof main === 'function') return await main(_arg);
                    if (typeof run === 'function') return await run(_arg);

                    // No explicit entrypoint invoked; allow the script to return via top-level return
                    return undefined;
                  };
                  return nodeFn(ctx);
                `
              );

              await wrapper(makeCtx(currentNode));
              console.log(`Node ${currentNode.id}: fnString completed successfully`);
            } catch (error) {
              console.error(`Node ${currentNode.id}: fnString execution error:`, error);
              setStoreVars(prev => ({
                ...prev,
                [normalizeVarKey(`node_${currentNode.id}_error`)]: (error instanceof Error) ? error.message : String(error),
              }));
            }
          }

          // After handling API (or not), proceed to next node selection
          if (controllerRef.current.abort) {
            controllerRef.current.doneResolve?.();
            return;
          }

          // small delay between nodes
          await sleep(stepDelay);

          const outgoing = edgesArr.filter((e) => String(e.source || e.from || '') === String(currentNode.id));
          if (!outgoing || outgoing.length === 0) {
            controllerRef.current.doneResolve?.();
            return;
          }

          console.log('DEBUG storeVars at node', currentNode.id, storeVarsRef.current);

          // Attempt to auto-select branch for condition-like labels
          let chosenEdge = null;
          // track inspected variable info for logging when auto-selecting
          let inspectedVar = null;
          let inspectedPath = null;
          let inspectedValue = undefined;
          if (outgoing.length === 1) {
            chosenEdge = outgoing[0];
          } else {
            const getFromStoreNorm = (name, path) => {
              const key = String(name || '').toLowerCase().replace(/\./g, '_');
              const base = storeVarsRef.current?.[key];
              if (base == null) return undefined;
              if (!path) return base;
              const parts = String(path).split('.');
              let cur = base;
              for (const p of parts) {
                if (cur == null) return undefined;
                cur = cur[p];
              }
              return cur;
            };

            // NEW: Try to evaluate edge labels as JavaScript conditions
            // This supports the fnToWorkflow refactor where conditions are on edges
            const evaluateEdgeCondition = (edgeLabel) => {
              if (!edgeLabel) return null;
              const label = String(edgeLabel).trim();
              
              // Handle "else" explicitly - it should match when no other condition is true
              if (label.toLowerCase() === 'else') {
                return 'else';
              }

              // Try to evaluate as a condition expression like "var_a === false" or "openweathertemp <= 3"
              // Match patterns: variable === value, variable == value, !==, !=, <=, >=, <, >
              const conditionMatch = label.match(/^([A-Za-z0-9_.]+)\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/);
              if (conditionMatch) {
                const [, varName, operator, expectedValueStr] = conditionMatch;
                const actualValueRaw = getFromStoreNorm(varName, null);
                const expectedValue = expectedValueStr.trim();

                // Parse expected value into boolean/null/number/string
                let parsedExpected;
                if (expectedValue === 'true') parsedExpected = true;
                else if (expectedValue === 'false') parsedExpected = false;
                else if (expectedValue === 'null') parsedExpected = null;
                else if (expectedValue === 'undefined') parsedExpected = undefined;
                else if (!isNaN(expectedValue)) parsedExpected = Number(expectedValue);
                else parsedExpected = expectedValue.replace(/^['\"]|['\"]$/g, ''); // remove surrounding quotes

                // Normalize actual value for numeric comparisons when expected is a number
                let actualValue = actualValueRaw;
                if (parsedExpected !== null && typeof parsedExpected === 'number') {
                  const maybeNum = Number(actualValueRaw);
                  actualValue = isNaN(maybeNum) ? actualValueRaw : maybeNum;
                }

                console.log(`Evaluating edge condition: ${varName} ${operator} ${expectedValue}, actualValue:`, actualValueRaw, 'parsedExpected:', parsedExpected);

                // Evaluate the condition including relational operators
                switch (operator) {
                  case '===':
                    if (typeof parsedExpected === 'number') return actualValue === parsedExpected;
                    return actualValue === parsedExpected;
                  case '!==':
                    if (typeof parsedExpected === 'number') return actualValue !== parsedExpected;
                    return actualValue !== parsedExpected;
                  case '==':
                    return actualValue == parsedExpected;
                  case '!=':
                    return actualValue != parsedExpected;
                  case '<=':
                    return actualValue <= parsedExpected;
                  case '>=':
                    return actualValue >= parsedExpected;
                  case '<':
                    return actualValue < parsedExpected;
                  case '>':
                    return actualValue > parsedExpected;
                  default:
                    return null;
                }
              }
              
              return null;
            };

            // First pass: try to find an edge whose condition evaluates to true
            for (const edge of outgoing) {
              const result = evaluateEdgeCondition(edge.label);
              if (result === true) {
                console.log(`Edge condition "${edge.label}" evaluated to TRUE, selecting this edge`);
                chosenEdge = edge;
                break;
              }
            }

            // Second pass: if no condition was true, take the "else" edge
            if (!chosenEdge) {
              const elseEdge = outgoing.find((e) => {
                const result = evaluateEdgeCondition(e.label);
                return result === 'else';
              });
              if (elseEdge) {
                console.log('No condition evaluated to true, taking "else" edge');
                chosenEdge = elseEdge;
              } else {
                // If any outgoing edge appears to be a conditional expression
                // (e.g. "var === value" or starts with "if ...") and none matched,
                // end the run instead of falling back to a default edge.
                const condExprRegex = /^([A-Za-z0-9_.]+)\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/;
                const anyConditionEdges = outgoing.some((e) => {
                  const lab = String(e.label || '').trim();
                  return condExprRegex.test(lab) || lab.toLowerCase() === 'else' || /^if\s+/i.test(lab);
                });
                if (anyConditionEdges) {
                  console.log(`No conditional outgoing edges matched for node ${currentNode.id}; ending run.`);
                  controllerRef.current.doneResolve?.();
                  return;
                }
              }
            }

            // 1) Prefer explicit metadata on the node
            const metaVar = currentNode.data?.checkVar;
            const metaPath = currentNode.data?.checkPath;
            if (metaVar) {
              inspectedVar = metaVar;
              inspectedPath = metaPath;
              inspectedValue = getFromStoreNorm(metaVar, metaPath);
              const actualStr = inspectedValue == null ? null : String(inspectedValue).trim().toLowerCase();
              console.log(`Node ${currentNode.id} has explicit checkVar metadata: variable "${metaVar}" with path "${metaPath}" has value:`, inspectedValue, "actualStr", actualStr);
              if (actualStr != null) {
                const found = outgoing.find((e) => String(e.label || e.id || '').toLowerCase().includes(String(actualStr)));
                if (found) chosenEdge = found;
              }
            }

            // 2) Try explicit "if var[:path] is value" pattern
            if (!chosenEdge) {
              const condMatch = labelText.match(/^if\s+([A-Za-z0-9_]+)(?::([A-Za-z0-9_.]+))?\s+is\s+(.+)$/i);
              if (condMatch) {
                const [, condVar, condPath, condValRaw] = condMatch;
                const condVal = String(condValRaw || '').trim().toLowerCase();
                inspectedVar = condVar;
                inspectedPath = condPath;
                inspectedValue = getFromStoreNorm(condVar, condPath);
                const actualStr = inspectedValue == null ? null : String(inspectedValue).trim().toLowerCase();
                console.log(`Evaluating condition for node ${currentNode.id}: variable "${condVar}" with path "${condPath}" against value "${condVal}"`);
                if (actualStr != null) {
                  const found = outgoing.find((e) => {
                    const lab = String(e.label || e.id || '').toLowerCase();
                    if (!lab) return false;
                    if (lab.includes(condVal)) return true;
                    if ((condVal === 'true' || condVal === 'yes') && (lab.includes('true') || lab.includes('yes') || lab.includes('y'))) return true;
                    if ((condVal === 'false' || condVal === 'no') && (lab.includes('false') || lab.includes('no') || lab.includes('n'))) return true;
                    return false;
                  });
                  if (found) chosenEdge = found;
                  else if (outgoing.length === 2) {
                    const lab0 = String(outgoing[0].label || '').toLowerCase();
                    const lab1 = String(outgoing[1].label || '').toLowerCase();
                    const truthy = ['true','yes','y','1'];
                    const falsey = ['false','no','n','0'];
                    if (truthy.some(t => lab0.includes(t)) && falsey.some(f => lab1.includes(f))) {
                      chosenEdge = truthy.includes(actualStr) ? outgoing[0] : outgoing[1];
                    } else if (truthy.some(t => lab1.includes(t)) && falsey.some(f => lab0.includes(f))) {
                      chosenEdge = truthy.includes(actualStr) ? outgoing[1] : outgoing[0];
                    }
                  }
                }
              }
            }

            // 3) Try "check <var>" simple pattern to select based on existence
            if (!chosenEdge) {
              const checkMatch = labelText.match(/^check\s+([A-Za-z0-9_.]+)(?::([A-Za-z0-9_.]+))?$/i);
              if (checkMatch) {
                const [, cv, cp] = checkMatch;
                inspectedVar = cv;
                inspectedPath = cp;
                inspectedValue = getFromStoreNorm(cv, cp);
                console.log('Check-label condition detected:', { nodeId: currentNode.id, checkVar: cv, checkPath: cp, normalizedKey: String(cv || '').toLowerCase().replace(/\./g, '_'), actual: inspectedValue });
                const exists = inspectedValue != null;
                if (outgoing.length === 2) {
                  // try to pick edge with truthy/falsey labels
                  const truthyLabels = ['true','yes','y','1','exists','present'];
                  const falseyLabels = ['false','no','n','0','not exists','absent'];
                  const found = outgoing.find((e) => {
                    const lab = String(e.label || '').toLowerCase();
                    if (!lab) return false;
                    if (exists && truthyLabels.some(t => lab.includes(t))) return true;
                    if (!exists && falseyLabels.some(f => lab.includes(f))) return true;
                    return false;
                  });
                  if (found) chosenEdge = found;
                  else chosenEdge = exists ? outgoing[0] : outgoing[1];
                } else {
                  chosenEdge = outgoing[0];
                }
              }
            }

            // 4) final fallback: pick first outgoing and log inspected info
            if (!chosenEdge) {
              chosenEdge = outgoing[0];
              console.log(`Auto-selected default outgoing edge for node ${currentNode.id}:`, chosenEdge, 'inspectedVar:', inspectedVar, 'inspectedPath:', inspectedPath, 'inspectedValue:', inspectedValue);
            }
          }

          if (!chosenEdge) {
            controllerRef.current.doneResolve?.();
            return;
          }

          const edgeId = (chosenEdge.id || `edge_${chosenEdge.source}_${chosenEdge.target}`);
          setActiveEdgeId(String(edgeId));
          await sleep(Math.max(200, stepDelay - 150));
          const nextNode = nodesArr.find((n) => String(n.id) === String(chosenEdge.target || chosenEdge.to));
          if (!nextNode) {
            controllerRef.current.doneResolve?.();
            return;
          }

          // continue to next node
          await runNodeById(nextNode.id);

        } catch (err) {
          console.error('runNodeById error:', err);
          controllerRef.current.doneResolve?.();
        }
      };

      // start the run
      if (startNode) {
        runNodeById(startNode.id).catch((e) => { console.error('runNodeById top-level error:', e); controllerRef.current.doneResolve?.(); });
      } else {
        // nothing to run
        controllerRef.current.doneResolve?.();
      }

      // wait until run completes or is aborted
      await finishPromise;
    } catch (err) {
      // swallow but log
      // console.error('useRunDemo runProject error:', err);
    } finally {
      setRunActive(false);
      setActiveNodeId(null);
      setActiveEdgeId(null);
    }
  }

  return {
    runProject,
    runActive,
    activeNodeId,
    activeEdgeId,
    storeVars,
    setStoreVars
  };
}
