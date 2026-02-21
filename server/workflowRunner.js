/**
 * Workflow Runner for Node.js
 * 
 * Migrated from the frontend useRunDemo.js hook. It executes
 * fnString asynchronously in a dedicated sandbox context (new Function),
 * evaluating edges and emitting status back to the frontend via Socket.IO.
 */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function normalizeVarKey(name) {
    return String(name || '').toLowerCase().replace(/\./g, '_');
}

export async function runWorkflow(socket, { nodes, edges, apis, stepDelay = 1000, initialStoreVars = {} }) {
    let nodesArr = Array.isArray(nodes) ? nodes : [];
    let edgesArr = Array.isArray(edges) ? edges : [];

    if (nodesArr.length === 0) {
        socket.emit('workflow_complete');
        return;
    }

    // State
    let storeVars = { ...initialStoreVars };
    let abort = false;
    // waitResolvers dict simulating frontend interactive wait behavior, kept here for structure
    const waitResolvers = {};

    // Find start node
    const incoming = {};
    edgesArr.forEach((e) => {
        if (!e) return;
        const t = String(e.target || e.to || '');
        if (!t) return;
        incoming[t] = (incoming[t] || 0) + 1;
    });
    const startNodes = nodesArr.filter((n) => !incoming[String(n.id)]);
    const startNode = startNodes.length ? startNodes[0] : nodesArr[0];

    if (!startNode) {
        socket.emit('workflow_complete');
        return;
    }

    // Handle client disconnect or abort requests
    socket.on('disconnect', () => { abort = true; });
    socket.on('stop_workflow', () => { abort = true; });

    socket.on('update_store_vars', (newVars) => {
        if (newVars && typeof newVars === 'object') {
            storeVars = { ...newVars };
            console.log(`[Backend] Synced manual storeVars change from frontend`);
        }
    });

    // Allow client to update the workflow while running (live edits)
    socket.on('update_workflow', (data) => {
        try {
            if (data && Array.isArray(data.nodes)) {
                nodesArr = data.nodes;
            }
            if (data && Array.isArray(data.edges)) {
                edgesArr = data.edges;
            }
            console.log('[Backend] Workflow updated during run: nodes=%d edges=%d', (nodesArr || []).length, (edgesArr || []).length);
        } catch (e) {
            console.warn('[Backend] Failed to apply update_workflow:', e);
        }
    });

    socket.on('workflow_resume', (data) => {
        const nodeId = data?.nodeId;
        if (!nodeId) return;

        storeVars['waiting_wait'] = false;
        storeVars['node_' + String(nodeId) + '_status'] = 'user_continued';
        socket.emit('store_vars_update', storeVars);

        const resolver = waitResolvers[String(nodeId)];
        if (typeof resolver === 'function') {
            try { resolver(); } catch (e) { }
        }
    });

    const getFromStoreNorm = (name, path) => {
        const key = String(name || '').toLowerCase().replace(/\./g, '_');
        const base = storeVars[key];
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

    const setVar = (name, value) => {
        const key = normalizeVarKey(name);
        storeVars[key] = value;
        socket.emit('store_vars_update', storeVars);
    };

    const makeCtx = (currentNode) => {
        return {
            // Stub fetch to be native node fetch
            fetch: globalThis.fetch,
            console: {
                log: (...args) => {
                    console.log(`[Node ${currentNode.id}]`, ...args);
                    // Optional: emit logs to frontend
                    socket.emit('node_log', { nodeId: currentNode.id, level: 'log', args });
                },
                error: (...args) => {
                    console.error(`[Node ${currentNode.id}] ERROR:`, ...args);
                    socket.emit('node_log', { nodeId: currentNode.id, level: 'error', args });
                },
                warn: (...args) => {
                    console.warn(`[Node ${currentNode.id}] WARN:`, ...args);
                    socket.emit('node_log', { nodeId: currentNode.id, level: 'warn', args });
                }
            },
            alert: (msg) => {
                console.log(`[Node ${currentNode.id}] ALERT:`, msg);
                socket.emit('node_log', { nodeId: currentNode.id, level: 'alert', args: [msg] });
            },
            node: currentNode,
            storeVars: storeVars,
            setVar,
            config: currentNode.data?.config || {},
            apis
        };
    };

    const evaluateEdgeCondition = (edgeLabel) => {
        if (!edgeLabel) return null;
        const label = String(edgeLabel).trim();
        if (label.toLowerCase() === 'else') return 'else';

        const conditionMatch = label.match(/^([A-Za-z0-9_.]+)\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/);
        if (conditionMatch) {
            const [, varName, operator, expectedValueStr] = conditionMatch;
            const actualValueRaw = getFromStoreNorm(varName, null);
            const expectedValue = expectedValueStr.trim();

            let parsedExpected;
            if (expectedValue === 'true') parsedExpected = true;
            else if (expectedValue === 'false') parsedExpected = false;
            else if (expectedValue === 'null') parsedExpected = null;
            else if (expectedValue === 'undefined') parsedExpected = undefined;
            else if (!isNaN(expectedValue)) parsedExpected = Number(expectedValue);
            else parsedExpected = expectedValue.replace(/^['"]/g, '').replace(/['"]$/g, '');

            let actualValue = actualValueRaw;
            if (parsedExpected !== null && typeof parsedExpected === 'number') {
                const maybeNum = Number(actualValueRaw);
                actualValue = isNaN(maybeNum) ? actualValueRaw : maybeNum;
            }

            switch (operator) {
                case '===': return actualValue === parsedExpected;
                case '!==': return actualValue !== parsedExpected;
                case '==': return actualValue == parsedExpected;
                case '!=': return actualValue != parsedExpected;
                case '<=': return actualValue <= parsedExpected;
                case '>=': return actualValue >= parsedExpected;
                case '<': return actualValue < parsedExpected;
                case '>': return actualValue > parsedExpected;
                default: return null;
            }
        }
        return null;
    };

    const runNodeById = async (nodeId) => {
        if (abort) return;

        const currentNode = nodesArr.find((n) => String(n.id) === String(nodeId));
        if (!currentNode) return;

        socket.emit('node_start', { nodeId: currentNode.id });
        console.log(`Running node: ${currentNode.id}`);

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
            } catch (e) { }
            return null;
        };

        let source = currentNode.data?.fnString || null;
        if (!source) {
            const apiFn = resolveApiFnFromApis(currentNode);
            if (apiFn) source = apiFn;
        }

        if (source) {
            try {
                const wrapper = new Function(
                    'ctx',
                    `
            const nodeFn = async (ctx) => {
              ${source}

              const _arg = (ctx && ctx.node && ctx.node.data && (ctx.node.data.input ?? ctx.node.data.config ?? ctx.node.data.payload)) || ctx.config || ctx;
              
              if (typeof processRequest === 'function') return await processRequest(_arg);
              if (typeof handler === 'function') return await handler(_arg);
              if (typeof main === 'function') return await main(_arg);
              if (typeof run === 'function') return await run(_arg);

              return undefined;
            };
            return nodeFn(ctx);
          `
                );

                await wrapper(makeCtx(currentNode));

                // Check wait conditions
                const isWaiting = storeVars['waiting_wait'] === true;
                if (isWaiting) {
                    setVar(`node_${currentNode.id}_status`, 'waiting_user_input');
                    setVar(`node_${currentNode.id}_wait_start`, Date.now());

                    socket.emit('node_wait', { nodeId: currentNode.id, reason: 'waiting_user_input' });

                    let resumeResolve;
                    const resumePromise = new Promise((res) => { resumeResolve = res; });
                    waitResolvers[String(currentNode.id)] = resumeResolve;
                    await resumePromise;
                    delete waitResolvers[String(currentNode.id)];
                }
            } catch (error) {
                console.error(`Node ${currentNode.id} execution error:`, error);
                setVar(`node_${currentNode.id}_error`, (error instanceof Error) ? error.message : String(error));
                socket.emit('node_error', { nodeId: currentNode.id, error: (error instanceof Error) ? error.message : String(error) });
            }
        }

        if (abort) return;

        await sleep(stepDelay);

        const outgoing = edgesArr.filter((e) => String(e.source || e.from || '') === String(currentNode.id));
        if (!outgoing || outgoing.length === 0) return;

        let chosenEdge = null;
        let labelText = String(currentNode.data?.label || currentNode.data?.labelText || '').trim();

        if (outgoing.length === 1) {
            chosenEdge = outgoing[0];
        } else {
            // 1) Evaluate edge conditions
            for (const edge of outgoing) {
                if (evaluateEdgeCondition(edge.label) === true) {
                    chosenEdge = edge;
                    break;
                }
            }

            if (!chosenEdge) {
                const elseEdge = outgoing.find((e) => evaluateEdgeCondition(e.label) === 'else');
                if (elseEdge) {
                    chosenEdge = elseEdge;
                } else {
                    const condExprRegex = /^([A-Za-z0-9_.]+)\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/;
                    const anyConditionEdges = outgoing.some((e) => {
                        const lab = String(e.label || '').trim();
                        return condExprRegex.test(lab) || lab.toLowerCase() === 'else' || /^if\s+/i.test(lab);
                    });
                    if (anyConditionEdges) return; // End run
                }
            }

            // 2) Explicit metadata on node checkVar
            const metaVar = currentNode.data?.checkVar;
            const metaPath = currentNode.data?.checkPath;
            if (metaVar && !chosenEdge) {
                const actualValue = getFromStoreNorm(metaVar, metaPath);
                const actualStr = actualValue == null ? null : String(actualValue).trim().toLowerCase();
                if (actualStr != null) {
                    const found = outgoing.find((e) => String(e.label || e.id || '').toLowerCase().includes(actualStr));
                    if (found) chosenEdge = found;
                }
            }

            // 3) Try explicit "if var[:path] is value" pattern
            if (!chosenEdge) {
                const condMatch = labelText.match(/^if\s+([A-Za-z0-9_]+)(?::([A-Za-z0-9_.]+))?\s+is\s+(.+)$/i);
                if (condMatch) {
                    const [, condVar, condPath, condValRaw] = condMatch;
                    const condVal = String(condValRaw || '').trim().toLowerCase();
                    const actualValue = getFromStoreNorm(condVar, condPath);
                    const actualStr = actualValue == null ? null : String(actualValue).trim().toLowerCase();

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
                            const truthy = ['true', 'yes', 'y', '1'];
                            const falsey = ['false', 'no', 'n', '0'];
                            if (truthy.some(t => lab0.includes(t)) && falsey.some(f => lab1.includes(f))) {
                                chosenEdge = truthy.includes(actualStr) ? outgoing[0] : outgoing[1];
                            } else if (truthy.some(t => lab1.includes(t)) && falsey.some(f => lab0.includes(f))) {
                                chosenEdge = truthy.includes(actualStr) ? outgoing[1] : outgoing[0];
                            }
                        }
                    }
                }
            }

            // 4) Try "check <var>"
            if (!chosenEdge) {
                const checkMatch = labelText.match(/^check\s+([A-Za-z0-9_.]+)(?::([A-Za-z0-9_.]+))?$/i);
                if (checkMatch) {
                    const [, cv, cp] = checkMatch;
                    const actualValue = getFromStoreNorm(cv, cp);
                    const exists = actualValue != null;
                    if (outgoing.length === 2) {
                        const truthyLabels = ['true', 'yes', 'y', '1', 'exists', 'present'];
                        const falseyLabels = ['false', 'no', 'n', '0', 'not exists', 'absent'];
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

            // 5) Fallback
            if (!chosenEdge) {
                chosenEdge = outgoing[0];
            }
        }

        if (!chosenEdge) return;

        socket.emit('edge_start', { edgeId: chosenEdge.id || `edge_${chosenEdge.source}_${chosenEdge.target}` });
        await sleep(Math.max(200, stepDelay - 150));

        const nextNode = nodesArr.find((n) => String(n.id) === String(chosenEdge.target || chosenEdge.to));
        if (!nextNode) return;

        await runNodeById(nextNode.id);
    };

    try {
        await runNodeById(startNode.id);
    } catch (err) {
        console.error('Workflow run error:', err);
    } finally {
        socket.emit('workflow_complete');
    }
}
