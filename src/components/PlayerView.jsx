import React, { useEffect, useRef, useState } from 'react';
import useRunDemo from '../features/variableManager/hooks/useRunDemo';

const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__) || import.meta.env.VITE_API_BASE || 'http://localhost:3001';

export default function PlayerView({ onBack }) {
  const { socketRef, allWorkflows, setGlobalVar, globalStoreVars, storeVars } = useRunDemo();
  const [lines, setLines] = useState([]);
  const containerRef = useRef(null);
  const selectedCategoryRef = useRef('all');
  
  // Category filtering state
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  useEffect(() => { selectedCategoryRef.current = selectedCategory; }, [selectedCategory]);

  // Load categories on mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        setCategoriesLoading(true);
        const resp = await fetch(`${API_BASE}/api/rule-categories`);
        if (!resp.ok) throw new Error('Failed to load categories');
        const data = await resp.json();
        setCategories(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load categories:', err);
        setCategories([]);
      } finally {
        setCategoriesLoading(false);
      }
    };
    loadCategories();
  }, []);

  useEffect(() => {
    const push = (obj) => setLines((prev) => [...prev, { ts: Date.now(), ...obj }]);

    const attach = () => {
      const s = socketRef?.current;
      if (!s) return;

      const onClientJS = (data) => {
        console.log(`[PlayerView] A`, data);
        if (!data) {
          console.log('[PlayerView] ⚠️ Received empty clientJS data');
          return;
        }
        // try common locations for client JS code
        const code = data.clientJS || data.clientJs || data.client_code || (data.payload && (data.payload.clientJS || data.payload.clientJs));
        if (!code || typeof code !== 'string' || !code.trim()) {
          console.log('[PlayerView] ℹ️ Received event but no clientJS code found');
          return;
        }
        console.log("[PlayerView] 📨 Received clientJS event:", { nodeId: data.nodeId, categoryId: data.categoryId, codeLength: code.length });

        // Filter by project category
        // Extract category from data payload
        const dataCategory = data?.categoryId || data?.category || data?.category_id || (data.payload && (data.payload.categoryId || data.payload.category || data.payload.category_id)) || null;
        const currentCat = selectedCategoryRef.current;
        
        console.log(`[PlayerView] 🔍 Category check - Message categoryId: ${dataCategory}, Selected category: ${currentCat}`);
        
        // If a specific category is selected, only execute clientJS from that category
        // If 'all' is selected, execute all clientJS regardless of category
        if (currentCat && currentCat !== 'all') {
          if (!dataCategory || String(dataCategory) !== String(currentCat)) {
            console.log("[PlayerView] Skipping clientJS - category mismatch. Expected:", currentCat, "Got:", dataCategory);
            return;
          }
        }

        const nodeId = data.nodeId || data.node_id || (data.payload && data.payload.nodeId) || null;
        const nodeName = data.nodeName || data.node_name || (data.payload && data.payload.nodeName) || null;

        // Execute client JS in a controlled wrapper. Provide helpers similar to runtime.
        const getGlobalVar = (key) => {
          try { return (globalStoreVars || {})[key]; } catch (e) { return undefined; }
        };
        const setGlobalVarForClientJS = (key, value) => {
          try {
            if (!key) throw new Error('Key required');
            // call the hook's setGlobalVar (may return a Promise)
            try { setGlobalVar(key, value); } catch (e) { /* ignore */ }
            return true;
          } catch (e) { return false; }
        };

        try {
          console.log("[PlayerView] clientJS", nodeId, code);
          const fn = new Function('setGlobalVar', 'getGlobalVar', 'globalStoreVars', 'storeVars', code);
          console.log("[PlayerView] B ", nodeId, code);
          // execute; don't capture/print source — only log execution
          fn(setGlobalVarForClientJS, getGlobalVar, globalStoreVars || {}, storeVars || {});
          push({ type: 'client_js_exec', data: { nodeId, nodeName, message: 'executed', category: dataCategory } });
        } catch (e) {
          push({ type: 'client_js_exec_error', data: { nodeId, nodeName, error: String(e), category: dataCategory } });
        }
      };

      s.on('client_js_exec', onClientJS);

      // cleanup
      return () => {
        try { s.off('client_js_exec', onClientJS); } catch (e) {}
      };
    };

    let cleanupFn = null;
    if (socketRef && socketRef.current) {
      cleanupFn = attach();
    }

    const onConnect = () => {
      if (cleanupFn) return;
      cleanupFn = attach();
    };

    try { socketRef?.current?.on('connect', onConnect); } catch (e) {}

    return () => {
      try { socketRef?.current?.off('connect', onConnect); } catch (e) {}
      if (typeof cleanupFn === 'function') cleanupFn();
    };
  }, [socketRef]);

  // Watch/unwatch category when it changes
  useEffect(() => {
    const s = socketRef?.current;
    if (!s) {
      console.log('[PlayerView] ⚠️ Socket not available in effect');
      return;
    }

    if (selectedCategory && selectedCategory !== 'all') {
      console.log(`[PlayerView] 📤 Emitting set_project_category with projectcategoryId: ${selectedCategory}`);
      s.emit('set_project_category', { projectcategoryId: selectedCategory });
    } else if (selectedCategory === 'all') {
      console.log(`[PlayerView] ℹ️ Selected category is 'all', skipping set_project_category`);
    }

    return () => {
      // Optionally emit unwatch when component unmounts or category changes
      // But since we're just filtering in the client, we can keep listening
    };
  }, [selectedCategory, socketRef]);

  useEffect(() => {
    // auto-scroll to bottom when new lines arrive
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div 
    id="outputview"
    style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
      <div style={{padding: 8, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
        <button onClick={onBack}>Back</button>
        <div style={{marginLeft:16, display:'flex', gap:8, alignItems:'center'}}>
          <label style={{marginRight:4}}>Category:</label>
          <select 
          id="playerViewProjectCategory"
          value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={{padding:6, borderRadius:4, border:'1px solid #475569', background:'#020617', color:'#e5e7eb'}}>
            <option value="all">All Categories</option>
            {(categories || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
          <button 
            onClick={() => {
              // Refresh categories
              const loadCategories = async () => {
                try {
                  const resp = await fetch(`${API_BASE}/api/rule-categories`);
                  if (resp.ok) {
                    const data = await resp.json();
                    setCategories(Array.isArray(data) ? data : []);
                  }
                } catch (err) {
                  console.error('Failed to refresh categories:', err);
                }
              };
              loadCategories();
            }}
            style={{padding:'6px 10px', background:'#0ea5b7', color:'#000', border:'none', borderRadius:4, cursor:'pointer'}}
            title="Refresh categories"
          >
            ↻ Refresh
          </button>
        </div>
      </div>
      <div id="ms-apiresults-body" ref={containerRef} style={{flex:1, overflow:'auto', background:'#0f1419', padding:8, color:'#e5e7eb'}}>
      </div>
    </div>
  );
}
