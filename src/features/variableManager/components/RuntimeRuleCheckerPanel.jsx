import React from 'react';

const RuntimeRuleCheckerPanel = ({
  ruleCheckerInterval,
  setRuleCheckerInterval,
  ruleCheckerRunning,
  setRuleCheckerRunning,
  ruleCheckerResults,
  showRuleCheckerPopup,
  setShowRuleCheckerPopup,
}) => {
  return (
    <>
      <div style={{
        marginTop: 12,
        padding: 12,
        background: '#0b1220',
        borderRadius: 8,
        border: '1px solid #1f2937',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        float: 'right'
      }}>
        <label style={{fontWeight: 'bold', fontSize: '0.9rem'}}>Rule Checking:</label>
        <input 
          type="number" 
          value={ruleCheckerInterval}
          onChange={e => setRuleCheckerInterval(Math.max(100, parseInt(e.target.value) || 1000))}
          style={{width: 80, padding: 6, borderRadius: 4, border: '1px solid #475569', background: '#020617', color: '#e5e7eb'}}
        />
        <span style={{fontSize: '0.85rem', color: '#9ca3af'}}>ms</span>
        <button
          className={ruleCheckerRunning ? 'btn-cancel' : 'btn-primary'}
          onClick={() => setRuleCheckerRunning(!ruleCheckerRunning)}
          style={{padding: '6px 12px', fontSize: '0.85rem'}}
        >
          {ruleCheckerRunning ? 'Pause' : 'Run'}
        </button>
        {ruleCheckerResults.some(r => r.matched.length > 0) && (
          <button
            onClick={() => setShowRuleCheckerPopup(!showRuleCheckerPopup)}
            style={{
              padding: '6px 10px',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '1rem',
              minWidth: 30,
              textAlign: 'center',
              right: '80px', 
              top: '110px'

            }}
            title={`${ruleCheckerResults.reduce((sum, r) => sum + r.matched.length, 0)} results`}
          >
            ⚠
          </button>
        )}
      </div>

      {showRuleCheckerPopup && (
        <div style={{
          marginTop: 12,
          padding: 16,
          background: '#0b1220',
          borderRadius: 8,
          border: '2px solid #ef4444',
          maxHeight: 400,
          overflow: 'auto'
        }}>
          <h4 style={{marginTop: 0}}>Rule Checking Results</h4>
          {ruleCheckerResults.map((result, idx) => (
            <div key={idx} style={{marginBottom: 12, padding: 8, background: '#020617', borderRadius: 6}}>
              <div style={{fontWeight: 'bold', marginBottom: 4, color: '#3b82f6'}}>
                Rule {result.ruleIndex + 1}: {result.rulePrompt || 'N/A'}
              </div>
              <div style={{fontSize: '0.85rem', color: '#9ca3af', marginBottom: 4, fontFamily: 'monospace'}}>
                {result.ruleExpression}
              </div>
              {result.matched.length > 0 ? (
                <div style={{fontSize: '0.9rem', color: '#e5e7eb'}}>
                  {result.matched.map((msg, midx) => (
                    <div key={midx} style={{marginLeft: 8}}>• {msg}</div>
                  ))}
                </div>
              ) : (
                <div style={{fontSize: '0.9rem', color: '#6b7280'}}>no result...</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default RuntimeRuleCheckerPanel;
