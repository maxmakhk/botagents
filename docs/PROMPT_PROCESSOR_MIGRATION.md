# Prompt Processor Migration to Backend

## Overview
Migrated the entire prompt-to-workflow pipeline from React frontend to Node.js backend with real-time Socket.IO updates.

## Architecture Change

### Before (Frontend Processing)
```
User Input → normalizePrompt (AI call) → promptToFunction (AI call)
  → normalizeFn → fnToWorkflow → applyRemodelResponse
```
All processing happened in `handleNodePromptSubmit` (~200 lines of code in React component)

### After (Backend Processing with Real-time Updates)
```
Frontend: emit('process_prompt', {nodeId, promptText, apis, workflowData})
  ↓
Server: processPrompt() pipeline
  ├─ normalizePrompt() → emit('prompt_normalized')
  ├─ generateFunction() → emit('function_generated')
  ├─ normalizeFunctionString()
  └─ fnToWorkflow() → emit('workflow_ready')
  ↓
Frontend: Listen for events → Update UI → Apply workflow
```

## Files Modified

### 1. Backend: `server/workflowPromptProcessor.js` (NEW)
**Purpose**: Orchestrate the entire prompt-to-workflow pipeline server-side

**Key Functions**:
- `normalizePrompt(promptText)`: Calls AI endpoint to rewrite prompt into numbered steps
- `generateFunction(normalizedPrompt)`: Calls AI endpoint to generate JavaScript function
- `normalizeFunctionString(fnString, apis)`: Injects API call console.logs into storeVars declarations
- `processPrompt({nodeId, promptText, apis, workflowData})`: Main orchestrator that chains all steps

**Returns**:
```javascript
{
  nodeId,
  originalPrompt,
  normalizedPrompt,
  fnString,
  normalizeFnString,
  workflowData: { nodes, edges, ...metadata }
}
```

### 2. Backend: `server/index.js` 
**Added**: Socket.IO event handler for `process_prompt`

**Event Flow**:
1. Receives: `{nodeId, promptText, apis, workflowData}`
2. Emits progress events:
   - `prompt_processing_start` - Processing began
   - `prompt_normalized` - Normalized prompt ready
   - `function_generated` - JavaScript function generated
   - `workflow_ready` - Complete workflow data ready
   - `prompt_error` - Error occurred (with message)

### 3. Frontend: `src/features/variableManager/hooks/useRunDemo.js`
**Changed**: Exported `socketRef` so parent components can access Socket.IO connection

**Return Object**:
```javascript
{
  runProject,
  runActive,
  activeNodeId,
  activeEdgeId,
  storeVars,
  setStoreVars,
  socketRef  // ← NEW
}
```

### 4. Frontend: `src/features/VariableManager.jsx`
**Refactored**: `handleNodePromptSubmit` function (~200 lines → ~60 lines)

**Old Approach**:
- Local AI fetch calls
- Synchronous pipeline execution
- No progress feedback
- Heavy frontend computation

**New Approach**:
```javascript
// 1. Remove old listeners
socketRef.current.off('prompt_normalized');
socketRef.current.off('function_generated');
socketRef.current.off('workflow_ready');
socketRef.current.off('prompt_error');

// 2. Register listeners for progress events
socketRef.current.on('prompt_normalized', (data) => {
  console.log('Prompt normalized:', data.normalizedPrompt);
});

socketRef.current.on('function_generated', (data) => {
  console.log('Function generated:', data.fnString);
  setTaskFunctionText(data.fnString);
});

socketRef.current.on('workflow_ready', (data) => {
  const groupColor = getRandLightColor();
  const coloredNodes = applyGroupColorToNodes(data.nodes, groupColor);
  const finalWorkflowData = { ...data.workflowData, nodes: coloredNodes };
  applyRemodelResponse(nodeId, finalWorkflowData, related, data.workflowData);
});

socketRef.current.on('prompt_error', (data) => {
  console.warn('Prompt processing error:', data.message);
});

// 3. Emit processing request
socketRef.current.emit('process_prompt', {
  nodeId,
  promptText,
  apis,
  workflowData
});
```

## Benefits

### 1. **Separation of Concerns**
- Frontend focuses on UI and user interaction
- Backend handles heavy computation and AI calls
- Clear boundary between presentation and business logic

### 2. **Real-time Progress Feedback**
- Users see each step of the pipeline as it completes
- Better UX for long-running AI operations
- Can show loading states, progress indicators, etc.

### 3. **Better Error Handling**
- Centralized error handling on backend
- Specific error events sent to frontend
- Easier debugging with server-side logs

### 4. **Performance**
- Offloads computation from browser
- Non-blocking UI during processing
- Socket.IO provides efficient real-time updates

### 5. **Scalability**
- Backend can handle multiple concurrent requests
- Can add queuing, rate limiting, caching
- Easier to monitor and optimize server-side

## Environment Variables Required

Backend needs:
- `VITE_AI_CHAT_ENDPOINT` - AI chat/completion endpoint for prompt normalization and function generation

## Testing

To test the new pipeline:

1. Start backend server:
```bash
cd server
node index.js
```

2. Start frontend:
```bash
npm run dev
```

3. In VariableManager:
   - Click on a node
   - Enter a prompt like: "check openweather, if success go to end, if fail retry"
   - Submit the prompt
   - Watch console for Socket.IO events: prompt_normalized → function_generated → workflow_ready

4. Verify:
   - ✅ Workflow graph updates with new nodes/edges
   - ✅ Console shows each processing step
   - ✅ Function text is displayed (if UI supports it)
   - ✅ No frontend errors

## Troubleshooting

### "Socket.IO connection not available"
- Check that `useRunDemo` is initializing Socket.IO connection
- Verify backend server is running on correct port
- Check CORS settings in `server/index.js`

### "Prompt processing error"
- Check `VITE_AI_CHAT_ENDPOINT` environment variable is set
- Verify AI endpoint is accessible from server
- Check server console logs for detailed error messages

### Workflow doesn't update
- Verify `applyRemodelResponse` function is working
- Check that `workflow_ready` event is being received
- Verify `nodes` and `edges` are in the correct format

## Future Enhancements

- [ ] Add progress percentage tracking
- [ ] Add cancel/abort functionality
- [ ] Add workflow validation before applying
- [ ] Add retry logic for failed AI calls
- [ ] Add caching for frequently used prompts
- [ ] Add batch processing for multiple prompts
- [ ] Add webhook support for async processing
