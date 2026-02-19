import { useState, useCallback } from 'react';
import {
  loadLogs as firebaseLoadLogs,
  appendLog as firebaseAppendLog,
} from '../services/firebase/logsService';

/**
 * useLogs hook
 * Manages application logs
 */
export default function useLogs(db) {
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsAllLoaded, setLogsAllLoaded] = useState(false);

  // Load logs
  const loadLogs = useCallback(
    async (loadAll = false) => {
      setLogsLoading(true);
      try {
        const result = await firebaseLoadLogs(db, { loadAll });
        setLogs(result.logs);
        setLogsAllLoaded(result.allLoaded);
      } catch (err) {
        console.error('Error loading logs:', err);
      } finally {
        setLogsLoading(false);
      }
    },
    [db]
  );

  // Append log
  const appendLog = useCallback(
    async (entry) => {
      try {
        await firebaseAppendLog(db, entry);
        // Reload first 10 logs after appending
        const result = await firebaseLoadLogs(db, { loadAll: false });
        setLogs(result.logs);
      } catch (err) {
        console.error('Error appending log:', err);
      }
    },
    [db]
  );

  return {
    logs,
    setLogs,
    logsLoading,
    logsAllLoaded,
    setLogsAllLoaded,
    loadLogs,
    appendLog,
  };
}
