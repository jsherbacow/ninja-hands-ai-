import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Test Connection
async function testConnection() {
  try {
    // Attempt to fetch a non-existent doc from server to verify connectivity
    await getDocFromServer(doc(db, 'system', 'connection_test'));
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('offline')) {
      console.error("Firestore is offline. Please check your Firebase configuration or connectivity.");
    } else {
      console.warn("Firestore connectivity test returned an expected status or error:", error);
    }
  }
}
testConnection();

export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
};

export const signOut = async () => {
  await firebaseSignOut(auth);
};

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  score: number;
  level: number;
  timestamp: any;
}

export const submitScore = async (score: number, level: number) => {
  if (!auth.currentUser) return;
  
  try {
    const entry: LeaderboardEntry = {
      userId: auth.currentUser.uid,
      displayName: auth.currentUser.displayName || 'Anonymous Ninja',
      score,
      level,
      timestamp: serverTimestamp()
    };
    await addDoc(collection(db, 'leaderboard'), entry);
  } catch (error) {
    console.error("Error submitting score", error);
  }
};

export const getTopScores = async (count: number = 10) => {
  try {
    const q = query(
      collection(db, 'leaderboard'),
      orderBy('score', 'desc'),
      limit(count)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as LeaderboardEntry);
  } catch (error) {
    console.error("Error fetching top scores", error);
    return [];
  }
};
