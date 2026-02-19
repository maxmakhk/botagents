import React, { useEffect, useRef, useState } from 'react';
import './apiNodesFloating.css';

export default function ApiNodesFloating({ apis = [], onInsert = () => {}, onClose = () => {} }) {
  const nodeRef = useRef(null);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ right: 400, top: 80 });
  const injectedRef = useRef(new Map());

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Keep injected styles in sync: remove styles for APIs that disappeared and cleanup on unmount
  useEffect(() => {
    try {
      const current = new Set((apis || []).map(a => a.id || (a.name || 'api').replace(/\W+/g, '_') + '_' + String(a.url || '').slice(0, 8)));
      // remove any injected styles that are no longer present
      for (const [k, v] of Array.from(injectedRef.current.entries())) {
        if (!current.has(k)) {
          try { if (v && v.styleEl && v.styleEl.parentNode) v.styleEl.parentNode.removeChild(v.styleEl); } catch(e){}
          injectedRef.current.delete(k);
        }
      }
    } catch (e) {
      // ignore
    }
    return () => {
      // on unmount, remove all injected
      try {
        for (const [k, v] of Array.from(injectedRef.current.entries())) {
          try { if (v && v.styleEl && v.styleEl.parentNode) v.styleEl.parentNode.removeChild(v.styleEl); } catch(e){}
        }
      } catch (e) {}
      injectedRef.current.clear();
    };
  }, [apis]);

  const filtered = (apis || []).filter(a => {
    if (!query) return true;
    const q = String(query).toLowerCase();
    return String(a.name || a.label || '').toLowerCase().includes(q) || (Array.isArray(a.tags) && a.tags.join(',').toLowerCase().includes(q));
  });

  return (
    <div ref={nodeRef} className="ms-apinodes-floating" style={{ right: pos.right + 'px', top: pos.top + 'px' }}>
      <div className="ms-apinodes-header">
        <div style={{fontWeight:700}}>API Nodes</div>
        <div style={{display:'flex', gap:8}}>
          <button onClick={onClose} className="ms-apinodes-close">✕</button>
        </div>
      </div>
      <div className="ms-apinodes-search">
        <input placeholder="Filter APIs..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="ms-apinodes-list">
        {filtered.map((a) => {
          // ensure css injected for this api if provided
          const apiId = a.id || (a.name || 'api').replace(/\W+/g, '_') + '_' + String(a.url || '').slice(0, 8);
          const metaCss = a.metadata && a.metadata.cssStyle ? String(a.metadata.cssStyle) : (a.cssStyle ? String(a.cssStyle) : null);
          let apiClass = '';
          try {
            const injected = injectedRef.current.get(apiId);
            if (!injected && metaCss) {
              const className = `ms-api-css-${apiId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
              const scoped = metaCss.replace(/\.api-node\b/g, `.${className}`);
              const styleEl = document.createElement('style');
              styleEl.setAttribute('data-ms-api-css', apiId);
              styleEl.innerText = scoped;
              document.head.appendChild(styleEl);
              injectedRef.current.set(apiId, { styleEl, className });
              apiClass = className;
            } else if (injected) {
              apiClass = injected.className;
            }
          } catch (err) {
            // ignore injection errors
          }

          return (
            <div key={a.id || apiId} className={`ms-apinodes-item ${apiClass}`} onClick={() => { onInsert(a); onClose(); }}>
              <div className="ms-apinodes-thumb">
                {a.metadata?.image || a.image ? (<img src={a.metadata?.image || a.image} alt={a.name} onError={(e) => { e.target.style.display='none'; }} />) : (
                  <div className="ms-apinodes-placeholder">API</div>
                )}
              </div>
              <div className="ms-apinodes-info">
                <div className="ms-apinodes-name">{a.name || a.label}</div>
                <div className="ms-apinodes-desc">{a.url || (a.metadata && a.metadata.apiUrl) || ''}</div>
              </div>
            </div>
          );
        })}
        {!filtered.length && (
          <div className="ms-apinodes-empty">No APIs match.</div>
        )}
      </div>
    </div>
  );
}
