import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc, deleteField } from 'firebase/firestore';

export const fetchVariables = async (db) => {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'variables'));
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  return items;
};

export const createVariableDoc = async (db, payload) => {
  if (!db) return null;
  const docRef = await addDoc(collection(db, 'variables'), {
    ...payload,
    createdAt: payload.createdAt || new Date(),
  });
  return docRef;
};

export const updateVariableDoc = async (db, id, payload) => {
  if (!db || !id) return;
  const variableRef = doc(db, 'variables', id);
  await updateDoc(variableRef, payload);
};

export const deleteVariableDoc = async (db, id) => {
  if (!db || !id) return;
  await deleteDoc(doc(db, 'variables', id));
};

export const updateSignalDoc = async (db, id, signalName, payload) => {
  if (!db || !id || !signalName) return;
  const variableRef = doc(db, 'variables', id);
  await updateDoc(variableRef, {
    [`signal.${signalName}`]: payload,
    updatedAt: serverTimestamp(),
  });
};

export const updateSignalFieldDoc = async (db, id, signalName, fieldName, value) => {
  if (!db || !id || !signalName || !fieldName) return;
  const variableRef = doc(db, 'variables', id);
  await updateDoc(variableRef, {
    [`signal.${signalName}.${fieldName}`]: value,
    [`signal.${signalName}.lastUpdatedAt`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const removeSignalDoc = async (db, id, signalName) => {
  if (!db || !id || !signalName) return;
  const variableRef = doc(db, 'variables', id);
  await updateDoc(variableRef, {
    [`signal.${signalName}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
};
