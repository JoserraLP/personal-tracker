# User manual — Mi Registro [My Tracker]

Welcome to **Mi Registro**, your private notebook to keep track of the
movies you watch, the series you follow, the books you read and the
video games you play.

This manual explains, step by step and without technical jargon,
everything you can do in the web app. Read it by sections as needed.

---

## Contents

1. [What is Mi Registro](#1-what-is-mi-registro)
2. [How to sign in](#2-how-to-sign-in)
3. [The main screen](#3-the-main-screen)
4. [Series](#4-series)
5. [Movies](#5-movies)
6. [Books](#6-books)
7. [Video games](#7-video-games)
8. [Recipes](#8-recipes)
9. [Gym](#9-gym)
10. [How to search](#10-how-to-search)
11. [Organizing and sorting your tracker](#11-organizing-and-sorting-your-tracker)
12. [The card of each movie, series, book or video game](#12-the-card-of-each-movie-series-book-or-video-game)
13. [Star ratings](#13-star-ratings)
14. [Quick actions](#14-quick-actions)
15. [Notifications](#15-notifications)
16. [Your profile](#16-your-profile)
17. [Settings](#17-settings)
18. [When is the data refreshed?](#18-when-is-the-data-refreshed)
19. [Privacy](#19-privacy)
20. [Install the web app on your phone](#20-install-the-web-app-on-your-phone)
21. [Common problems](#21-common-problems)

Also: [Purchases (wishlist)](#purchases-wishlist) ·
[Times watched / read / played (counters)](#times-watched--read--played)

---

## 1. What is Mi Registro

Mi Registro is a web app for noting down:

- **Series** you are watching, have watched or want to watch, episode by
  episode.
- **Movies** watched or pending, with a rewatch history.
- **Books** read, in progress or pending.
- **Video games** played, in progress or pending, with a session history.
- **Gym workouts**, with their exercises and the weights and
  repetitions of each set.

The web app fills in each title's data on its own: cover, synopsis,
cast, release dates, community ratings, etc. You only take care of
marking what you watch, read and play.

## 2. How to sign in

1. Open the web address in your browser (computer, tablet or mobile).
2. Press the **«Entrar con Google»** [Sign in with Google] button.
3. Choose the Google account you want to sign in with.

**Important:** only the emails on the guest list can sign in. If your
email is not on the list, the web app will tell you
(*«Tu correo no está en la lista de invitados. Pide que te añadan.»*
[Your email is not on the guest list. Ask to be added.]) and you will
not be able to enter. Ask whoever administers the web app to add you
(they only need to update the list in the Firebase security rules).

The first time you sign in, your account is created automatically, with
your name and your Google photo. To sign out, tap your photo (top
right) and choose **«Cerrar sesión»** [Sign out] in the menu that
unfolds.

## 3. The main screen

Right after signing in you will see:

- **At the top, the header** (visible in the **Ocio** [Leisure],
  **Recetas** [Recipes] and **Gimnasio** [Gym] sections; in **your
  profile it does not appear**: there you have the back arrow and the
  tabs in the same row, see
  [section 16](#16-your-profile); on the sign-in screen neither):
  - ☰ **Hamburger**: opens the navigation sidebar (a sliding
    panel on the left). It has the **«Ocio»** entry, which takes you
    back to the Series, Movies, Books and Video games tabs,
    **«Recetas»**, **«Gimnasio»** and, at the bottom,
    **«Ajustes»**, which opens your profile's settings section
    (more in [section 17](#17-settings)).
    It closes by tapping outside, the ✕, the **Esc** key or the entry
    itself. If in [Ajustes → Secciones y pestañas](#17-settings)
    [Settings → Sections and tabs] you leave only **one section
    visible**, the sidebar is replaced by a **gear ⚙** button in the
    header that opens Settings directly; as soon as you have more than
    one section visible again, the sidebar reappears.
  - **Search bar** (in the middle): searches **within the section you
    are in** (more in [section 10](#10-how-to-search)). On sign-in,
    the bar briefly shows the name of the web app —**«Mi Registro»**—
    and after a few seconds it switches to the section's text: «Buscar
    películas, series, libros y videojuegos...» [Search movies, series,
    books and video games...] in Leisure, «Buscar
    recetas...» [Search recipes...] in Recipes and «Buscar en tu
    gimnasio...» [Search your gym...] in Gym.
  - On the right:
    - **Bell icon**: your notifications (more in
      [section 15](#15-notifications)).
    - **Your photo**: tapping it opens a menu with the two sections of
      your profile (**Estadísticas** [Statistics],
      **Ajustes**) and the **«Cerrar sesión»** [Sign out]
      option. From here you enter and leave the profile:
      in the Recipes and Gym sections there is no «back»
      button — navigation is always in the header.
  - The header **hides when scrolling down the Leisure, Recipes or Gym
    lists and comes back when scrolling up**: it is always there when
    you need it
    ([section 3.2](#32-the-header-and-tabs-when-scrolling)).
- **The tabs** (in the fixed bar under the header on the computer
  and tablet, or anchored at the bottom on mobile): **Series**,
  **Películas** [Movies], **Libros** [Books], **Videojuegos**
  [Video games] and **Compras** [Purchases]. Each tab carries an icon and has its
  own color: **Series in green**, **Películas in red**, **Libros in
  ochre**, **Videojuegos in violet** and **Compras in ochre**. The active tab is marked with
  a stripe of its color and a light background. Tap a tab to see
  your list of that type, with its filters and its sort order. Like the
  header, the tab bar hides when scrolling down the list and
  reappears when scrolling up
  ([section 3.2](#32-the-header-and-tabs-when-scrolling)).
- **The Recipes section has its own tab bar, just like Leisure**:
  **Recetas in ochre**, **Ingredientes in violet**, **Menú in
  green** and **Compra in red**, each with its icon. It is
  fixed in the same way (at the bottom on mobile, under the search bar
  on computer and tablet), hides when scrolling down the list like the
  Leisure one and its tabs can be hidden from
  [Ajustes → Secciones y pestañas](#17-settings) just like Leisure's
  (more in [section 8](#8-recipes)).
- **The Gym section has its own tab bar
  (Resumen [Summary], Entrenos [Workouts], Ejercicios [Exercises]), just
  like Leisure and Recipes**:
  **Resumen in violet**, **Entrenos in teal** and **Ejercicios in
  ochre**, each with its icon. It is fixed in
  the same way (at the bottom on mobile, under the search bar on
  computer and tablet), hides when scrolling down the list like the
  others and its tabs can be hidden from
  [Ajustes → Secciones y pestañas](#17-settings) just like Leisure's
  (more in [section 9](#9-gym)).

The active tab always tells you which collection you are in, which is
why each collection does not repeat a title like «Mis series» [My
series]: right after signing in you see its toolbar directly.

**Each tab loads its data the first time you open it.** When you sign
in, the web app only requests the information of the tab you are in.
When you open a tab you had not visited, you will see a brief
**«Cargando…»** [Loading…] indicator (with an animation) while its
data arrives; from then on, every time you return to that tab
everything appears instantly. That way the web app does not have to
request all four trackers at once every time you sign in. If the data
does not arrive within a few seconds, the app has already tried
several times and shows a notice with the **«Reintentar»** [Retry]
button so you can try again without reloading the page
(more in [section 21](#21-common-problems)).

When you sign in for the first time you land on **Series**, with the
**«Viendo»** [Watching] filter active and in list view — the most
common use.

Each tab is divided into two zones:

- **At the top**: your library, with its toolbar to filter
  by status, sort and switch the view between grid and list
  (more in [section 11](#11-organizing-and-sorting-your-tracker)).
- **Below**: the list of your titles of that type.

Searching for new titles to add is no longer done inside the tab:
everything is searched from the **header's search bar**
(more in [section 10](#10-how-to-search)).

### 3.1 Sharing addresses and returning to the tabs

Each tab has its own web address, ending in
`#/ocio/series` (Series), `#/ocio/peliculas` (Películas),
`#/ocio/libros` (Libros) or `#/ocio/videojuegos` (Videojuegos). You can
copy that address from the
browser's address bar and share it, save it in
favorites or send it to yourself: when you open it again, the web app
opens directly on that tab, even if you signed in from another
device.

The browser's **back** and **forward** buttons also switch tabs, as if
they were part of the same page: if you are in
Películas, tap Series and then «back», you return to Películas.

If you enter without a specific address, or with one that does not
correspond to any tab, the web app always takes you to **Series**, just
as until now.

Your profile also has its own addresses (`#/perfil/...`): see
[section 16.0](#160-sharing-your-profiles-addresses).

### 3.2 The header and tabs when scrolling

When scrolling down a **Leisure** list (series, movies, books or
video games), a **Recipes** list (Recetas, Ingredientes, Menú or
Compra) or a **Gym** list (Resumen, Entrenos or Ejercicios),
the search bar at the top and the tabs hide
sliding toward the edge of the screen, as if they were leaving it,
so the list takes up all the space. As soon as you scroll
up, they reappear sliding from their edge.

In **your profile** there is no global header: it has its own header
with the back arrow and the tabs in the same row. The profile's
back arrow takes you back to the section you came from,
**Ocio**, **Recetas** or **Gimnasio**, with the tab you
had active.

If you keep scrolling and the list controls (the status filters,
sort and view controls in Leisure, the toolbar of the active
Recipes tab or the «+ Nuevo entreno» [New workout] / «+ Nuevo
ejercicio» [New exercise] buttons in Gym) also go off-screen, you will
see a small rounded **«Volver arriba»** [Back to top] button floating
in the center, at the top, over the list: tap it to jump back to the
top of the list.

Navigation never hides while you are using it: if you are
typing a search, or you have a menu open (notifications,
profile, sidebar) or a card, the header and tabs
stay in place.

## 4. Series

### 4.1 The statuses of a series

Each series on your list has one of these statuses (shown in a colored
stamp on the cover):

| Status | Meaning |
|---|---|
| **Pendiente** [Pending] | You added it but have not watched any episode yet. |
| **Viendo** [Watching] | You have watched at least one episode. |
| **Vista** [Watched] | You have marked all the episodes. |
| **Standby** | You paused it, or the web app paused it automatically due to inactivity; your progress is kept. |
| **Abandonada** [Abandoned] | You abandoned it; your progress is also kept. |

A series **«aún no estrenada»** [not yet released] shows a notice with
its release date (and that of the next episode if it is airing).

If a series you are watching goes more than a year without you watching
any episode or any new one being released, the web app moves it to
Standby on its own (in the daily check). You can resume it whenever you
want from its card; nothing is lost.

### 4.2 Adding a series

1. In the **header's search bar**, type the title
   (minimum 2 characters).
2. Tap the **«Serie»** [Series] button that appears at the top of the
   results to search the catalog.
3. In the results, tap **«Añadir»** [Add] on the series you want.
4. If you want to see more information first, tap the result row: a
   preview with the details will open.

Can't find the series? At the end of the catalog results
**«Añadir manualmente»** [Add manually] appears (more in
[section 10.3](#103-add-manually)).

### 4.3 Watching and marking episodes

Tap a series on your list to open its card. You will see the
**seasons**; tap one to unfold its **episodes**.

For each episode you can:

- **Mark it as watched** with the checkbox. If the episode has not
  aired yet, the web app will ask first whether you want to mark it
  anyway. If you mark it by mistake, the rating window offers
  **«Deshacer»** [Undo] and the episode goes back to unmarked.
- **Re-watch an episode**: if the episode is already marked as watched
  and you tap its checkbox, the web app will ask whether **you watched
  it again** or whether you want to **unmark it**. If you choose «Lo he
  visto de nuevo» [I watched it again], the last-watched date becomes
  today and the episode counter goes up by one.
  When an episode has been watched more than once, its checkbox shows
  the **number of times** instead of the ✓ mark.
- **Change the date** you watched it (by default today's date is set).
- **Rate it** with stars, once watched (more in
  [section 13](#13-star-ratings)).
- See the **community score** (TMDB) of that episode, if it has one.

There are also two buttons per season: **«Marcar todo»** [Mark all] and
**«Desmarcar todo»** [Unmark all]. If there are episodes that have not
aired yet, the web app will ask for confirmation before marking them
all.

A series is considered **«Vista»** when you mark the last episode
missing. On your list you will always see what to watch now (for
example, «Siguiente: T2E5» [Next: S2E5]).

### 4.4 Pausing, abandoning and resuming

Inside the series card you have three buttons depending on the moment:

- **«En pausa»** [On pause]: you stop following it without losing what
  you watched.
- **«Abandonar»** [Abandon]: you drop the series (the web app asks
  first; no progress is lost).
- **«Retomar»** [Resume]: you return to a series you had on pause or
  abandoned.

### 4.5 Watching a series again from the beginning

If a series is complete, the card offers **«Volver a verla desde el
principio»** [Watch again from the beginning]. The web app saves the
previous watch in your history and resets the series so you start
again. You will see the notice «Has terminado esta serie (visionado nº
X)» [You have finished this series (watch no. X)] when you complete it
again.

### 4.6 Watch history

On a finished series' card you can unfold **«Visionados
anteriores»** [Previous watches] and see the start and end dates of
each time you watched it.

### 4.7 Editing and deleting

On the card: **«✎ Editar información»** [Edit information] lets you
correct data (title, year, cover...), and **«Eliminar»** [Delete]
removes the series. Deletion is not immediate: you have a few seconds
to press **«Deshacer»** if you change your mind (more in
[section 14.3](#143-undo-a-deletion)).

## 5. Movies

### 5.1 The statuses of a movie

There are only two:

| Status | Meaning |
|---|---|
| **Pendiente** | Added, not watched yet. |
| **Vista** | At least one watch registered. |

A movie **«aún no estrenada»** [not yet released] shows a notice with
its date; if you try to mark it as watched early, the web app will ask
whether you want to do it anyway.

### 5.2 Adding a movie

Same as with series: type the title in the **header's search
bar**, tap the **«Película»** [Movie] button and then **«Añadir»** on
the result you want, or use the preview by tapping the row.
If you cannot find it, at the end of the results **«Añadir
manualmente»** appears (more in [section 10.3](#103-add-manually)).

### 5.3 Marking as watched

On your list, each movie has a **«Vista»** button. Tapping it
registers the watch with today's date and opens the
**rating** window so you can score it 1 to 5 stars (with halves,
by tapping the same number twice; you can tap
**«Ahora no»** [Not now]). If you regret the marking, tap
**«Deshacer»** in that window: the watch is canceled and not added to
the history.

If you had already watched it and mark it again, the button becomes
**«Añadir otro visionado»** [Add another watch] — the web app stores
both in the history.

### 5.4 Watch history (rewatches)

On the movie's card you see the list of all the times you watched it,
with their dates. You can **edit the date** of each watch or
**«Quitar»** [Remove] one from the history. On your list, if you
watched it more than once, it shows «Vista el FECHA · ×2» [Watched on
DATE · ×2] (or the corresponding number).

## 6. Books

### 6.1 The statuses of a book

| Status | Meaning |
|---|---|
| **Pendiente** | Added, not started yet. |
| **Leyendo** [Reading] | You started reading and have not finished. |
| **Leído** [Read] | Reading completed. |
| **Standby** | You paused it; your current page is kept. |
| **Abandonado** [Abandoned] | You left it; your current page is kept. |

### 6.2 Adding a book

Type the **title or the author** in the header's search bar
and tap the **«Libro»** [Book] button to search the catalog.
Books are always searched **in Spanish** (editions that the sources
confirm in another language are discarded).

If the book has several editions, the web app lets you **choose cover
and synopsis** before adding it. If you already have it in your
tracker, the button shows as «Añadido» [Added]. If you cannot find it,
at the end of the results **«Añadir manualmente»** appears
(more in [section 10.3](#103-add-manually)).

### 6.3 Starting and finishing readings

On your list, each book has a big button: **«Empezar ✓»** [Start ✓] or,
if it is already in progress, **«Terminar ✓»** [Finish ✓] (and
**«Releer ↺»** [Re-read ↺] when it is read).

On the book's card:

- **«Empezar a leer»** [Start reading]: registers the start with
  today's date.
- **«Terminar de leer»** [Finish reading]: closes the reading with
  today's date and opens the rating window. If you tap
  **«Deshacer»** in that window, the book goes back to how it was: if
  you were reading it, it goes back to
  «Leyendo», and the finished reading is not registered.
- **«Página actual»** [Current page]: note which page you are on. It is
  saved on the book's card.
- **En pausa / Abandonar / Retomar**: as with series, without losing
  your progress.

### 6.4 Reading history

On the card you see all your readings of the book: start date → end
date (or «leyendo» [reading] if in progress). You can **edit the
dates** and **«Quitar»** a reading from the history. Re-reads appear as
additional readings.

## 7. Video games

### 7.1 The statuses of a video game

| Status | Meaning |
|---|---|
| **Pendiente** | Added, not started yet. |
| **Jugando** [Playing] | You started a playthrough and have not finished it. |
| **Jugado** [Played] | Playthrough finished. |
| **Standby** | You paused it; your session history is kept. |
| **Abandonado** | You left it; your session history is kept. |

### 7.2 Adding a video game

Type the title in the **header's search bar** and tap the
**«Videojuego»** [Video game] button to search the **IGDB** catalog
(the same catalog as the igdb.com video game website, queried through
an own proxy). The results bring cover, year, synopsis, platforms,
community rating and more data.

- Tap **«Añadir»** to add it (the button switches to «Añadido»).
- Tap **«Marcar jugado»** [Mark played] to add it **already marked as
  played** (the session is registered with today's date) and **rate it
  right away**: the stars window opens to score it. If you tap
  **«Deshacer»** in that window, the video game is removed from your
  tracker.
- Tap the row (not the button) to see the **preview** with its details
  before adding it.
- If you already have it in your tracker, the button appears as
  **«Añadido»** and cannot be tapped.
- If you cannot find it, at the end of the results **«Añadir
  manualmente»** appears (more in [section 10.3](#103-add-manually)).

### 7.3 Starting and finishing playthroughs

On your list, each video game has a big button: **«Empezar ✓»** or, if
it is already in progress, **«Terminar ✓»** (and **«Rejugar ↺»**
[Replay ↺] when it is played).

On the video game's card:

- **«Empezar partida»** [Start playthrough]: registers the start with
  today's date.
- **«Terminar partida»** [Finish playthrough]: closes the session with
  today's date and opens the rating window. If you tap
  **«Deshacer»** in that window, the video game goes back to how it
  was.
- **En pausa / Abandonar / Retomar**: as with series and books,
  without losing your session history.

### 7.5 Played hours

On each video game's card the **total of played hours** is shown below
the title (e.g. «34,7 h jugadas» [34.7 h played]). It is the sum of
your sessions; if you link your Steam account and there are no
registered sessions yet, the total reported by Steam is used. In the
history you can enter each session's hours by hand and the total
updates on save.

### 7.4 Session history

On the card you see all your play sessions: start date → end
date (or «jugando» [playing] if in progress). You can **edit the
dates** and **«Quitar»** a session from the history. Replays appear as
additional sessions. Each session also has an optional **hours** field
(how many hours you spent on that playthrough, in half-hour steps);
that field is used for the **played hours** statistic of your
profile (section 15.1).

## Purchases (wishlist)

In the Leisure tab bar you have the **«Compras»** tab: your
list of things to buy, to note down whatever you want (a
monitor, a book, anything).

### Adding a thing

Tap **«Añadir cosa»** [Add thing] and fill in what you want:

- **Título** [Title] (required): the only essential field.
- **Precio** [Price] (optional): a number; it does not matter if you
  use a comma or a period («12,99» or «12.99»). It will be shown in
  euros on the card.
- **URL del producto** [Product URL] (optional): it will open in your
  browser… the web app also accepts domains without «https://» (type
  «www.dominio.com/x» and the web app completes the address).
- **Foto** [Photo] (optional): a **link** to an image (for example, the
  product cover in the store). If you do not add one, the card
  shows a «Sin foto» [No photo] placeholder.
- **Descripción** [Description] (optional): notes or details of the
  product.

Save and the card appears on the list.

### Marking as purchased

Each card has a **«Comprado»** [Purchased] switch: mark it when you
buy it and the title gets struck through (the card is dimmed) and the
date you bought it is saved. If you made a mistake, unmark it and it
goes back to «to buy».

Tap a card to **edit** all its fields or **🗑️** to
delete it (you will be asked for confirmation). With the little chips
at the top you can filter: **Todas** [All], **Por comprar** [To buy] or
**Compradas** [Purchased].

### Things worth knowing

- The list is **private**: it is only for you; nobody else sees it (unlike
  your leisure tracker).
- You can **hide it** in Ajustes → Secciones y pestañas, and show it
  again whenever you want; your data is not deleted.
- A purchased thing stays on the list: delete it when you no
  longer want to keep it.


## Experiences (things done or that you want to do)

The **Experiencias** tab (in Ocio, next to **Compras**) is a private
list for experiences you have already lived or you want to do some
day: a trip, a concert, a dish you want to try...

### Add an experience

With the **«Añadir experiencia»** button:

- **Título** (required).
- **Fecha** (optional): the moment you lived it — or the one you have
  planned.
- **¿Hecha?**: check it if you already did it. From the form it saves
  as done directly; from the list card, the check marks it.
- **Descripción** (optional): whatever you want to remember.

### The list

- The filters show **Todas**, **Por hacer** (not done yet) or
  **Hechas**.
- Tapping a card opens the editing window: change title, date,
  **¿Hecha?** check and description.
- The check **Por hacer / Hecha** on the card updates it right away;
  when done for the first time, the date it was checked is kept.
- Deleting with the trash icon asks for confirmation.

Your list is private: only your account sees it.

## 8. Recipes

The **Recetas** section (in the sidebar, next to «Ocio») lets you
save your recipes, plan the weekly menu and generate the shopping
list automatically. It has four tabs — **Recetas**,
**Ingredientes**, **Menú** and **Compra** — in a fixed bar
**just like the Leisure ones**: at the bottom on mobile and under the
search bar on the computer and tablet, each with its icon and its color
(**ocre**, **violeta**, **verde** and **rojo**). The active tab is
marked with a stripe of its color. You can hide them from [Ajustes →
Secciones y pestañas](#17-settings), just like Leisure's.

### 8.1 Your recipes

In the «Recetas» tab you see your recipes as cards. With **«+ Nueva
receta»** [New recipe] you create one with:

- **Nombre** [Name] (required) and description.
- **Porciones** [Servings]: how many servings it yields (used to
  calculate the shopping list).
- **Foto** [Photo]: an image address (URL).
- **Enlaces de referencia** [Reference links]: the website you got the
  recipe from, one per line.
- **Ingredientes** [Ingredients]: chosen from your **ingredient
  catalog** with a **searchable dropdown**: type to filter and choose
  an option from the list (you cannot type a free name). If the
  ingredient is not in the catalog, tap **«Nuevo ingrediente»**
  [New ingredient]: the same creation window of the Ingredientes tab
  opens (name and category, and if you want supermarkets and package
  quantity) and the ingredient is already chosen in the recipe. For each
  ingredient you set the **cantidad** [quantity] and choose its **unit
  of measure** in a dropdown with the options **g, Kg, mL, L y
  Unidades** [g, Kg, mL, L and Units] (you may leave it unchosen); the
  **category is not chosen here**: it comes from the ingredient's record
  in the catalog and you can change it in the Ingredientes tab
  (see 8.5). You can add as many rows as you want.
- **Instrucciones** [Instructions]: the steps, in order.
- **Allergen tags** (Sin gluten [Gluten-free], Vegetariano
  [Vegetarian], Vegano [Vegan], Sin lactosa [Lactose-free], Sin frutos
  secos [Nut-free], Sin huevo [Egg-free]) and **meal type** (Entrante
  [Starter], Plato de cuchara [Spoon dish], Plato principal [Main
  course], Masas y panes [Doughs and breads], Postres y dulces
  [Desserts and sweets], Salsas y guarniciones [Sauces and sides],
  Desayunos [Breakfasts], Bebidas [Drinks]). Mark the ones that apply.

In the category and tag dropdowns you can **create your own tags**:
type the name in the «Nueva etiqueta propia…» [New own tag…] field and
tap «Añadir». Your own tags are saved to your account and appear
marked as «(propia)» [(own)].

The **header's search bar** searches **within your recipes**
(more in [section 10.2](#102-search-your-tracker)): it finds recipes
**by name, by ingredient** (for example «huevo» [egg] shows all the
recipes that use it) and **by tag** (for example «vegetariano»).
Tap a result to open the recipe in read mode.

Above the list there are two **filter dropdowns**: one for
**allergens** and one for **meal type**. Tap them to mark or
unmark options (you can select **several at once** or «Todos» [All]);
the cards are filtered instantly. A recipe is shown if it carries
**at least one** of the tags marked in each filter, and recipes
without tags of that type are always shown.

Recipe cards show their **tags as colored pills**: the
**allergen ones in green** and the **meal type ones in
ochre**, the same as inside the information window, to
tell them apart at a glance.

To open a recipe **tap its card, anywhere on it**: its information
window opens in **read mode** (nothing can be modified). This window is a
**text view**: you do not see
a form with checkboxes, but **the recipe's photo** (if it has one) and,
just below, **the name as a heading** with the **allergen and meal
type tags** in **colored pills** (the
**allergen ones in green** and the **meal type ones in ochre**, to
tell them apart at a glance). Then the **description** and
the **servings** are shown.

Below that, the **ingredients appear as a list** (each with
its name and quantity, for example «Harina — 200 g» [Flour — 200 g]) and the
**instructions numbered step by step**. At the end, if the recipe has
them, the **reference links** are shown (the website you got it from),
which open in another tab when tapped (if a link does not start with
`http://` or `https://` it is shown as text, not clickable).

Inside the window there are two buttons: **«✎ Editar»** [Edit] and
**«Eliminar»**. With **«Eliminar»** you delete it (it is removed from
the menu and the shopping list); with **«Editar»** (the button with the
pencil ✎) you switch to edit mode with the same registration form.

The window closes with the **✕** at the top. In read mode it
also closes by **tapping outside** it; in **edit** mode it does not, so
you do not lose what you are typing if you tap outside by mistake
(close it with «Cancelar» [Cancel] or the ✕).

### 8.2 Importing a recipe from a website

In the new recipe form there is a **«Importar desde una
URL»** [Import from a URL] checkbox: paste the recipe's link and tap
«Importar». If the website allows it, the name, photo and description
fill in on their own. Many websites block this reading from another
page: in that case only the URL is saved.

In any case, an imported recipe is **marked with the «Revisar»**
[Review] badge (orange border and tag), so you open it,
complete the missing data and unmark it once reviewed when it is
ready.

### 8.3 The weekly menu

In the **«Menú»** tab you plan the week. With the arrows you choose
the week; with **«Comensales»** [Diners] you say how many people are
eating. With **«Borrar semana»** [Clear week] you empty the whole menu
of the week you are looking at (you will be asked for confirmation).

On each day (Monday to Sunday) and meal (**Almuerzo** [Lunch] and
**Cena** [Dinner]) you can add recipes with the **«+ Añadir receta»**
[Add recipe] button of the top bar. A window opens where you first
choose the **destination**: the **day** of the week or **«Toda la
semana»** [Whole week], and the **meal**
(**Almuerzo** or **Cena**; the meal only applies when you choose a
specific day).
Then you will see **all your recipes** as cards: the **photo**
(if they have one) on the left, the **name** as heading and the
**allergen and dish type tags** below. You can **search**
by text and **filter** by the two tags with the search bar's buttons.
Tap a card to **view the recipe** with the same
window as the Recetas tab (close it and you return to the search
bar).

To **add it**, tap **«+ Añadir»** and, if you want, enter the
**diners of that recipe** (in case not everyone eats everything): if
you leave it empty, the recipe uses the **menu's global
diners**. The chosen number appears next to the recipe name in the
meal.

You can add **several recipes to the same meal**: each person
can eat a different option. Each recipe appears on its day as a
**miniature card** (photo, name and tags); tap it to
**view it** or remove it with the **✕**. There is no longer a button
per cell: everything is added with the same «+ Añadir receta».

In **«Recetas a la semana»** [Recipes for the week] the recipes you
choose with **«Toda la semana»** are stored: they are prepared once
for the whole week (for example, a **pizza dough**) and **are not
multiplied by the diners**. They appear as **cards identical to the
daily ones** (photo, name and tags): tap them to **view them** or
remove them with the **✕**.

To mark a recipe as «already made» (so it does **not** enter the
shopping list), exclude it from the shopping list (see 8.4).

### 8.4 The shopping list

The **«Compra»** tab calculates on its own what you need
to buy: each ingredient of each recipe is multiplied by
(diners ÷ recipe servings). For example, a recipe of 4
servings with 200 g of rice, for 2 diners, asks for 100 g. Recipes
«for the week» are noted with their fixed quantity.

- **Several weeks at once**: under the top bar there are chips
  with the weeks' dates. Mark the ones you want (at least one)
  and the list **adds up the ingredients** of all the selected
  weeks; with the ← and → arrows you see the previous or next
  weeks. As long as you do not touch the chips, the list follows the
  week you have open in the Menú.
- The lines are **grouped by category** (Frutas [Fruits], Carnes
  [Meats], Despensa [Pantry]…).
- Mark a line's checkbox to strike it through when you pick it up at
  the supermarket.
- **Quantity in packages**: if an ingredient has the **package
  quantity** set in its record (see 8.5), the list compares what you
  need with the package and rounds up: if you need
  550 g of flour and flour is sold in 1 Kg packages, the number **1**
  appears; if you need 2.5 Kg, **3**. Next to the number
  you can **adjust the packages** with the − and + buttons (flour left
  over from last week? remove a package; want some spare? add one) and
  the adjustment is saved on that device; the ↺ button returns to the
  automatic calculation. If the ingredient has no package quantity (or
  the units cannot be compared), what you need is shown.
- **Removing an item**: swipe a line **to the left** and
  keep swiping a bit more (on mobile) or tap the **red ✕ on the
  right** (on computer) to remove it from the list; you can undo it in
  the notice that appears immediately. Only the horizontal swipe
  gesture reveals the red background with its ✕ (visible only while
  you swipe); scrolling through the list with your finger up or down
  **does not mark** any line. Items of recipes stop being calculated
  in the marked weeks (at the bottom of the list «Quitados de la
  lista» [Removed from the list] appears and you can include them
  again by tapping their name).
- With **«+ Ítem extra»** [Extra item] you add things by hand: a field
  opens with the catalog's **ingredient search** (the same dropdown as
  when adding ingredients to a recipe): choose one, type the
  **quantity** and choose the **unit of measure** in a dropdown
  (**g, Kg, mL, L o Unidades**) and tap «Añadir». You do not have to
  choose a category or mark whether it is a cleaning product: that
  comes from the catalog ingredient's record (e.g. an ingredient with
  the category «Artículos del hogar» [Household items] is treated as a
  non-edible product). If the ingredient is not in the catalog, create
  it first with «+ Nuevo ingrediente» in the Ingredientes tab (see
  8.5). The item is added to all the selected weeks and is removed the
  same way as the rest (swiping or with the ✕).
- If you already made a menu recipe or do not need to buy its
  ingredients, **exclude it**: at the bottom of the list the excluded
  recipes appear and you can include them again by tapping their name.
  They are also indicated in the menu (struck through).

### 8.5 The ingredient catalog

The **«Ingredientes»** tab shows your account's ingredient catalog,
grouped **by category**. It fills itself with the ones you use in your
recipes, and you can also add ingredients by hand with the
**«+ Nuevo ingrediente»** button (top left): type the
name and choose the category. You can also fill in, if you want, the
**supermarkets** where it can be bought (Lidl, Aldi, Mercadona, Día,
Carrefour and El Corte Inglés, each with its color tag) and the
**package quantity** (number and unit: g, Kg, mL, L, unidades).

Ingredients are saved and shown **exactly as you type them**, with
their capital letters and accents. If you type one that already exists
(even with different capitalization or without accents), it is not
added again: the first time you typed it is kept.

Above the list you have one control:

- **Category filter**: a dropdown with a checkbox per category, all
  marked by default. Unmark the ones you do not want
  to see; the button's label says how many categories are being
  shown. The filter applies **instantly, without closing the
  dropdown**: as soon as you mark or unmark a checkbox it colors
  so you can see what is selected and the list updates itself.
  With the **«Todas»** checkbox you mark or unmark all at once. The
  ingredients **without category** are always shown.

Each ingredient is a card with its **name**. Tapping it opens a
window **in read mode** with the extended information: the
**category**, the **supermarkets** where it can be bought (the color
tags of Lidl, Aldi, Mercadona, Día, Carrefour and El Corte Inglés),
the **package quantity** (number and unit) and, if it has one, a
**photo**. If the ingredient has no photo no image is shown.
The window also states **which recipes use it** (tap a recipe's name
to open it in read mode) and has a
**«Añadir a la lista de la compra»** [Add to the shopping list]
button (with the 🛒 cart): a window opens to choose **only the
quantity and the unit of measure** (the unit is chosen in a dropdown
with **g, Kg, mL, L y Unidades**),
and the ingredient is noted in the shopping list of the selected
weeks (same as an extra item). It also has an
**«Eliminar»** button to remove it from the catalog (it does not
affect the recipes using it) and a **✏️ Editar** button to modify it:
with the pencil the same window opens in edit mode, where you can
change the **name**, the **photo** (pasting an image URL), the
**category**, the **supermarkets** and the **package quantity**; the
changes are saved all together with the **«Guardar»** [Save] button
(or discarded with «Cancelar»). The window has no «Cerrar» [Close]
button at the bottom: it closes with the ✕ at the top.

You can hide this tab from [Ajustes → Secciones y
pestañas](#17-settings) like the rest.

### 8.6 Data and synchronization

The recipes, the ingredient catalog, your own tags and the
menus are saved in your account and sync in real time between
your devices, like the rest of the web app. The menus of previous
weeks are kept.

## 9. Gym

The **Gimnasio** section (in the sidebar, next to «Ocio» and
«Recetas») lets you record your workouts, see a summary of what you
trained and keep your own exercise catalog, with the weights and
repetitions of each set.
It has three tabs — **Resumen**, **Entrenos** and **Ejercicios** — in
a fixed bar **just like the Leisure and Recipes ones**: at the bottom
on mobile and under the search bar on the computer and tablet, each
with its icon and its color (**Resumen in violet**, **Entrenos in
teal** and **Ejercicios in ochre**). The active tab is
marked with a stripe of its color. You can hide them from
[Ajustes → Secciones y pestañas](#17-settings), like the others.

Right below the tabs is the **«Unidad de peso»** [Weight unit]
selector (see 9.4), visible across the whole section.

### 9.1 Your summary

The **«Resumen»** tab is the first of the section and shows you a
**summary of what you trained in a period**. You choose the period
with the selector under the tabs, with three options:

- **«Semana en curso»** [Current week]: from Monday to today (the
  option chosen by default).
- **«Mes en curso»** [Current month]: from the 1st of the month to
  today.
- **«Rango»** [Range]: you choose the **from** and **to** dates,
  whatever you want. Only with this option the **range box** is
  shown, a single box with a **calendar**: tapping «Rango» opens it
  and you choose both dates right there. The **first day you tap** is
  the **from** and the **second** the **to**; the calendar **stays
  open** until you choose both dates (if you tap the to before the
  from, the web app **swaps them** for you).
  You can **change month** with the ‹ › arrows at the
  top, **clear** the chosen range with the «Borrar» [Clear] button to
  start over, and close it with «Listo» [Done], with the **Esc** key
  or by tapping outside. If you leave one end unchosen, it stays
  **unbounded** (e.g. without from, the period starts at the first
  workout). The box already shows at the top the range you have
  chosen.

The summary shows **two cards with the period's totals** — the
**number of workouts** and the **number of distinct exercises**
you trained — and, below, the breakdown **by muscle groups**: for
each group, how many distinct exercises and in how many workouts it
appeared. Finally, a list **per exercise** with the times you did it
(in how many workouts it appears) and its **weight difference** over
the period: how much it changed between the **oldest weight** and the
**newest** you registered, with a **sign** — **+** if it went up and
**−** if it went down (in the weight unit you have chosen; if you did
an exercise without registering weight, you will see «—»). Also, the
difference is **colored**: **green** if it went up, **red** if it went
down and with the table's normal color if it did not change (or if
there are no weights).
If an exercise **is no longer in your catalog**, the summary
**keeps its name** anyway.

The summary updates itself when adding, editing or deleting workouts.
If there are no workouts in the period, the web app tells you with a
notice.

### 9.2 Your workouts

In the «Entrenos» tab you see your workouts as **cards**, sorted
by date, from the most recent to the oldest. Each card shows the
**name** (if you gave it one), the **date** and a summary like
«3 ejercicios · 12 series» [3 exercises · 12 sets].

With **«+ Nuevo entreno»** you create one with:

- **Fecha** [Date] (required; by default, today).
- **Nombre** [Name] (optional): a name for the workout (e.g. «Push
  day»).
- **Nota** [Note] (optional): how the workout went, how it felt,
  progress…
- **Ejercicios** [Exercises]: one or more, each with its sets. For each
  exercise you choose one from your **catalog** (Ejercicios tab) in
  its dropdown; with **«+ Añadir ejercicio»** you add another to the
  workout. If the exercise you want is not in the catalog yet, tap
  **«Nuevo ejercicio»** and the same creation window as in the
  Ejercicios tab opens, without closing the workout. If you do not
  have exercises yet, the **«Ver catálogo de ejercicios»** [View
  exercise catalog] button takes you to create them. To each exercise
  you add **sets** with **«+ Añadir serie»** [Add set]: in each set
  you type the **weight** (in the unit you have chosen, see 9.4) and
  the **repetitions**. The sets table has **labels** («Peso» [Weight]
  and «Repeticiones» [Repetitions])
  above each column, so you always know what to type in each box.
  With **«Duplicar serie»** [Duplicate set] you copy the exercise's
  last set (weight and repetitions) so you do not type them again.
  You can remove a set or an exercise with its ✕.
- When you choose an exercise you **had already trained before**, the
  workout is prefilled with the **sets of the last time** (weights and
  repetitions of the most recent workout where you logged it): you
  only have to adjust them if something changed. If you had already
  started typing sets, yours are not overwritten.

Tap **«Guardar»** to save it. Workouts are saved in your
account and sync in real time between your devices.

Tap a workout's card to open it **in read mode**: you will see the
date, the name and the note (if it has them) and each exercise
with its sets table (weight × repetitions). Inside there are two
buttons: **«✎ Editar»**, which takes you back to the form with
everything you already had, and **«Eliminar»**, which deletes the
workout (the web app asks for confirmation first).

### 9.3 Your exercises

The **«Ejercicios»** tab shows your **exercise catalog** as
cards, sorted by name. With **«+ Nuevo ejercicio»** you add one with:

- **Nombre** (required).
- **Grupo muscular** [Muscle group] (optional): choose a preset (Pecho
  [Chest], Espalda [Back], Hombros [Shoulders], Bíceps [Biceps],
  Tríceps [Triceps], Antebrazos [Forearms], Piernas [Legs], Glúteos
  [Glutes], Core, Cardio, Cuerpo completo [Full body]) or
  **«Otro»** [Other] to type your own.
- **Notas** (optional): technique, notes, variants…

Tap an exercise to open it **in read mode** (muscle
group and notes) with **«✎ Editar»** and **«Eliminar»**. **Deleting an
exercise does not delete the workouts that use it**: those workouts
keep its name, even though the exercise is no longer in the catalog.

If you **had already trained the exercise before**, when opening it in
read mode you will also see the **«Última vez»** [Last time] section:
the date of the most recent workout where you logged it and its
**sets table** (weight × repetitions, in your weight unit). This way
you can see at a glance the loads you ended up with last session. If
it is a **new** exercise (you have never trained it), this section
does not appear.

### 9.4 Switching between kilos and pounds

Under the section's tabs there is a **«Unidad de peso»** selector with
**kg** and **lbs**. You can switch between kilos and pounds **at any
time**, and it affects **everything shown in the
section**: the sets of the cards and the details, and the weight
fields of the forms (what you type and the empty-field suggestions).

**You can also choose the unit from the workout creation or edit
window**: it has its own «Unidad de peso» selector (kg or lbs), which
is **synchronized** with the section's one — when you change one, the
other changes too, and the form's weights convert instantly.

**The stored values do not change**: the web app always saves the
weight in kilograms and only converts what it shows you (1 kg ≈ 2.2
lbs, with one decimal). You can switch between kilos and pounds as
many times as you want without losing anything recorded.

Your choice **is saved and synced between your devices**: if
you switch to pounds on mobile, the computer will remember that
preference too.

## 10. How to search

### 10.1 Searching the catalog

Everything is searched from the **header's search bar** (in Leisure,
Recipes and Gym; there is no search bar in your profile)
(it also opens with **Ctrl+K**, **Cmd+K** on Mac, or **/**).
In the **Ocio** section, when you type the title (minimum 2 characters)
you will see the results, and at the top of the panel there are four
buttons, always visible: **«Serie»**, **«Película»**, **«Libro»** and
**«Videojuego»** (they do not appear in Recipes: there the search only
looks inside the section; in Gym neither: there it finds nothing for
now, see 10.2). Tap the
corresponding one to **search the catalog**:

- Movies and series are searched on **TMDB** (the same catalog as The
  Movie Database).
- Books are searched on **Google Books** with **Open Library** as
  fallback (and the editions of the same book are grouped). They are
  always searched in Spanish.
- Video games are searched on **IGDB** (igdb.com) through an own proxy
  (see section 21).

The catalog results appear in a **«Catálogo ·
Series/Películas/Libros/Videojuegos»** [Catalog ·
Series/Movies/Books/Video games] section under your tracker results.
Only the catalog of the **last button tapped** is shown: if you tap
«Película» after «Serie», the series results hide and the movie ones
show (your collection always shows the same). For each result:

- Tap **«Añadir»** to add it directly (the button switches to
  «Añadido»).
- Tap the mark button to add it **already completed** and **rate it
  right away**: the button uses each type's term — **«Marcar visto»**
  [Mark watched] for movies and series, **«Marcar leído»** [Mark read]
  for books and **«Marcar jugado»** for video games. Movies become
  watched with today's date, series with **all the episodes of all
  their seasons**, books as read and video games as played; the stars
  window opens to score it (for series, a single rating for the series
  as a whole). If in that window you tap **«Deshacer»**, the title is
  removed from your tracker. If the movie is not released yet, or the
  series has unaired seasons, the web app asks you before continuing.
- Tap the row (not the button) to see the **preview** with its details
  before adding it.
- If you already have it in your tracker, the button appears as
  **«Añadido»** and cannot be tapped.
- At the end of each catalog section,
  **«¿No la encuentras? Añadir manualmente…»** [Can't find it? Add
  manually…] appears
  (more in [section 10.3](#103-add-manually)).

If there are no catalog results for that search, the web app tells you
and still offers to add the title manually.

If you clear what you typed, the chosen catalog gets unmarked and the
buttons go back to unpressed: to search the catalog you will have to
tap **«Serie»**, **«Película»**, **«Libro»** or
**«Videojuego»** again. On the other hand, if you keep typing with a
catalog already chosen, the search repeats automatically on that same
catalog: no need to tap the button again.

If a cover cannot load (broken image or blocked by the site hosting
it), it is automatically replaced by the «Sin imagen» [No image]
image; the result keeps working the same.

### 10.2 Searching your tracker

The **header's search bar** (or the **Ctrl+K**, **Cmd+K** on Mac, or
**/** keys) searches **only within the section you are in** (it is
available in **Ocio**, **Recetas** and **Gimnasio**; there is no
search bar in your profile):

- In **Ocio**: in what you already have noted — **movies, series,
  books** (also by author) and **video games**.
- In **Recetas**: in your **recipes** (by name, ingredient or
  tag). Tapping a result opens the recipe in read mode.
- In **Gimnasio**: **for now the search finds nothing**: the bar is
  available, but workouts and exercises are not searchable yet (it is
  planned for a future version).

Tapping the bar (or using the keyboard shortcut) opens a **dropdown
panel** under it with the results. The results are grouped with
icons: the same ones as the tabs, each in its color (series in
green, movies in red, books in ochre, video games in violet) and the
🍽️ icon for recipes. Tap a result to open its card (or the
recipe, depending on the section).

The panel closes with the **Esc** key, tapping outside the bar or with
the **✕** that appears inside the bar (which also clears what you
typed). You can also close it with the button in the
**header's left corner**:
while the search is open, the menu button **☰ turns into a
✕** (with a small animation); tap that ✕ to close the panel and the
button goes back to being ☰, ready to open the side menu as always.

### 10.3 Add manually

If a title does not appear in the catalog, use the
**«¿No la encuentras? Añadir manualmente»** link that appears at the
end of the search bar's catalog results. Fill in:

- **Series**: title, year, cover (optional) and **number of episodes**
  (a single season with that number is assumed).
- **Películas**: title, year and cover (optional).
- **Libros**: title, author, year, pages and cover (optional).
- **Videojuegos**: title, year and cover (optional).

Titles added manually have no automatic data (episode dates, synopsis...),
but they behave like the rest on your list.

## 11. Organizing and sorting your tracker

In each library's bar you have:

- **Status filter chips**: for example, in Series:
  Todos [All] / Pendiente / Viendo / Vista / Standby / Abandonada.
  In Películas: Todos / Pendiente / Vista. In Libros:
  Todos / Pendiente / Leyendo / Leído / Standby / Abandonado.
  In Videojuegos: Todos / Pendiente / Jugando / Jugado / Standby /
  Abandonado.
- **Sort selector**:
  - **Actividad reciente** [Recent activity] (the default one): what
    you watched, read, played or got released most recently, first.
  - **Fecha de visionado/lectura/juego** [Watch/read/play date]: by
    the last time you watched, read or played it.
  - **Alfabético** [Alphabetical]: by title, from A to Z.
  - **Año de estreno / publicación / lanzamiento** [Release /
    publication / launch year]: from newest to
    oldest (for books, the selector is called «Año de publicación»
    [Publication year], and for video games, «Año de lanzamiento»
    [Launch year]).
- **Grid ▦ or list ☰ view**: to your liking (each section remembers
  its own while you are in the web app).

About the layout of this bar: the **filter chips** are all
in a single line and, if they do not fit (on mobile), that filter line
**slides horizontally** without taking more space (the
scrollbar is not shown, but you can swipe with your finger). The
**sort selector** and the **view** one always go together: in the same
line as the filters on wide screens and on a second line on
mobile. The sort selector has the same size and font as
the filter chips.

Each status has its **color** on the card: Pendiente in red,
Viendo/Leyendo in green, Vista/Leído in ochre, Standby in gray and
Abandonado in red with the text struck through.

## 12. The card of each movie, series, book or video game

Tap any title on your list to open its card. Depending on the type,
you will see:

- **Cover, title and year** (in the search preview the type is stated:
  «Película · año» [Movie · year], «Serie · año» [Series · year] or
  «Videojuego · año» [Video game · year]).
- **Community score**: TMDB's for movies and series (out of
  10) and IGDB's for video games (out of 10), or «Sin
  puntuaciones» [No ratings].
- **Tráiler ▶**: the trailer opens on YouTube in a new tab (if it has
  one; for video games, only when IGDB has one).
- **Where to watch**: available streaming platforms (grouped in
  **Streaming / Alquiler [Rent] / Compra [Buy]**, with their logos)
  for your country, or the notice «Sin info. de streaming para este
  país» [No streaming info for this country]. If there are platforms,
  the «Ver opciones en TMDB» [See options on TMDB] link is also
  included.
- **Extended information**: runtime, genre, director (movies),
  creators (series), cast and synopsis. For video games:
  developers, publishers and age rating (ESRB).
- **Platforms** (video games): the playable platforms are shown
  as tags below the trailer.
- **Sagas** (movies): if the movie belongs to a saga, the notice
  **«Saga: ...»** appears with the **«Añadir resto de la saga»** [Add
  rest of the saga] button. Tap
  the button, mark the movies you want on the list and tap
  **«Añadir seleccionadas»** [Add selected]. Just below the notice,
  **«Otras películas de la saga»** [Other movies of the saga] are also
  shown as swipeable cards (cover,
  title and year), like the recommendations: each movie you do not
  have in your tracker yet has an **«Añadir»** button to add it
  directly; the ones already in your tracker appear as
  **«Añadida»** [Added] (disabled button).

  You can also **tap the card** of any of those
  movies to see its information (cover, runtime, genre, director,
  cast, synopsis, community score and trailer if it has one)
  before adding it: a window opens with the **«Añadir»** and
  **«Cerrar»** [Close] buttons, and when you add or close it (with
  «Cerrar», the ✕, tapping outside the window or the **Esc** key) you
  return to the movie card you were viewing. Movies you already have
  in your tracker show with **«Ya añadido»** [Already added]
  (disabled button).
- **Recommendations**: at the end, «Si te gustó esto, quizá te
  guste...» [If you liked this, maybe you'll like...] with similar
  titles you can add directly. You can also **tap the card** of a
  recommendation to see its extended information (like the saga cards:
  cover, runtime, genre, cast, synopsis, community score and
  trailer if it has one; for series, also its seasons) before
  adding it: a window opens with the **«Añadir»** and
  **«Cerrar»** buttons, and when you add or close it you return to the
  card you were viewing. Titles you already have in your tracker show
  with **«Ya añadido»** (disabled button).
- **Your rating** (1 to 5 stars, with halves) and **your notes** (for
  example, «Impresiones...» [Impressions...]). Tap **«Guardar»** to
  save the changes and **«Eliminar»** to delete the title.

On the card of **any episode** you also see the episode's community
score (format «TMDB 8.5»).

For series, next to your overall rating you will also see the
**average of your episode ratings** (see section 13).

For video games, the card also includes the **play session
history** (more in [section 7.4](#74-session-history)).

## Times watched / read / played

Each title has a **counter** of the times you consumed it:

- **Movie**: how many times you watched it (each «Vista» in the
  history adds 1; it appears as «×N»).
- **Series**: how many times you **completed** it (the «Completa ·
  ×N» [Complete · ×N] stamp adds too).
- **Book**: how many times you read it to the end.
- **Video game**: a play session is a "play" and adds 1.

### Viewing the counter

It appears as a **«×N»** chip on the title's card (grid and
list) and in the card's history you see the sessions that add
it up.

### Correcting the count by hand

If you watched/read/played something and did NOT note each session
(for example, you re-read a book twice in a row), open its card →
**Editar información** → box **«Veces vista / completada / leído /
jugada»** [Times watched / completed / read / played]:

- Enter the real number of times and save: that number will be shown
  (less than already recorded is not possible: you cannot cheat the
  count).
- If you leave the box empty, the count returns to the history's
  automatic one.

## 13. Star ratings

You can rate from **1 to 5 stars**, including **half stars**
(for example, 2.5):

- **Movies**: marking it as watched opens the rating window.
- **Books**: finishing the reading opens the same window.
- **Video games**: finishing a playthrough opens the same window.
- **Series**: on each watched episode, below the episode, 5
  stars appear to rate it (in addition to the series' overall rating,
  which is saved from its card).

On a **series** card, below the overall rating, the **average of your
episode ratings** is shown (for example
«Media episodios: 4.2» [Episode average: 4.2]). Only the episodes you
rated count: watched without rating are not taken into account (the
minimum rating of an episode is half a star, 0.5). If you have not
rated any episode yet, the average does not appear. It updates itself
as soon as you rate an episode, remove a rating or unmark episodes.

In the popup window you can tap **«Ahora no»** to rate later, or
choose stars and tap **«Guardar valoración»** [Save rating]. If you
tap save without choosing, the web app reminds you. If you tap the
same number again, the rating becomes a **half star** (for example:
you tap 3 and then 3 again → 2.5). A **third tap** on the same
number removes the rating entirely.

You can also tap **«Deshacer»**: it cancels the marking just made
(the movie's watch, the end of the reading or the marked
episode) and leaves you as you were. For episodes, undo is offered
only while the window is open.

On your list, each title shows your stars (★, with «½» for the
halves, e.g. ★★½) and the community score.

## 14. Quick actions

### 14.1 Each row's big button

In **list** view, each title has a big button with the most likely
action:

- **Movie**: «Vista ✓» [Watched ✓].
- **Series**: «Ver T2E5» [Watch S2E5] (the next episode) or «Completa
  ✓» [Complete ✓] if it is already finished.
- **Book**: «Empezar ✓», «Terminar ✓» or «Releer ↺».
- **Video game**: «Empezar ✓», «Terminar ✓» or «Rejugar ↺».

### 14.2 Swiping on mobile

On mobile (list view) you can **swipe your finger sideways** over a
row to trigger that same action. Swiping vertically keeps scrolling
normally.

The action is confirmed with a floating notice (for example, «marcada
como vista» [marked as watched]). If in the rating window you tap
**«Deshacer»**, that notice changes to «Marcado deshecho.» [Marking
undone.] (or «Desmarcado.» [Unmarked.] for an episode). On paused or
abandoned series it does not work: the web app tells you to open it
and resume it.

### 14.3 Undoing a deletion

When you tap **«Eliminar»** on any card, the web app does not delete
immediately: the notice ««Título» se eliminará…» [«Title» will be
deleted…] appears with an
**«Deshacer»** button. You have a few seconds to tap it and cancel. If
you do nothing, the title is really deleted. (If you reload the page
before the time passes, the deletion is canceled.)

## 15. Notifications

The header's **bell icon** warns you (only inside the web app, once a
day) about:

- **Movie releases**: ««Título» ya se ha estrenado (fecha).» [«Title»
  has been released (date).]
- **Series releases**: ««Título» ya se ha estrenado.» [«Title» has been
  released.]
- **Video game releases**: ««Título» ya está a la venta (fecha).»
  [«Title» is now on sale (date).]
- **New episodes**: «Nuevo episodio disponible de «Título»: T2E5.»
  [New episode available of «Title»: S2E5.]

The bell shows a **number with the unread ones**. When you open it,
the notifications are marked as read. You can **«Borrar todas»** [Clear
all] or close each one with its ✕. Tap outside the window (or the
**Esc** key) to close it.

You can choose which types of notices you want (or disable them all) in
**Ajustes → Notificaciones** ([section 17](#17-settings)).

If you also enable **«Notificaciones en el dispositivo»** [Device
notifications], those same notices also appear as a **system
notification** (on the phone screen or the desktop) when the web app is
open but you are not looking at it.

## 16. Your profile

Tap **your photo** (top right) to open the profile menu and
choose the section you want to go to: **Estadísticas or Ajustes**. Each
menu option carries its icon. From the same menu you can also
**sign out**.
The button shows only your photo, without your name, on any
device (mobile, tablet or computer).
In your profile **the global header does not appear** (sidebar,
search and profile button): at the top you have the **back arrow** and
your profile's tabs in the same row. The arrow returns you to the
**Ocio**, **Recetas** or **Gimnasio** section you entered the
profile from, with the tab you had active.
Your profile has two sections:

### 16.0 Sharing your profile's addresses

Like the tabs of [section 3.1](#31-sharing-addresses-and-returning-to-the-tabs),
each profile section has its own web address, ending in
`#/perfil/estadisticas` (Estadísticas) or `#/perfil/ajustes` (Ajustes).
You can copy it from the address bar, save it in favorites or
share it: when you open it, the web app takes you straight to that
profile section. The old `#/perfil/datos` address keeps working and opens
Ajustes.

Entering with a profile address while signed out opens the sign-in
screen first; after signing in, the web app takes you to the section
you asked for.

### 16.1 Statistics

Eight figures: **Películas vistas** [Movies watched],
**Episodios vistos** [Episodes watched], **Series completadas** [Series
completed], **Libros leídos** [Books read], **Juegos jugados** [Games
played], **Juegos completados** [Games completed], **Sesiones de
juego** [Play sessions] and **Horas jugadas** [Played hours]. The
period selector lets you view them for **Siempre** [Always],
**Este año** [This year], **Este mes** [This month] or a **custom
range** (choose the «Desde» [From] and «Hasta» [To] dates).

A video game counts as **played** if it has a session within the
period (each session counts once, by its end date or, if still
in progress, by its start date); the **played hours** are the sum of
the hours noted in the period's sessions, and the **play sessions**
count those same period's sessions.

Below there are five charts:

- **Actividad por mes** [Activity by month]: bars with what you
  watched/read/played each month.
- **Estados actuales** [Current statuses]: which part of your tracker
  is pending, in progress, completed, paused or abandoned (it includes
  video games too).
- **Géneros** [Genres]: the 6 most played genres in the period.
- **Plataformas** [Platforms]: the 6 most played platforms in the
  period.

### 16.2 Settings

Fully explained in [section 17](#17-settings).

## 17. Settings

It is reached from **«Ajustes» at the bottom of the sidebar**
(open the menu with the header's ☰) or from the
**menu of your photo → Ajustes**.

- **Apariencia → Tema** [Appearance → Theme]: choose between four
  display modes:
  - **Oscuro** [Dark]: the classic look, with dark brown
    background.
  - **Negro puro** [Pure black]: like dark but with the background and
    all surfaces (cards, settings sections, menus) fully
    black, with light text. Ideal for OLED screens: it uses less
    battery and colors look deeper.
  - **Claro** [Light]: the classic light look, with cream background
    and white cards.
  - **Blanco puro** [Pure white]: like light but with the background
    fully white, as opposed to pure black.
  Your choice is saved automatically and kept the next time
  you sign in.

- **Apariencia > Idioma** [Appearance > Language]: switch the interface
  language between **Español** and **English**. Your choice is saved
  automatically and kept the next time you sign in (the occasional
  notice messages may remain in Spanish while the translation is
  completed).
- **Secciones y pestañas** [Sections and tabs]: choose which sections
  and tabs of the web app you see. Today there are three sections:
  **«Ocio»**, with its five tabs (**Series**, **Películas**,
  **Libros**, **Videojuegos** and **Compras**),
  **«Recetas»**, with its four tabs (**Recetas**, **Ingredientes**,
  **Menú** and **Compra**), and **«Gimnasio»**, with its three tabs
  (**Resumen**, **Entrenos** and **Ejercicios**). **Hiding a tab**
  removes it from its section's tab bar (Leisure's,
  Recipes' or Gym's) and from the view: your data, notices and
  updates keep working the same, it just stops being seen. **Hiding a
  section** removes it from the navigation sidebar; if you
  only leave **one section visible**, the sidebar (☰) is replaced
  by a **gear ⚙** button in the header that opens Ajustes
  directly, and it comes back when you have more than one section
  visible. At least one section and one tab of each section always
  remain visible: the switch of the last remaining one is shown off
  (gray) and cannot be tapped, with an explanatory note.
  Hiding something **does not delete your data**: it only removes it
  from the view, and you can show it again whenever you want. The
  changes save themselves.
- **Notificaciones**: enable or disable each type of notice:
  - Estrenos de películas [Movie releases]
  - Nuevos episodios de series [New series episodes]
  - Estrenos de series [Series releases]
  - Estrenos de videojuegos [Video game releases]
  - **Notificaciones en el dispositivo**: if you enable it, the
    previous notices also arrive as **system notifications** (on the
    phone screen or the desktop) when the web app is open but you are
    not looking at it. When you enable it, the browser asks for
    permission the first time: if you deny it, the option turns off by
    itself (you can re-grant it later in the browser settings).
    Tapping the notification opens the web app. For it to work on
    mobile, the web app must be installed as an app
    ([section 20](#20-install-the-web-app-on-your-phone))
    and on iPhone **iOS 16.4 or higher** is required; on the computer
    it works with the tab open in the background.
- **Sincronización de datos → «Comprobar estrenos»** [Data
  synchronization → Check releases]: checks right then whether
  something got released or a new episode came out (what the web app
  checks by itself every day). You can only use it once every **30
  minutes** (the web app warns you if you try earlier). There is no
  need to use it: the web app checks by itself daily (see next
  section).
- **Integración de Steam** [Steam integration]: brings your Steam
  library with the **played hours**. One click: tap **«Vincular mi
  cuenta de Steam»** [Link my Steam account], sign in in the Steam
  window that opens and return to the web app: your account is
  **linked** (the hand-pasted SteamID64 disappears — it is kept as a
  fallback) and the web app **updates the hours every day on sign-in**
  (also with «Comprobar estrenos»). From the games view you can search
  and add each game with its hours and the day of the last session,
  with «Añadir».
  Conditions: your Steam profile must have the game details public;
  the already-added game appears marked «Añadido ✓» [Added ✓]; and the
  proxy must be deployed (`cloudflare/steam-proxy/README.md`).
  **Epic Games** offers no public library/hours API, so
  it does not sync.
- **Datos** [Data]: export, import or download your data:
  - **Exportar copia de seguridad** [Export backup]: downloads a file
    with ALL your data (movies, series, books, video games, profile and
    notifications). It is your life insurance: keep it wherever you
    want.
  - **Importar copia de seguridad** [Import backup]: restores data from
    a file you exported before. It **adds** what is missing to what you
    already have: it replaces or deletes nothing.
  - **Exportar calendario (.ics)** [Export calendar (.ics)]: downloads
    a file with the **upcoming episodes of your series, the pending
    releases of movies and the pending launches of your video
    games**, to import into Google
    Calendar, Apple Calendar or similar and have all the releases in
    your agenda.
  - **Importar desde TV Time** [Import from TV Time]: if you used the
    **TV Time** app, you can bring your full history. Take TV Time's
    export (a JSON file with all your series) and tap this button to
    pick that file: the web app shows you a summary (how many series
    and how many watched episodes it brings) and on confirm it **adds
    all the series to your tracker**, with the watched episodes on
    their original dates. Keep in mind:
    - Series are imported **by adding**, deleting nothing: if a series
      was already in your tracker, it will be **duplicated** (delete
      the old copy before importing if you do not want it duplicated).
    - **Special** seasons (season 0) and **favorites** from
      TV Time are not imported.
    - Coming from TV Time, series are saved **without the connection
      to the TMDB catalog**: they will see no releases/new episodes
      and will show no synopsis nor streaming platform. You can delete
      them and add them again from the catalog search and then have
      all their features again.

## 18. When is the data refreshed?

- **Once a day**, when you open the web app, it automatically checks
  whether something happened: releases of your pending movies and
  series, new episodes of the series you follow... If there is news,
  it appears in the bell icon.
- The cards' «extra» data (synopsis, cast, director, trailer,
  platforms...) is **not stored**: it is queried from the catalog when
  you open the card and remembered for a while so it is not requested
  every time. If the connection fails at that moment, the card shows
  with the basic data (cover, title, dates) and the details load as
  soon as there is network. That is why a card can show without a
  synopsis for a few seconds: it is being requested from the catalog.
  Episode and streaming platform data are also remembered for a while.
  Video games: their information (synopsis, platforms, IGDB ratings...)
  is requested when opening the card too, and the daily check takes
  care of their **launches**: if one with a known launch date goes on
  sale, you get the corresponding notice (games without a date have
  nothing to announce).
- The **«Comprobar estrenos»** button in Ajustes does the same at that
  moment (max. once every 30 minutes).
- If on sign-in there is a **sporadic connection failure** (a moment
  without network or a passing server error), the web app **retries by
  itself for a few seconds** before telling you. It also does it if
  the connection **hangs** (neither fails nor delivers data, something
  that can happen with slow or unstable connections): after a few
  seconds without receiving anything, it considers it a failure and
  tries again. The notice «Hay problemas de conexión. Reintentando…»
  [There are connection problems. Retrying…] may appear while it does
  it; normally you do not have to do anything. If a tab still fails to
  load, you will see a message with the **«Reintentar»** button:
  tap it to try again right then, without reloading the page
  (more in [section 21](#21-common-problems)).

## 19. Privacy

- **Your tracker is yours**: only you can edit your movies, series,
  books, video games and notes.
- Your **personal notes** are private: nobody else sees them.
- The notification settings are saved on your device and also in
  your account.

## 20. Install the web app on your phone

Mi Registro works as a normal website, but it can also be
**installed** so it behaves like an application:

- **On mobile** (Android/iPhone): open the web app and use the
  browser's «Añadir a pantalla de inicio» [Add to home screen] option
  (or «Instalar app» [Install app]).
- **On the computer**: use the browser's install button (usually in
  the address bar).

Once installed, you will have its icon on your screen. The web app works
even without connection to **see what is already loaded**; notes
and changes need an internet connection.

## 21. Common problems

**I cannot sign in with my email**
Your email is not on the guest list. Ask to be added (whoever
administers the web app does it in the Firebase security rules: the
`isAllowedUser()` list in `firestore.rules`, which must then be
published in the Firebase console).

**When searching books an «Error 503» appears or it takes long**
It is a sporadic failure of the books server, not your fault: the web
app retries by itself. If it persists, wait a few seconds and try
again.

**When searching video games «Falta IGDB_PROXY_URL…» [IGDB_PROXY_URL
missing…] or «IGDB rechazó la petición…» [IGDB rejected the request…]
appears**
Video game search goes through an **own proxy**
(IGDB does not allow direct queries from the browser). If
«Falta IGDB_PROXY_URL…» appears, whoever administers the web app has to
deploy the Cloudflare Worker of `cloudflare/igdb-proxy/` and set its
URL in `js/config.js`. If «IGDB rechazó la petición…» appears, the
Worker's Twitch credentials (Client ID and Client Secret) or the
request limit must be checked. In any case, the rest of the web app
works the same.

**When searching video games «No se pudo conectar con IGDB…» [Could
not connect to IGDB…] appears**
It usually means the Worker URL in `js/config.js` is not
correct (e.g. the Worker was deployed with another name, or it is
behind a «Cloudflare Access» login page). Whoever administers the
web app must review the step-by-step of
`cloudflare/igdb-proxy/README.md`, use the exact URL printed by
`wrangler deploy` and check that the Worker is public (that its JSON
`{"ok": true, ...}` is visible in the browser).

**My data does not load when I sign in**
The web app **retries automatically** for a few seconds: the notice
«Hay problemas de conexión. Reintentando…» may appear (the web app
also does it if the connection hangs, without actually failing). If
after a few seconds it still does not load, the error notice appears
(«No se pudieron cargar tus películas/series/libros/videojuegos»
[Your movies/series/books/video games could not be loaded])
with the **«Reintentar»** button: tap it to try again right then,
without reloading the page. If it still does not load, check your
internet connection and **reload the page**.

**I marked something by mistake**
Relax: if you just marked it, tap **«Deshacer»** in the rating window
that opens when marking and everything goes back to how it was.
You can also unmark episodes, remove watches from the history and
«Deshacer» any deletion in the seconds after.

**The web app tells me a title «aún no se ha estrenado» [has not been
released yet] and I think that is not the case**
Release data comes from the catalog (TMDB). If you think there is an
error, you can mark it as watched/read anyway: the web app will ask
first and you decide.

**I do not get system notifications**
Check the following:

- The web app must be **open** (even in the background): system
  notifications can only be shown while the web app is open. If you
  close it completely, they cannot arrive.
- The notification permission must be **granted** in your
  browser or phone settings (and the **«Notificaciones en el
  dispositivo»** option enabled in Ajustes → Notificaciones).
- On **iPhone**, the web app must be **installed as an app**
  ([section 20](#20-install-the-web-app-on-your-phone)) and have
  **iOS 16.4 or higher**.

---

*Anything unclear or missing in this manual? Tell whoever administers
the web app: we will add it.*
