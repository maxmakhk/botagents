import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
};

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--apply');

const toMillis = (value, fallback = 0) => {
  if (!value) return fallback;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return fallback;
};

const run = async () => {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const snapshot = await getDocs(collection(db, 'VariableManager-rules'));
  const groups = new Map();

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const rawName = typeof data.name === 'string' ? data.name.trim() : '';
    if (!rawName) return;

    const key = rawName.toLowerCase();
    const createdAt = toMillis(data.createdAt, 0);
    const updateTime = docSnap.updateTime ? docSnap.updateTime.toMillis() : 0;

    const entry = {
      id: docSnap.id,
      ref: docSnap.ref,
      name: rawName,
      createdAt,
      updateTime
    };

    if (!groups.has(key)) {
      groups.set(key, [entry]);
      return;
    }
    groups.get(key).push(entry);
  });

  let totalDuplicates = 0;
  let totalDeletes = 0;

  for (const [key, entries] of groups.entries()) {
    if (entries.length <= 1) continue;

    entries.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
      return b.updateTime - a.updateTime;
    });

    const keep = entries[0];
    const toDelete = entries.slice(1);
    totalDuplicates += toDelete.length;

    console.log(`Name: "${keep.name}" -> keep ${keep.id}, delete ${toDelete.length}`);
    toDelete.forEach((e) => console.log(`  delete: ${e.id}`));

    if (!dryRun) {
      for (const entry of toDelete) {
        await deleteDoc(entry.ref);
        console.log(`Deleted ${entry.id}`);
        totalDeletes += 1;
      }
    }
  }

  console.log(`Duplicates found: ${totalDuplicates}`);
  if (dryRun) {
    console.log('Dry run only. Re-run with --apply to delete.');
  } else {
    console.log(`Deleted: ${totalDeletes}`);
  }
};

run().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
