import { useState, useCallback } from 'react';
import {
  loadApis as firebaseLoadApis,
  addApi as firebaseAddApi,
  deleteApi as firebaseDeleteApi,
  saveApiPrompt as firebaseSaveApiPrompt,
  updateApiMetadata as firebaseUpdateApiMetadata,
  testApi as firebaseTestApi,
} from '../services/firebase/apisService';

// Fallback fetch for testing API logs (UI logs panel auto-refreshes when opened)
async function appendLogToBackend(entry) {
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  try {
    await fetch(`${API_BASE}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch (err) {
    console.error('Failed to append log:', err);
  }
}
/**
 * useExternalApis hook
 * Manages external API configuration and testing
 */
export default function useExternalApis(db) {
  const [apis, setApis] = useState([]);
  const [apisLoading, setApisLoading] = useState(false);
  const [newApiName, setNewApiName] = useState('');
  const [newApiUrl, setNewApiUrl] = useState('');
  const [selectedApiId, setSelectedApiId] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testInput, setTestInput] = useState('');

  // Load APIs
  const loadApis = useCallback(async () => {
    setApisLoading(true);
    try {
      const items = await firebaseLoadApis(db);
      setApis(items);
    } catch (err) {
      console.error('Error loading APIs:', err);
    } finally {
      setApisLoading(false);
    }
  }, [db]);

  // Add API
  const addApi = useCallback(
    async (name, url, tags = '', fn = '', cssStyle = '') => {
      try {
        const newApi = await firebaseAddApi(db, { name, url, tags, function: fn, cssStyle });
        setApis((s) => [...s, newApi]);
        setNewApiName('');
        setNewApiUrl('');
      } catch (err) {
        console.error('Error adding API:', err);
        throw err;
      }
    },
    [db]
  );

  // Delete API
  const deleteApi = useCallback(
    async (id) => {
      try {
        await firebaseDeleteApi(db, id);
        setApis((s) => s.filter((a) => a.id !== id));
      } catch (err) {
        console.error('Error deleting API:', err);
        throw err;
      }
    },
    [db]
  );

  // Save API prompt
  const saveApiPrompt = useCallback(
    async (apiId, prompt) => {
      try {
        await firebaseSaveApiPrompt(db, apiId, prompt);
        setApis((s) => s.map((a) => (a.id === apiId ? { ...a, lastPrompt: prompt, updatedAt: new Date() } : a)));
      } catch (err) {
        console.error('Error saving API prompt:', err);
        throw err;
      }
    },
    [db]
  );

  // Test API
  const testApi = useCallback(
    async (api, promptOverride = null) => {
      if (!api || !api.url) return;

      const prompt = promptOverride !== null ? promptOverride : (api.lastPrompt || testInput || '');
      setTesting(true);
      setTestResult(null);

      try {
        // Save prompt to api record first
        await saveApiPrompt(api.id, prompt);

        // Call Firebase test function
        const result = await firebaseTestApi(api, prompt);
        // Log the attempt (use data returned from tester)
        const entry = {
          prompt,
          endpoint: api.url,
          rawResponse: result && result.text ? result.text : '',
          parsed: result && result.parsed ? result.parsed : null,
          parseError: result && result.parseError ? result.parseError : null,
          action: 'xAI-test',
          warning: result && result.ok === false ? `HTTP ${result.status || 'error'}` : null,
          createdAt: new Date(),
        };
        try { await appendLogToBackend(entry); } catch (e) { console.error('Failed to append test log', e); }

        // Return result to UI
        setTestResult(result || { ok: false, error: 'No result' });
        return result;
      } finally {
        setTesting(false);
      }
    },
    [testInput, saveApiPrompt, db]
  );

  // Update API metadata (tags, function, name, url)
  const updateApiMetadata = useCallback(
    async (apiId, metadata) => {
      try {
        await firebaseUpdateApiMetadata(db, apiId, metadata);
        setApis((s) => s.map((a) => (a.id === apiId ? { ...a, ...metadata } : a)));
      } catch (err) {
        console.error('Error updating API metadata:', err);
        throw err;
      }
    },
    [db]
  );

  return {
    apis,
    setApis,
    apisLoading,
    newApiName,
    setNewApiName,
    newApiUrl,
    setNewApiUrl,
    selectedApiId,
    setSelectedApiId,
    testing,
    testResult,
    testInput,
    setTestInput,
    loadApis,
    addApi,
    deleteApi,
    saveApiPrompt,
    updateApiMetadata,
    testApi,
  };
}
