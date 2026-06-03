// set-admin.js
// Run this locally with: node set-admin.js <UID>
// Or hardcode the UID below and run: node set-admin.js

const admin = require('firebase-admin');

// Path to your service account key JSON (download from Firebase Console > Project Settings > Service Accounts)
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const uid = process.argv[2] || 'YOUR_UID_HERE';

async function setAdmin() {
  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    console.log(`✅ Admin claim set for user: ${uid}`);

    // Verify
    const user = await admin.auth().getUser(uid);
    console.log('Custom claims:', user.customClaims);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error setting admin claim:', err.message);
    process.exit(1);
  }
}

setAdmin();
