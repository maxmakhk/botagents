#!/usr/bin/env node
import 'dotenv/config';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc } from 'firebase/firestore';

async function main() {
  const doDelete = process.argv.includes('--do-delete') || process.argv.includes('-y');

  const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || ''
  };

  if (!firebaseConfig.projectId) {
    console.error('Firebase projectId not set. Set FIREBASE_PROJECT_ID or VITE_FIREBASE_PROJECT_ID in .env');
    process.exit(1);
  }

  console.log('Initializing Firebase for project:', firebaseConfig.projectId);
  const app = initializeApp(firebaseConfig);
  const firestore = getFirestore(app);

  const rulesRef = collection(firestore, 'rules');
  console.log('Fetching documents from collection: rules');
  const snapshot = await getDocs(rulesRef);
  console.log(`Found ${snapshot.size} documents in 'rules'`);

  const toDelete = [];
  snapshot.forEach((d) => {
    try {
      const data = d.data();
      const wfRaw = data?.workflowObject;
      let wf = null;
      if (!wfRaw) {
        // no workflowObject field => consider empty
        wf = { nodes: [] };
      } else if (typeof wfRaw === 'string') {
        try { wf = JSON.parse(wfRaw); } catch (e) { wf = null; }
      } else if (typeof wfRaw === 'object') {
        wf = wfRaw;
      }

      const nodesLen = Array.isArray(wf?.nodes) ? wf.nodes.length : 0;
      if (nodesLen === 0) {
        toDelete.push({ id: d.id, data });
      }
    } catch (e) {
      console.warn('Error parsing doc', d.id, e.message);
    }
  });

  console.log(`
Documents with empty or missing nodes: ${toDelete.length}
`);
  toDelete.forEach((it) => console.log(` - ${it.id}`));

  if (!toDelete.length) {
    console.log('Nothing to delete. Exiting.');
    process.exit(0);
  }

  if (!doDelete) {
    console.log('\nDry run (no deletions). To actually delete run with --do-delete or -y');
    process.exit(0);
  }

  console.log('\nDeleting documents...');
  for (const it of toDelete) {
    try {
      const docRef = doc(rulesRef, it.id);
      await deleteDoc(docRef);
      console.log('Deleted', it.id);
    } catch (e) {
      console.error('Failed to delete', it.id, e.message);
    }
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
