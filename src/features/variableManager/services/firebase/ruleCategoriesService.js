import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
} from 'firebase/firestore';

/**
 * Load rule categories from Firestore
 */
export async function loadRuleCategories(db) {
  try {
    const q = query(collection(db, 'VariableManager-ruleCategories'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    let arr = [];
    
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));

    // Create StandardRule category if none exist
    if (arr.length === 0) {
      const createdAt = new Date();
      const docRef = await addDoc(collection(db, 'VariableManager-ruleCategories'), {
        name: 'StandardRule',
        createdAt,
      });
      arr = [{ id: docRef.id, name: 'StandardRule', createdAt }];
    }

    return arr;
  } catch (err) {
    console.error('Error loading rule categories:', err);
    throw err;
  }
}

/**
 * Save or update a rule category
 */
export async function saveRuleCategory(db, { categoryId, name }) {
  try {
    if (categoryId) {
      await updateDoc(doc(db, 'VariableManager-ruleCategories', categoryId), {
        name,
        updatedAt: new Date(),
      });
    } else {
      await addDoc(collection(db, 'VariableManager-ruleCategories'), {
        name,
        createdAt: new Date(),
      });
    }
  } catch (err) {
    console.error('Error saving rule category:', err);
    throw err;
  }
}

/**
 * Delete a rule category
 */
export async function deleteRuleCategory(db, id) {
  try {
    await deleteDoc(doc(db, 'VariableManager-ruleCategories', id));
  } catch (err) {
    console.error('Error deleting category:', err);
    throw err;
  }
}

/**
 * Resolve the default category ID (StandardRule or first)
 */
export function resolveDefaultCategoryId(categories = []) {
  const standard = categories.find((c) => (c?.name || '').toLowerCase() === 'standardrule');
  return standard ? standard.id : (categories[0]?.id || '');
}
