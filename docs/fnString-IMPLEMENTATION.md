# fnString Support: Custom Workflow Functions

## Overview

This implementation adds support for **fnString** (function strings) to the workflow execution engine. fnString allows you to write custom JavaScript async functions that execute within workflow nodes, replacing or complementing the traditional API-based node execution.

## What's Changed

### 1. **Updated Hook: `useRunDemo.js`**

The main workflow runner now supports two execution modes:

#### Mode 1: Custom fnString (Priority)
If a node has a `fnString` field, the runner executes it with full access to workflow context. This allows:
- Complete custom logic implementation
- Multiple API calls with transformation
- Conditional branching within a node
- Advanced error handling and retry logic
- Flexible variable storage

#### Mode 2: Legacy API (Fallback)
Nodes without `fnString` continue to work as before:
- URL-based API calls
- Automatic result parsing
- Variable storage optimization

### 2. **New Types: `WorkflowTypes.ts`**

TypeScript interfaces for full type safety:
- `WorkflowNodeData`: Extended with `fnString` and `config` fields
- `FnStringContext`: The context object API for scripts
- `ScriptConfig`: Configuration object structure
- `RuleDocument`: Updated Firestore schema

### 3. **Migration Script: `migrateAddFnString.js`**

A production-ready Node.js script to:
- Add `fnString` (empty string) to all existing nodes
- Add `config` (empty object) to all existing nodes
- Handle pagination for large collections
- Use batch writes for efficiency
- Maintain backward compatibility

### 4. **Usage Guide: `fnStringUsageGuide.js`**

Comprehensive examples covering:
- Basic API calls
- Error handling and retry logic
- Multiple API calls with transformation
- Conditional routing
- Data validation
- Common patterns and best practices

## How to Use fnString

### Basic Example

```javascript
const node = {
  id: 'fetch_weather',
  type: 'action',
  position: { x: 0, y: 0 },
  data: {
    labelText: 'Fetch Weather',
    fnString: `
      const { fetch, config, setVar } = ctx;
      const url = config.baseUrl + '?q=' + config.city;
      const response = await fetch(url);
      const data = await response.json();
      setVar('weather', data);
    `,
    config: {
      baseUrl: 'https://api.open-meteo.com/v1/forecast',
      city: 'London',
    },
  },
};
```

### Context Object Reference

fnString functions receive a `ctx` object with:

```javascript
{
  fetch,           // window.fetch (for HTTP requests)
  console,         // Logging utility
  alert,           // Browser alert if available
  
  node,            // Current workflow node
  storeVars,       // Read-only workflow variables
  config,          // Node-specific configuration
  apis,            // Available API definitions
  
  setVar(name, value)  // Store a workflow variable
}
```

## Migration Guide

### For Firestore Documents

1. **Backup your data** before running the migration script

2. **Configure credentials**:
   ```bash
   # Option A: Set environment variable
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
   
   # Option B: Place key in project root
   cp /path/to/serviceAccountKey.json serviceAccountKey.json
   ```

3. **Run the migration**:
   ```bash
   # Default: migrate 'VariableManager-rules' collection, 100 docs per batch
   node scripts/migrateAddFnString.js
   
   # Custom collection and batch size
   node scripts/migrateAddFnString.js "my-collection" 50
   ```

4. **Verify**: Check Firestore console to confirm `fnString` and `config` fields were added

### For Existing Nodes

To convert a traditional API node to fnString:

**Before:**
```javascript
{
  type: 'api',
  data: {
    labelText: 'API: MyService',
    url: 'https://api.example.com/data',
    varName: 'result',
  },
}
```

**After:**
```javascript
{
  type: 'action',
  data: {
    labelText: 'Fetch Data',
    fnString: `
      const { fetch, setVar } = ctx;
      const response = await fetch('https://api.example.com/data');
      const data = await response.json();
      setVar('result', data);
    `,
  },
}
```

## Implementation Details

### Execution Flow

When a node runs:

1. **Check for fnString**
   - If present → execute it with context
   - If not present → fall through to legacy logic

