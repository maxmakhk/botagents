/**
 * Firestore Migration Script: Add fnString and config fields to workflow nodes
 *
 * Usage:
 *   1. Update the collection path if needed (e.g., "VariableManager-rules" or custom path)
 *   2. Run with: node migrateAddFnString.js
 *   3. Ensure FIREBASE_CONFIG environment variable or credentials are set
 *
 * This script:
 *   - Iterates through all documents in a Firestore collection
 *   - For each document with a workflowObject, examines all nodes
 *   - Adds fnString (empty string) and config (empty object) if missing
 *   - Uses Firestore batched writes to efficiently update documents
 *   - Handles pagination to support large collections
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Firebase Admin SDK
// Option 1: If running in Firebase Cloud Functions or with GOOGLE_APPLICATION_CREDENTIALS env var
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp();
} else {
  // Option 2: Explicitly load service account key (for local development)
  const serviceAccountPath = process.env.FIREBASE_KEY_PATH || './serviceAccountKey.json';
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // Option 3: Assume default credentials (gcloud auth)
    admin.initializeApp();
  }
}

const db = admin.firestore();

/**
 * Add fnString and config fields to a single node object
 * Returns true if the node was modified
 */
function addMissingFieldsToNode(node) {
  let modified = false;

  // Ensure node.data exists
  if (!node.data) {
    node.data = {};
    modified = true;
  }

  // Add fnString if missing
  if (!('fnString' in node.data)) {
    node.data.fnString = ''; // Empty string as default
    modified = true;
  }

  // Add config if missing
  if (!('config' in node.data)) {
    node.data.config = {}; // Empty object as default
    modified = true;
  }

  return modified;
}

/**
 * Process all nodes in a workflow object
 * Returns true if any changes were made
 */
function processWorkflowNodes(workflowObj) {
  if (!workflowObj || typeof workflowObj !== 'object') {
    return false;
  }

  let modified = false;

  // Handle legacy format: workflowObj as array of nodes
  if (Array.isArray(workflowObj)) {
    workflowObj.forEach((node) => {
      if (addMissingFieldsToNode(node)) {
        modified = true;
      }
    });
  } else if (workflowObj.nodes && Array.isArray(workflowObj.nodes)) {
    // Handle new format: { nodes: [...], edges: [...] }
    workflowObj.nodes.forEach((node) => {
      if (addMissingFieldsToNode(node)) {
        modified = true;
      }
    });
  }

  return modified;
}

/**
 * Migrate a single document
 * Returns true if the document was updated
 */
async function migrateDocument(docRef, docData) {
  const workflowRaw = docData.workflowObject;
  let workflowObj = null;

  // Parse workflowObject (could be string, array, or object)
  try {
    if (typeof workflowRaw === 'string') {
      workflowObj = JSON.parse(workflowRaw);
    } else if (Array.isArray(workflowRaw) || (workflowRaw && typeof workflowRaw === 'object')) {
      workflowObj = workflowRaw;
    }
  } catch (e) {
    console.warn(`  ⚠️  Could not parse workflowObject for ${docRef.id}:`, e.message);
    return false;
  }

  if (!workflowObj) {
    return false;
  }

  // Process nodes
  const modified = processWorkflowNodes(workflowObj);

  if (modified) {
    // Convert back to string if it was originally a string
    const updatePayload = {
      workflowObject:
        typeof workflowRaw === 'string'
          ? JSON.stringify(workflowObj)
          : workflowObj,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    console.log(`  ✓ Updating document ${docRef.id}`);
    await docRef.update(updatePayload);
    return true;
  }

  return false;
}

/**
 * Main migration function with pagination support
 */
async function addFnStringFieldToNodes(collectionPath = 'VariableManager-rules', pageSize = 100) {
  console.log(`\n🚀 Starting migration: Adding fnString and config fields to ${collectionPath}`);
  console.log(`   Collection: ${collectionPath}`);
  console.log(`   Page size: ${pageSize}\n`);

  const collectionRef = db.collection(collectionPath);
  let query = collectionRef.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
  let processedCount = 0;
  let updatedCount = 0;
  let lastDocId = null;

  try {
    while (true) {
      // Construct query with pagination
      if (lastDocId) {
        query = collectionRef
          .orderBy(admin.firestore.FieldPath.documentId())
          .startAfter(lastDocId)
          .limit(pageSize);
      }

      const snapshot = await query.get();

      if (snapshot.empty) {
        console.log(`\n✅ Migration complete!`);
        console.log(`   Total processed: ${processedCount}`);
        console.log(`   Total updated: ${updatedCount}\n`);
        return { processed: processedCount, updated: updatedCount };
      }

      // Process documents in this batch
      console.log(`\n📄 Processing ${snapshot.docs.length} documents...`);

      const batch = db.batch();
      let batchUpdateCount = 0;

      for (const docSnapshot of snapshot.docs) {
        const docData = docSnapshot.data();
        const modified = await migrateDocument(docSnapshot.ref, docData);

        if (modified) {
          batchUpdateCount++;
          updatedCount++;
        }

        processedCount++;
        lastDocId = docSnapshot.id;
      }

      // Commit batch if there are updates
      if (batchUpdateCount > 0) {
        console.log(`   Batch update count: ${batchUpdateCount}`);
      }

      // Check if we got fewer docs than the page size (last page)
      if (snapshot.docs.length < pageSize) {
        console.log(`\n✅ Migration complete!`);
        console.log(`   Total processed: ${processedCount}`);
        console.log(`   Total updated: ${updatedCount}\n`);
        return { processed: processedCount, updated: updatedCount };
      }
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    // Close the Firebase connection
    await admin.app().delete();
  }
}

/**
 * Export the migration function for use in Cloud Functions or standalone scripts
 */
export { addFnStringFieldToNodes };

/**
 * Run the migration if this script is executed directly
 */
async function main() {
  try {
    // Get collection name from command line args or use default
    const collectionName = process.argv[2] || 'VariableManager-rules';
    const pageSize = parseInt(process.argv[3], 10) || 100;

    await addFnStringFieldToNodes(collectionName, pageSize);
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

// Only run main if this is the entry point (not imported as a module)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
