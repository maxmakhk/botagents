import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';

/**
 * Load logs from Firestore
 */
export async function loadLogs(db, { loadAll = false } = {}) {
  try {
    let q;
    if (loadAll) {
      q = query(collection(db, 'VariableManager-log'), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'VariableManager-log'), orderBy('createdAt', 'desc'), limit(10));
    }
    
    const snap = await getDocs(q);
    const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    
    return {
      logs: entries,
      allLoaded: loadAll,
    };
  } catch (err) {
    console.error('Error loading logs:', err);
    throw err;
  }
}

/**
 * Append a log entry
 */
export async function appendLog(db, entry) {
  try {
    await addDoc(collection(db, 'VariableManager-log'), {
      ...entry,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error appending log entry:', err);
    throw err;
  }
}
