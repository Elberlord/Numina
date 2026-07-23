declare module 'firebase/app' {
  export const initializeApp: any;
}
declare module 'firebase/auth' {
  export const getAuth: any;
  export const setPersistence: any;
  export const browserLocalPersistence: any;
  export const signInWithEmailAndPassword: any;
  export const signInAnonymously: any;
  export const signOut: any;
  export const onAuthStateChanged: any;
  export const sendPasswordResetEmail: any;
}
declare module 'firebase/firestore' {
  export const initializeFirestore: any;
  export const persistentLocalCache: any;
  export const persistentMultipleTabManager: any;
  export const doc: any;
  export const getDoc: any;
  export const getDocFromServer: any;
  export const setDoc: any;
  export const updateDoc: any;
  export const collection: any;
  export const getDocs: any;
  export const query: any;
  export const orderBy: any;
  export const serverTimestamp: any;
  export const addDoc: any;
  export const onSnapshot: any;
  export const writeBatch: any;
  export const runTransaction: any;
  export const Timestamp: any;
}
