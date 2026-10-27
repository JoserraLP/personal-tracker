// =============================================================
// Data access. Each type lives in its own collection, so it
// is easy to inspect them separately in the Firebase console:
//   users/{uid}/movies/{id}
//   users/{uid}/series/{id}
//   users/{uid}/books/{id}
//   users/{uid}/games/{id}
//   users/{uid}/notifications/{id}
//   users/{uid}/recipes/{id}         (issue #64)
//   users/{uid}/ingredients/{id}     (ingredient catalog, #64)
//   users/{uid}/menus/{id}           (weekly menus, #64)
//   users/{uid}/tags/{id}            (custom tags, #64)
//   users/{uid}/gym-workouts/{id}    (gym workouts, #62)
//   users/{uid}/gym-exercises/{id}   (exercise catalog, #62)
// Also, users/{uid} (the document itself, not a subcollection)
// stores a small profile with the email and the date of the last release
// alert check.
// The Firestore rules (rules_version '2') with the recursive wildcard
// cover both the profile document and the subcollections, so
// firestore.rules doesn't need to be touched.
// =============================================================

import {
  db,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "./firebase.js";

const COLLECTION_BY_TYPE = {
  movie: "movies",
  tv: "series",
  book: "books",
  game: "games",
};

function itemsRef(uid, type) {
  return collection(db, "users", uid, COLLECTION_BY_TYPE[type]);
}

export async function upsertUserProfile(uid, data) {
  return setDoc(doc(db, "users", uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Profiles of all registered users (for the friends list).
// Since everyone who can register is already "authorized", any
// user can read the profiles of others (see firestore.rules).
export async function getAllUserProfiles() {
  const snap = await getDocs(collection(db, "users"));
  const profiles = [];
  snap.forEach((docSnap) => profiles.push({ uid: docSnap.id, ...docSnap.data() }));
  return profiles;
}

// One-time read (no live subscription) of ANOTHER user's items,
// to view them read-only from the friends section.
export async function getItemsOnce(uid, type) {
  const snap = await getDocs(itemsRef(uid, type));
  const items = [];
  snap.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
  return items;
}

// Subscribes in real time to the items of a specific type.
// It sorts by addedAt (the date when YOU added it, which never
// changes) and not by updatedAt (which changes with any
// write, including the background daily pass that fills
// metadata) — so having an item's details completed does not make it
// jump to the top of "Recently added".
// Returns a function to cancel the subscription.
export function subscribeToItems(uid, type, onChange, onError) {
  const q = query(itemsRef(uid, type), orderBy("addedAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addItem(uid, type, item) {
  return addDoc(itemsRef(uid, type), {
    ...item,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateItem(uid, type, itemId, changes) {
  return updateDoc(doc(db, "users", uid, COLLECTION_BY_TYPE[type], itemId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteItem(uid, type, itemId) {
  return deleteDoc(doc(db, "users", uid, COLLECTION_BY_TYPE[type], itemId));
}

/* ---------- Notifications (releases) ---------- */

function notificationsRef(uid) {
  return collection(db, "users", uid, "notifications");
}

export function subscribeToNotifications(uid, onChange, onError) {
  const q = query(notificationsRef(uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addNotification(uid, notification) {
  return addDoc(notificationsRef(uid), {
    ...notification,
    read: false,
    createdAt: serverTimestamp(),
  });
}

export async function markNotificationRead(uid, notificationId) {
  return updateDoc(doc(db, "users", uid, "notifications", notificationId), { read: true });
}

export async function deleteNotification(uid, notificationId) {
  return deleteDoc(doc(db, "users", uid, "notifications", notificationId));
}

/* ---------- Recipes (issue #64) ---------- */

function recipesRef(uid) {
  return collection(db, "users", uid, "recipes");
}

export function subscribeToRecipes(uid, onChange, onError) {
  const q = query(recipesRef(uid), orderBy("addedAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addRecipe(uid, recipe) {
  return addDoc(recipesRef(uid), {
    ...recipe,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateRecipe(uid, recipeId, changes) {
  return updateDoc(doc(db, "users", uid, "recipes", recipeId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteRecipe(uid, recipeId) {
  return deleteDoc(doc(db, "users", uid, "recipes", recipeId));
}

/* ---------- Ingredients (catalog, issue #64) ---------- */

function ingredientsRef(uid) {
  return collection(db, "users", uid, "ingredients");
}

export function subscribeToIngredients(uid, onChange, onError) {
  const q = query(ingredientsRef(uid), orderBy("nombre", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addIngredient(uid, ingredient) {
  return addDoc(ingredientsRef(uid), {
    nombre: ingredient.nombre,
    categoriaId: ingredient.categoriaId || "",
    // Optional fields of the detail record (issue #224): stores where
    // the ingredient can be bought and package quantity (number +
    // unit). The photo (URL, issue #232) follows the recipes pattern.
    // They are only persisted if provided when creating.
    ...(ingredient.supermercados !== undefined && { supermercados: ingredient.supermercados }),
    ...(ingredient.paqueteCantidad !== undefined && { paqueteCantidad: ingredient.paqueteCantidad }),
    ...(ingredient.paqueteUnidad !== undefined && { paqueteUnidad: ingredient.paqueteUnidad }),
    ...(ingredient.fotoUrl !== undefined && { fotoUrl: ingredient.fotoUrl }),
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Partial update of a catalog ingredient (issue #224):
// only the fields passed in `fields`. For supermercados the
// complete new array is sent.
export async function updateIngredient(uid, ingredientId, fields) {
  return updateDoc(doc(db, "users", uid, "ingredients", ingredientId), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteIngredient(uid, ingredientId) {
  return deleteDoc(doc(db, "users", uid, "ingredients", ingredientId));
}

/* ---------- Custom tags (issue #64) ---------- */

function tagsRef(uid) {
  return collection(db, "users", uid, "tags");
}

export function subscribeToTags(uid, onChange, onError) {
  const q = query(tagsRef(uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addTag(uid, tag) {
  return addDoc(tagsRef(uid), {
    ...tag,
    addedAt: serverTimestamp(),
  });
}

export async function deleteTag(uid, tagId) {
  return deleteDoc(doc(db, "users", uid, "tags", tagId));
}

/* ---------- Weekly menus (issue #64) ---------- */

function menusRef(uid) {
  return collection(db, "users", uid, "menus");
}

export function subscribeToMenus(uid, onChange, onError) {
  const q = query(menusRef(uid), orderBy("semanaInicio", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

// Creates a menu document and returns the reference (with the new id).
export async function addMenu(uid, menu) {
  return addDoc(menusRef(uid), {
    ...menu,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Overwrites the menu fields (arrays/days are stored whole).
export async function updateMenu(uid, menuId, menu) {
  return updateDoc(doc(db, "users", uid, "menus", menuId), {
    ...menu,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteMenu(uid, menuId) {
  return deleteDoc(doc(db, "users", uid, "menus", menuId));
}

/* ---------- Gym workouts (issue #62) ---------- */

function gymWorkoutsRef(uid) {
  return collection(db, "users", uid, "gym-workouts");
}

// Subscribes in real time to the user's workouts. They are sorted by
// fechaISO (the workout date, "YYYY-MM-DD") descending.
export function subscribeToGymWorkouts(uid, onChange, onError) {
  const q = query(gymWorkoutsRef(uid), orderBy("fechaISO", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

// Creates a workout. The canonical weight is ALWAYS kg (the conversion to
// lbs is display-only, issue #62).
export async function addGymWorkout(uid, workout) {
  return addDoc(gymWorkoutsRef(uid), {
    fechaISO: workout.fechaISO,
    ...(workout.nombre !== undefined && { nombre: workout.nombre }),
    ...(workout.nota !== undefined && { nota: workout.nota }),
    ejercicios: workout.ejercicios || [],
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateGymWorkout(uid, workoutId, changes) {
  return updateDoc(doc(db, "users", uid, "gym-workouts", workoutId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteGymWorkout(uid, workoutId) {
  return deleteDoc(doc(db, "users", uid, "gym-workouts", workoutId));
}

/* ---------- Exercise catalog (issue #62) ---------- */

function gymExercisesRef(uid) {
  return collection(db, "users", uid, "gym-exercises");
}

// Subscribes in real time to the exercise catalog, sorted by
// name alphabetically (same pattern as the ingredient catalog).
export function subscribeToGymExercises(uid, onChange, onError) {
  const q = query(gymExercisesRef(uid), orderBy("nombre", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addGymExercise(uid, exercise) {
  return addDoc(gymExercisesRef(uid), {
    nombre: exercise.nombre,
    ...(exercise.grupoMuscular !== undefined && { grupoMuscular: exercise.grupoMuscular }),
    ...(exercise.notas !== undefined && { notas: exercise.notas }),
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateGymExercise(uid, exerciseId, changes) {
  return updateDoc(doc(db, "users", uid, "gym-exercises", exerciseId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteGymExercise(uid, exerciseId) {
  return deleteDoc(doc(db, "users", uid, "gym-exercises", exerciseId));
}

/* ---------- Wishlist (Shopping) ---------- */

// Personal list of things to buy: title, description, price
// (optional), product URL (optional), photo by URL (optional) and
// whether it is already bought. Private collection with pattern equal to the rest:
// live sub sorted by creation date desc.

function wishlistRef(uid) {
  return collection(db, "users", uid, "wishlist");
}

export function subscribeToWishlist(uid, onChange, onError) {
  const q = query(wishlistRef(uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addWishlistItem(uid, item) {
  return addDoc(wishlistRef(uid), {
    ...item,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateWishlistItem(uid, itemId, changes) {
  return updateDoc(doc(db, "users", uid, "wishlist", itemId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWishlistItem(uid, itemId) {
  return deleteDoc(doc(db, "users", uid, "wishlist", itemId));
}

/* ---------- Experiences (Ocio tab) ---------- */

// Experiences done or to do some day: private list (same pattern as
// the wishlist) with title, description, date (optional) and done
// mark. Live subscription listing without order criteria (the client
// keeps the order they come in: creation).
function experienceRef(uid) {
  return collection(db, "users", uid, "experiences");
}

export function subscribeToExperiences(uid, onChange, onError) {
  const q = query(experienceRef(uid), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = [];
      snapshot.forEach((docSnap) => items.push({ id: docSnap.id, ...docSnap.data() }));
      onChange(items);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function addExperience(uid, item) {
  return addDoc(experienceRef(uid), {
    ...item,
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateExperience(uid, itemId, changes) {
  return updateDoc(doc(db, "users", uid, "experiences", itemId), {
    ...changes,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteExperience(uid, itemId) {
  return deleteDoc(doc(db, "users", uid, "experiences", itemId));
}
