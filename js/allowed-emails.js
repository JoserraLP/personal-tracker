// =============================================================
// Lista de correos autorizados (control de acceso de la web).
//
// Fichero de configuración externa del repositorio: define quién
// puede entrar a la app. Solo los correos de esta lista completan
// el acceso tras el login con Google (spec 001).
//
// IMPORTANTE: la protección de DATOS vive en el servidor, en la
// función isAllowedUser() de firestore.rules, que mantiene su
// propia copia de esta lista. Al añadir o quitar un correo:
//   1) Edítalo aquí (control de acceso web).
//   2) Edítalo también en firestore.rules y publica las reglas en
//      Firebase console → Firestore Database → Reglas.
// Ver specs/001-google-login-allowlist/spec.md.
// =============================================================

export const ALLOWED_EMAILS = [
  "admin@admin.es",
  "djoserralozanopinilla@gmail.com",
];

// Normaliza un correo para comparación: sin espacios y en
// minúsculas. Devuelve "" para null/undefined/valores no string.
export function normalizeEmail(email) {
  return String(email == null ? "" : email).trim().toLowerCase();
}

// ¿Está el correo en la lista de autorizados? Comparación exacta
// sobre el correo normalizado (trim + minúsculas). Email vacío o
// lista vacía → false.
export function isEmailAllowed(email, list = ALLOWED_EMAILS) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return (list || []).some((entry) => normalizeEmail(entry) === normalized);
}
