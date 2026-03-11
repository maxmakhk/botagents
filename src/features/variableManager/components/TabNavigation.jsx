import React from 'react';

const TabNavigation = ({ activeTab, setActiveTab, onShowRunningList }) => {
  const tabs = [
    { id: 'variableTable', label: 'Variable Table' },
    { id: 'ruleChecker', label: 'Rule Checker' },
    { id: 'ruleCategory', label: 'Rule Category' },
    { id: 'manualEdit', label: 'Manual Edit' },
    { id: 'externalApi', label: 'Components' },
    { id: 'variablePrompt', label: 'Projects' },
    { id: 'logs', label: 'Variable Manager Log' }
  ];

  return (
    <div  id="tabB" style={{display: 'flex', gap: 0, marginBottom: 0, borderBottom: '2px solid #1f2937', alignItems: 'center'}}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          style={{
            padding: '10px 16px',
            background: activeTab === tab.id ? '#111827' : 'transparent',
            color: activeTab === tab.id ? '#3b82f6' : '#9ca3af',
            border: 'none',
            borderBottom: activeTab === tab.id ? '3px solid #3b82f6' : '3px solid transparent',
            cursor: 'pointer',
            fontWeight: activeTab === tab.id ? 'bold' : 'normal',
            fontSize: '0.9rem'
          }}
        >
          {tab.label}
        </button>
      ))}
      
      {/* Running List Button */}
      <div style={{marginLeft: 'auto', paddingRight: '10px'}}>
        {onShowRunningList && (
          <button
            onClick={() => onShowRunningList()}
            title="Show running flows"
            style={{
              padding: '8px 12px',
              background: '#1f2937',
              color: '#10b981',
              border: '1px solid #10b981',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: '600',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#10b981';
              e.target.style.color = '#111827';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#1f2937';
              e.target.style.color = '#10b981';
            }}
          >
            🔄 Running Flows
          </button>
        )}
      </div>
    </div>
  );
};

export default TabNavigation;
