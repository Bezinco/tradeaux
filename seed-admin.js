const admin = require('firebase-admin');

// 1. Go to Firebase Console → Project Settings → Service Accounts
// 2. Click "Generate new private key" and download the JSON
// 3. Put that file in the same folder and name it serviceAccount.json
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

// ========== PUT YOUR DETAILS HERE ==========
const ADMIN_EMAIL    = 'you@example.com';   // <-- your email
const ADMIN_PASSWORD = 'YourPassword123';   // <-- your password
const ADMIN_NAME     = 'Admin';             // <-- your name
// ==========================================

async function seed() {
  try {
    // Create the Firebase Auth user (or fetch existing)
    let user;
    try {
      user = await auth.getUserByEmail(ADMIN_EMAIL);
      console.log('User already exists:', user.uid);
    } catch (e) {
      user = await auth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: ADMIN_NAME
      });
      console.log('Created user:', user.uid);
    }

    // Set server-side admin claim (optional but recommended)
    await auth.setCustomUserClaims(user.uid, { admin: true });
    console.log('Set custom claim: admin=true');

    // Create profile
    await db.collection('profiles').doc(user.uid).set({
      full_name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      photoURL: '',
      provider: 'email',
      role: 'admin',
      country: '',
      phone: '',
      total_spent: 0,
      total_revenue: 0,
      total_trades: 0,
      win_rate: 0,
      rating: 0,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      adminAssignedAt: admin.firestore.FieldValue.serverTimestamp(),
      adminAssignedBy: 'seed_script'
    });

    // Create wallet
    await db.collection('wallets').doc(user.uid).set({
      userId: user.uid,
      balance: 0,
      held_amount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Lock the "first admin" config doc so the banner never appears again
    await db.collection('config').doc('admin').set({
      exists: true,
      adminUid: user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('\n✅ Done. Sign in at your hosting URL with the email/password above.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

seed();