2. **fnString Execution**
   - Wrap function body in async wrapper
   - Provide `ctx` parameter with all utilities
   - Execute and await completion
   - Handle errors gracefully

3. **Edge Selection**
   - Same conditional logic as before
   - Works with both fnString and legacy nodes
   - Supports edge labels, checkVar metadata, etc.

4. **Next Node**
   - Continue to next node based on selected edge
   - All workflow state is preserved in `storeVars`

### Variable Normalization

Variable names are normalized for consistency:
```javascript
const key = String(name || '').toLowerCase().replace(/\./g, '_');
// Input: "User.Email" → Output: "user_email"
// Input: "userEmail" → Output: "useremail"
```

## Error Handling

### fnString Errors

Errors in fnString execution are caught and logged:
```javascript
// Error is stored in storeVars
storeVars['node_<id>_error'] = error.message;

// Also logged to console for debugging
console.error(`Node ${id}: fnString execution error:`, error);
```

### Legacy API Errors

Errors in traditional API calls:
```javascript
setStoreVars(prev => ({
  ...prev,
  [normalizeVarKey(`node_${currentNode.id}_error`)]: error?.message || String(error),
}));
```

## Benefits

✅ **Full Control**: Write any JavaScript logic  
✅ **Flexibility**: Support complex workflows  
✅ **Reusability**: Package logic in nodes  
✅ **Backward Compatible**: Legacy nodes still work  
✅ **Type Safe**: TypeScript interfaces provided  
✅ **Well Integrated**: Uses existing workflow system  
✅ **Easy Migration**: Automatic migration script  

## Files Modified/Created

```
src/
  features/
    variableManager/
      hooks/
        useRunDemo.js ..................... MODIFIED (added fnString support)
      types/
        WorkflowTypes.ts .................. NEW
      docs/
        fnStringUsageGuide.js ............. NEW
scripts/
  migrateAddFnString.js ................... NEW
docs/
  fnString-IMPLEMENTATION.md ............. THIS FILE
```

## Testing

### Manual Testing

1. Create a node with fnString in your UI
2. Add a simple script:
   ```javascript
   fnString: `
     const { console, setVar } = ctx;
     console.log('Hello from fnString!');
     setVar('test_var', { timestamp: new Date().toISOString() });
   `
   ```
3. Run the workflow
4. Check browser console for logs
5. Verify `test_var` appears in storeVars

### Debugging

- Check browser console for detailed logs
- Look for `Node <id>: fnString execution error:` messages
- Verify `ctx` contents match expectations
- Test `setVar()` calls update storeVars

## Performance Considerations

- fnString execution is serial (not parallel)
- Heavy computation happens in the main thread
- Consider breaking into multiple nodes for long operations
- Use `console.time()` / `console.timeEnd()` for profiling

## Security Notes

⚠️ **Important**: fnString executes arbitrary JavaScript  

- Only allow trusted content
- Validate user input before using in scripts
- Be careful with credentials in `config`
- Consider using environment-based configuration

## Troubleshooting

### fnString not executing

**Problem**: fnString defined but not running

**Solution**:
- Check spelling: `data.fnString` (must be exact)
- Verify it's not inside a data object that's undefined
- Check browser console for parse errors

### Variables not persisting

**Problem**: setVar() called but variable isn't in storeVars

**Solution**:
- Verify variable name is correct
- Check for normalization (dots become underscores)
- Ensure setVar is called before workflow continues

### Async/await not working

**Problem**: Promises not resolving

**Solution**:
- Remember fnString body must use `await`
- All async operations should be awaited
- Check that async functions are being invoked with `()`

## Future Enhancements

Potential improvements:
- Browser/Node.js code separation
- Script template library
- Visual script builder
- Debugging breakpoints
- Performance monitoring
- Input/output validation schemas

## Support & Questions

For issues or questions:
1. Check the usage guide: `fnStringUsageGuide.js`
2. Review example nodes
3. Check TypeScript interfaces: `WorkflowTypes.ts`
4. Examine browser console logs during execution

## License

This implementation maintains the same license as the main project.
