# ADR-103: Eliminación de la sección de Amigos y del feed de Actividad

## Estado
Aceptado

## Fecha
2026-10-23

## Contexto

La web tenía un flujo social completo: pestaña **Amigos** (y su
subsección de perfil con detalle de solo lectura del registro de
cada persona), pestaña **Actividad** (feed de lo que eliminaban los
amigos, `js/activity-feed.js`) y el buscador del Perfil (buscaba
amigos). El registro personal es un uso individual y el interés era
recuperar el historial perdido desde otras apps (TV Time), no social.

Eliminarlos toca:

- `index.html`: item «Amigos», item «Actividad» del dropdown de
  perfil, subtabs `friends`/`activity`, sección `profile-section-friends`
  (con su detalle completo), sección `profile-section-activity`,
  toggle «Actividad de amigos» de Notificaciones y placeholder de la
  búsqueda («...o amigos»).
- `js/profile.js`: funciones `openFriendCard`, `loadFriendsList`,
  `openFriendByUid`, `openFriend`, `renderFriendTab`, `setFriendTab`,
  `setFriendFilter`, `loadActivityFeed` y su wiring.
- `js/ui.js`: `renderFriendsList`, `renderFriendTab` y
  `renderActivityFeed` (+ helpers de fechas de label del feed).
- `js/activity-feed.js` (módulo entero) e import de
  `item-details.js` en `ui.js` (solo servía a la ficha de solo
  lectura de amigo).
- `js/router.js`: rutas `amigos`/`actividad` y deep-links
  `#/perfil/amigos/<uid>`.
- `js/app.js`: import/contexto `getAllUserProfiles` y `friendUid`.
- `js/global-search.js`: grupo «friends» (datos, render, highlight,
  avatares y caché de perfiles).
- `js/settings.js`: preferencia `friend_activity` y su toggle.

## Decisión

Se elimina **todo el flujo social**: la pestaña de amigos, el feed de
actividad y la búsqueda de amigos. El perfil queda con dos
secciones: **Estadísticas** y **Ajustes**.

- El router normaliza de forma tolerante rutas antiguas
  (`#/perfil/amigos`, `#/perfil/actividad` y amigos con uid) a la
  ruta por defecto (`#/perfil` con `invalid: true`), de modo que
  URLs antiguas ya no rompan.
- Las **funciones de datos de db.js** (`getAllUserProfiles`,
  `subscribeToNotifications` y el resto de perfil) se mantienen: son
  neutrales de la UI y `subscribeToNotifications` sigue alimentando
  la campana. La limpieza de las que queden muertas queda para
  refactor (estilo ADR-001).
- Las **clases CSS** de amigos/feed (`friend-*`, `activity-*`) se
  quedan de momento: no afectan a nada visible y quitarlas en masa
  arriesga romper estilos en uso (los grupos del buscador comparten
  gran parte del CSS). Limpieza diferida.
- La preferencia guardada `friend_activity` en localStorage
  antiguos queda como dato muerto tolerado (deep merge ignora claves
  sobrantes al no haber wiring).

## Consecuencias

- El Perfil gana foco: Estadísticas y Ajustes, sin repartos sociales.
- Menos peticiones: la apertura ya no lee perfiles ajenos; la
  búsqueda tampoco cachea perfiles ajenos.
- Ningún dato del usuario se borra: los documentos siguen intactos.
