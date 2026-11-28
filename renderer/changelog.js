// Ecos · Historial de versiones (de la más nueva a la más antigua) y cálculo de «novedades desde la versión X».
// Cada cambio lleva su texto en español y en inglés. Secciones: new (Nuevo), improved (Mejorado), fixed (Corregido)
// y web («Para tu web»: hay que actualizar el complemento de WordPress; `plugin` indica su versión).
// Las versiones antiguas (0.x a 2.39) van agrupadas por rangos: `from` es la primera versión del rango.
// AL PUBLICAR UNA VERSIÓN: añade su entrada la primera de la lista (test/changelog.test.js lo comprueba).
(function (root) {
  const c = (es, en) => ({ es, en });

  const ENTRIES = [
    {
      version: '3.9.0', date: '2026-11-28',
      title: c('Fotos destacadas a mano', 'Hand-picked featured photos'),
      new: [
        c('Marca fotos y vídeos con una estrella (al pasar el ratón, con la tecla F o en el visor) y tenlos a mano en «Destacadas», en la Biblioteca de medios y en el selector «De la biblioteca», sin tener que buscarlos.', 'Mark photos and videos with a star (on hover, with the F key or in the viewer) and keep them at hand in "Featured", in the Media library and in the "From the library" picker, with no need to search for them.'),
        c('El selector del editor muestra arriba tus Destacadas y las fotos «Usadas recientemente» (las últimas 24 que añadiste a entradas). Cada web tiene sus propias listas y, si una foto ya no existe en WordPress, se quita sola con un aviso.', 'The editor picker shows your Featured photos and the ones "Recently used" (the last 24 you added to posts) at the top. Each site has its own lists and, if a photo no longer exists in WordPress, it is removed automatically with a notice.'),
        c('Nuevo filtro «De entradas»: las fotos que son la imagen destacada de alguna entrada o página, con el título de la entrada al pasar el ratón.', 'New "From posts" filter: the photos used as the featured image of a post or page, with the post title on hover.'),
        c('En la imagen destacada de la entrada, «Elegir de la biblioteca…» abre el selector directamente en tus Destacadas.', 'On a post\'s featured image, "Choose from the library…" opens the picker straight on your Featured photos.'),
      ],
    },
    {
      version: '3.8.1', date: '2026-11-28',
      title: c('Describir fotos con Claude Code', 'Describing photos with Claude Code'),
      fixed: [
        c('«Describir con IA» y «Describir fotos» con Claude Code ya no piden permiso para leer la foto (pasaba en Windows con tildes en el nombre de usuario): la foto se envía directamente a la IA.', '"Describe with AI" and "Describe photos" with Claude Code no longer ask for permission to read the photo (it happened on Windows with accents in the user name): the photo is sent directly to the AI.'),
      ],
    },
    {
      version: '3.8.0', date: '2026-11-28',
      title: c('Más rápida y al día', 'Faster and up to date'),
      improved: [
        c('Mucho más fluida con webs grandes: Publicaciones se abre hasta 3 veces más rápido, la biblioteca de medios sin tirones y escribir en entradas muy largas responde al instante.', 'Much smoother with big sites: Posts opens up to 3 times faster, the media library without stutters and typing in very long posts responds instantly.'),
        c('El Blog pide a WordPress solo los datos que necesita y miniaturas pequeñas en lugar de las fotos originales.', 'The Blog asks WordPress only for the data it needs and small thumbnails instead of the original photos.'),
        c('Actualizada la base de la aplicación (Electron 45): más segura y al día con Chromium y Node recientes.', 'Updated the app foundation (Electron 45): more secure and up to date with recent Chromium and Node.'),
      ],
    },
    {
      version: '3.7.0', date: '2026-11-28', plugin: '1.8.0',
      title: c('Más compatible con WordPress', 'More compatible with WordPress'),
      new: [
        c('Los bloques más usados de Spectra, Kadence y GenerateBlocks se editan dentro de Ecos (textos, enlaces, imágenes, nivel de título, alineación y colores sencillos), conservando su diseño.', 'The most used Spectra, Kadence and GenerateBlocks blocks can be edited inside Ecos (texts, links, images, heading level, alignment and simple colours), keeping their design.'),
        c('Tipos de contenido propios (eventos, proyectos…) en el Blog y en el editor, con sus categorías.', 'Custom post types (events, projects…) in the Blog and in the editor, with their categories.'),
        c('Panel «Campos» con los campos personalizados de ACF, Meta Box y los metas de WordPress.', '"Fields" panel with ACF, Meta Box and WordPress meta custom fields.'),
        c('Idiomas con Polylang y WPML: idioma de cada entrada, sus traducciones y «Crear traducción», con traducción por IA opcional.', 'Languages with Polylang and WPML: each post language, its translations and "Create translation", with optional AI translation.'),
        c('SEO completo con Yoast y Rank Math: palabras clave, URL canónica, no indexar, datos para Facebook y X con vista previa, y análisis con consejos.', 'Full SEO with Yoast and Rank Math: keyphrases, canonical URL, noindex, Facebook and X data with preview, and analysis with tips.'),
        c('Editor de menús y widgets de tu web (Blog → Menús y widgets), con copia previa para deshacer.', 'Menu and widget editor for your site (Blog → Menus and widgets), with a backup to undo.'),
        c('Revisión entre varias personas: «Enviar a revisión», barra para aprobar o devolver con comentarios, notas internas ancladas a bloques, avisos cuando otra persona cambia una entrada y «Actividad reciente» en Inicio.', 'Team review: "Submit for review", a bar to approve or send back with comments, internal notes anchored to blocks, notices when someone else changes a post and "Recent activity" on Home.'),
      ],
      web: [
        c('Actualiza el Complemento de Ecos a la 1.8.0: hace falta para los campos, los idiomas, el SEO completo y las notas de revisión.', 'Update the Ecos plugin to 1.8.0: it is needed for fields, languages, full SEO and review notes.'),
      ],
    },
    {
      version: '3.6.1', date: '2026-11-27', plugin: '1.7.1',
      title: c('Arreglos hallados al probar con un WordPress real', 'Fixes found by testing against a real WordPress'),
      fixed: [
        c('Guardar como «Patrón sin sincronizar» ahora se respeta (antes se guardaba como sincronizado) y guardar como sincronizado ya no da error.', 'Saving as "Unsynced pattern" is now respected (it used to be saved as synced), and saving as synced no longer fails.'),
        c('Con una contraseña de aplicación mal copiada, Ecos ya no dice que tu servidor pierde la autorización: con el complemento te dice cuál de las dos cosas es.', 'With a mistyped application password, Ecos no longer says your server drops the authorization: with the plugin it tells you which of the two it is.'),
        c('En webs con Astra recién instalado, los colores del tema aparecen en el editor aunque no se hayan guardado en el personalizador.', 'On sites with a freshly installed Astra, the theme colours show up in the editor even if they were never saved in the Customizer.'),
        c('El editor de WordPress integrado se abre aunque otro plugin (por ejemplo, Spectra recién activado) intente llevarte a su asistente.', 'The built-in WordPress editor opens even if another plugin (for example, a freshly activated Spectra) tries to send you to its setup wizard.'),
      ],
      web: [
        c('Actualiza el Complemento de Ecos a la 1.7.1.', 'Update the Ecos plugin to 1.7.1.'),
      ],
    },
    {
      version: '3.6.0', date: '2026-11-27', plugin: '1.7.0',
      title: c('Más estable: envíos que se reanudan, sin conexión, diagnóstico y copias programadas', 'More stable: resumable sends, offline mode, diagnostics and scheduled backups'),
      new: [
        c('Modo sin conexión: puedes seguir trabajando sin internet; Inicio y Blog muestran los últimos datos guardados y los envíos esperan a que vuelva la conexión.', 'Offline mode: keep working without internet; Home and Blog show the last saved data and sends wait until you are back online.'),
        c('Diagnóstico de conexión: comprueba internet, tu web, la API, el complemento, Meta y la IA y te dice qué falla (VPN, cortafuegos, certificado…).', 'Connection diagnostics: checks internet, your site, the API, the plugin, Meta and the AI and tells you what is wrong (VPN, firewall, certificate…).'),
        c('Tarjeta «Tu web» en Conexiones: versión de WordPress y PHP, tema, plugins y límites de subida, con avisos de incompatibilidad.', '"Your site" card in Connections: WordPress and PHP versions, theme, plugins and upload limits, with compatibility warnings.'),
        c('Copias de seguridad programadas (diaria, semanal o mensual), incrementales, con historial, verificación y opción de subirlas a Google Drive.', 'Scheduled backups (daily, weekly or monthly), incremental, with history, verification and optional upload to Google Drive.'),
        c('Informes de errores opcionales (desactivados por defecto): si algo falla, Ecos te ofrece abrir un aviso ya preparado y sin datos personales.', 'Optional error reports (off by default): if something fails, Ecos offers to open a prepared report without personal data.'),
      ],
      improved: [
        c('Los envíos a WordPress se reanudan tras un corte o un cierre: no se vuelven a subir las fotos ya subidas ni se crea otra entrada.', 'Sends to WordPress resume after a drop or a crash: photos already uploaded are not uploaded again and no second post is created.'),
        c('Si una entrada cambió en WordPress mientras trabajabas sin conexión, Ecos te deja comparar, sobrescribir o guardar como copia.', 'If a post changed in WordPress while you were offline, Ecos lets you compare, overwrite or save as a copy.'),
        c('Un solo aviso cuando no hay conexión, en lugar de muchos seguidos.', 'A single notice when there is no connection, instead of many in a row.'),
        c('Cada versión se prueba automáticamente contra un WordPress real (Astra, Spectra y Yoast) y en todas las pantallas de la app.', 'Every version is automatically tested against a real WordPress (Astra, Spectra and Yoast) and on every screen of the app.'),
      ],
      web: [
        c('Actualiza el Complemento de Ecos a la 1.7.0 para ver todos los datos de «Tu web».', 'Update the Ecos plugin to 1.7.0 to see all "Your site" data.'),
      ],
    },
    {
      version: '3.5.4', date: '2026-11-27',
      title: c('Pantalla de arranque', 'Startup screen'),
      improved: [
        c('Al abrir Ecos se ve una pantalla de arranque con el logo y el color de tu tema, en lugar del fondo blanco con la interfaz a medio cargar, y pasa directamente a la pantalla de acceso o a Inicio.', 'When Ecos opens, a startup screen with the logo and your theme colour is shown instead of the white background with a half-loaded interface, and it goes straight to the sign-in screen or Home.'),
      ],
    },
    {
      version: '3.5.3', date: '2026-11-27',
      title: c('Cuadrícula o detalle en Publicaciones', 'Grid or details in Posts'),
      improved: [
        c('Botón «Detalle / Cuadrícula» con texto en Publicaciones: la cuadrícula vuelve a ser la de antes, con todas las publicaciones seguidas, y el detalle las agrupa por fechas con la línea temporal.', '"Details / Grid" button with text in Posts: the grid is back to how it was, with all posts together, and details groups them by date with the timeline.'),
      ],
    },
    {
      version: '3.5.2', date: '2026-11-27',
      title: c('Detalles visuales', 'Visual details'),
      fixed: [
        c('El icono de los avisos de arriba (por ejemplo, «Tienes una entrada sin enviar») queda alineado con el texto.', 'The icon of the notices at the top (for example, "You have an unsent post") is aligned with the text.'),
      ],
    },
    {
      version: '3.5.1', date: '2026-11-27',
      title: c('Publicaciones con todo su detalle', 'Posts with all their details'),
      new: [
        c('En Publicaciones, cada publicación ocupa una fila: junto a la tarjeta se ven la fecha y la hora, la red con enlace a la original, la descripción completa y todas sus fotos y vídeos.', 'In Posts, each post takes a full row: next to the card you see the date and time, the network with a link to the original, the full description and all its photos and videos.'),
        c('Conmutador «Detalle / Rejilla» para volver a la rejilla de antes.', '"Details / Grid" switch to go back to the previous grid.'),
      ],
      improved: [
        c('Ajustes → Actualizaciones: «Buscar actualizaciones» está arriba, junto a la versión, y el historial queda plegado tras «Ver el historial de versiones».', 'Settings → Updates: "Check for updates" is at the top, next to the version, and the history is folded behind "Show the version history".'),
      ],
    },
    {
      version: '3.5.0', date: '2026-11-27',
      title: c('Línea temporal e historial de versiones', 'Timeline and version history'),
      new: [
        c('Línea temporal estilo Google Fotos en Blog y Publicaciones, con las entradas ordenadas por fecha.', 'Google Photos-style timeline in Blog and Posts, with entries sorted by date.'),
        c('Historial de versiones y novedades en Ajustes → Actualizaciones, con lo que trae cada versión.', 'Version history and news in Settings → Updates, showing what each version brings.'),
        c('Al abrir Ecos tras actualizar, una tarjeta te cuenta qué ha cambiado desde la última versión que usaste.', 'After updating, a card tells you what has changed since the last version you used.'),
      ],
    },
    {
      version: '3.4.2', date: '2026-11-27',
      title: c('Describir fotos con la IA por línea de comandos', 'Describing photos with the command-line AI'),
      fixed: [
        c('«Describir con IA» y «Describir fotos» vuelven a funcionar con Claude Code, Codex y Gemini CLI (antes ponían siempre una descripción básica o daban error).', '"Describe with AI" and "Describe photos" work again with Claude Code, Codex and Gemini CLI (before, they always set a basic description or failed).'),
      ],
    },
    {
      version: '3.4.1', date: '2026-11-27',
      title: c('Descripciones con IA más claras', 'Clearer AI descriptions'),
      improved: [
        c('«Describir con IA» en la revisión de accesibilidad indica que está trabajando mientras describe las fotos.', '"Describe with AI" in the accessibility review shows that it is working while it describes the photos.'),
        c('Ahora puedes describir todas las fotos sin descripción de una sola vez.', 'You can now describe all photos without a description in one go.'),
      ],
      fixed: [
        c('Si la IA falla, ahora se muestra el motivo en lugar de no hacer nada.', 'When the AI fails, the reason is now shown instead of nothing happening.'),
      ],
    },
    {
      version: '3.4.0', date: '2026-11-27',
      title: c('Editor de WordPress integrado', 'Built-in WordPress editor'),
      new: [
        c('Editor de WordPress dentro de Ecos: edita los bloques de otros plugins o la entrada completa sin salir de la aplicación.', 'WordPress editor inside Ecos: edit blocks from other plugins or the whole post without leaving the app.'),
      ],
      improved: [
        c('Cuando falla la conexión con tu web, Ecos dice la causa real (dirección que no existe, conexión rechazada, certificado caducado…).', 'When the connection to your website fails, Ecos now tells you the real cause (unknown address, refused connection, expired certificate…).'),
      ],
      web: [
        c('Actualiza el complemento de Ecos en WordPress para usar el editor integrado.', 'Update the Ecos plugin in WordPress to use the built-in editor.'),
      ],
      plugin: '1.6.0',
    },
    {
      version: '3.3.0', date: '2026-11-27',
      title: c('Bloques nuevos, patrones y accesibilidad', 'New blocks, patterns and accessibility'),
      new: [
        c('13 bloques nuevos: pestañas, línea de tiempo, cifras, testimonios, tarjetas con icono, llamada a la acción, donación, evento, audio, PDF, puntos interactivos, antes/después y preguntas frecuentes.', '13 new blocks: tabs, timeline, figures, testimonials, icon cards, call to action, donation, event, audio, PDF, hotspots, before/after and FAQ.'),
        c('Patrones de la web: reutiliza como bloques las composiciones que ya tienes en tu sitio.', 'Site patterns: reuse the layouts you already have on your site as blocks.'),
        c('Bloques sincronizados: cambia uno y se actualiza en todas las entradas donde esté.', 'Synced blocks: change one and it updates in every post where it appears.'),
        c('Plantillas propias: guarda tus composiciones y empieza con ellas cualquier entrada.', 'Your own templates: save your layouts and start any post from them.'),
        c('Revisión de accesibilidad: contraste de colores, títulos, textos alternativos, enlaces y tamaños, con arreglos automáticos y una puntuación.', 'Accessibility review: colour contrast, headings, alternative texts, links and sizes, with automatic fixes and a score.'),
      ],
      web: [
        c('Actualiza el complemento de Ecos en WordPress para que los bloques nuevos se vean y funcionen en tu web.', 'Update the Ecos plugin in WordPress so the new blocks display and work on your website.'),
      ],
      plugin: '1.5.0',
    },
    {
      version: '3.2.0', date: '2026-11-26',
      title: c('Panel de diseño para cualquier bloque', 'Design panel for any block'),
      new: [
        c('Panel de diseño para cualquier bloque: espacios, bordes, fondos y más.', 'Design panel for any block: spacing, borders, backgrounds and more.'),
        c('Ajustes distintos por dispositivo: ordenador, tableta y móvil.', 'Different settings per device: computer, tablet and phone.'),
        c('Animaciones de entrada para los bloques.', 'Entrance animations for blocks.'),
        c('Tipografía con fuentes de Google.', 'Typography with Google Fonts.'),
        c('Copiar el estilo de un bloque y pegarlo en otros, y guardar estilos para reutilizarlos.', 'Copy the style of one block and paste it onto others, and save styles to reuse them.'),
      ],
      improved: [
        c('El panel de diseño usa los colores de tu tema.', 'The design panel uses your theme colours.'),
      ],
      fixed: [
        c('La tarjeta de Visitas ya no falla cuando faltan datos.', 'The Visits card no longer fails when data is missing.'),
      ],
      web: [
        c('Actualiza el complemento de Ecos en WordPress para ver las animaciones y los ajustes por dispositivo en tu web.', 'Update the Ecos plugin in WordPress to see the animations and per-device settings on your website.'),
      ],
      plugin: '1.4.0',
    },
    {
      version: '3.1.0', date: '2026-11-26',
      title: c('Tu tema dentro del editor', 'Your theme inside the editor'),
      new: [
        c('Los colores, tamaños y fuentes de tu web aparecen en el editor para elegirlos al instante.', 'The colours, sizes and fonts of your website appear in the editor so you can pick them instantly.'),
        c('Vista exacta: previsualiza la entrada con el diseño real de tu tema.', 'Exact view: preview the post with the real design of your theme.'),
        c('Ajustes de página de Astra (barra lateral, ancho, cabecera) desde Ecos.', 'Astra page settings (sidebar, width, header) from Ecos.'),
        c('Panel de capas para ver y ordenar los bloques de la entrada.', 'Layers panel to see and reorder the blocks of a post.'),
        c('Selección múltiple: mueve, duplica, agrupa, copia y pega varios bloques a la vez.', 'Multiple selection: move, duplicate, group, copy and paste several blocks at once.'),
      ],
      web: [
        c('Actualiza el complemento de Ecos en WordPress para leer los estilos del tema y los ajustes de Astra.', 'Update the Ecos plugin in WordPress to read the theme styles and the Astra settings.'),
      ],
      plugin: '1.4.0',
    },
    {
      version: '3.0.1', date: '2026-11-26',
      title: c('Actualizaciones y avisos legales', 'Updates and legal notices'),
      improved: [
        c('Las actualizaciones siguen llegando automáticamente como siempre.', 'Updates keep arriving automatically as usual.'),
        c('La licencia y los avisos se abren desde la propia aplicación.', 'The licence and notices open from inside the app.'),
      ],
    },
    {
      version: '3.0.0', date: '2026-11-23',
      title: c('Ecos, software libre', 'Ecos, free software'),
      new: [
        c('Ecos pasa a ser software libre (licencia GPL-3.0), con avisos de terceros y políticas de firma y de privacidad.', 'Ecos becomes free software (GPL-3.0 licence), with third-party notices and signing and privacy policies.'),
      ],
      improved: [
        c('Aplicación genérica: sirve para cualquier web, sin datos de ninguna organización concreta.', 'Generic application: it works for any website, with no data from a specific organisation.'),
      ],
    },
    {
      version: '2.49.1', date: '2026-11-23',
      title: c('Ecos genérico', 'Generic Ecos'),
      improved: [
        c('Ecos ya no trae datos ni web de ejemplo de una organización concreta; quien usaba la web por defecto se migra sin perder nada.', 'Ecos no longer ships example data or a website of a specific organisation; people who used the default site are migrated without losing anything.'),
      ],
    },
    {
      version: '2.49.0', date: '2026-11-23',
      title: c('Copia de emergencia', 'Emergency backup'),
      new: [
        c('Copia de emergencia: contenido, copia visual que se puede navegar, configuración y guía de recuperación.', 'Emergency backup: content, a browsable visual copy, settings and a recovery guide.'),
        c('Copias automáticas cada mes y aviso si la última es antigua.', 'Automatic monthly backups and a warning when the latest one is old.'),
      ],
      web: [c('Actualiza el complemento de Ecos en WordPress.', 'Update the Ecos plugin in WordPress.')],
      plugin: '1.3.0',
    },
    {
      version: '2.48.0', date: '2026-11-23',
      title: c('Varias personas en la misma web', 'Several people on the same site'),
      new: [
        c('Verás con qué usuario estás conectado y quién es el autor de cada entrada.', 'You see which user you are connected as and who wrote each post.'),
        c('Filtro «Solo las mías» y envío de entradas a revisión.', '"Only mine" filter and sending posts for review.'),
        c('Aviso cuando otra persona está editando la misma entrada.', 'Warning when someone else is editing the same post.'),
      ],
      web: [c('Actualiza el complemento de Ecos en WordPress.', 'Update the Ecos plugin in WordPress.')],
      plugin: '1.2.0',
    },
    {
      version: '2.47.0', date: '2026-11-23',
      title: c('Compartir, Google y visitas', 'Sharing, Google and visits'),
      new: [
        c('Vista previa de cómo se verá la entrada al compartirla.', 'Preview of how the post will look when shared.'),
        c('Datos para Google (resultados enriquecidos).', 'Data for Google (rich results).'),
        c('Visitas sin cookies en Inicio.', 'Cookie-free visits on Home.'),
      ],
      web: [c('Actualiza el complemento de Ecos en WordPress.', 'Update the Ecos plugin in WordPress.')],
      plugin: '1.1.0',
    },
    {
      version: '2.46.0', date: '2026-11-23',
      title: c('Más seguridad y comodidad', 'More safety and convenience'),
      new: [
        c('Canal de pruebas para recibir las versiones nuevas antes.', 'Test channel to get new versions earlier.'),
        c('Modo seguro al arrancar si algo falla.', 'Safe mode at start-up if something goes wrong.'),
        c('Cola de envíos: si no hay conexión, el envío espera y se hace solo.', 'Upload queue: with no connection, the upload waits and is sent automatically.'),
        c('Borradores automáticos de las publicaciones nuevas.', 'Automatic drafts of new posts.'),
      ],
      improved: [
        c('Las fotos se suben en WebP cuando así pesan menos.', 'Photos are uploaded as WebP when that makes them lighter.'),
        c('«Buscar actualizaciones» descarga al momento, sin esperar.', '"Check for updates" now downloads right away, without waiting.'),
      ],
    },
    {
      version: '2.45.1', date: '2026-11-23',
      title: c('Arreglo urgente del arranque', 'Urgent start-up fix'),
      fixed: [c('Ecos volvía a abrirse con un error en algunos equipos; corregido.', 'Ecos failed to open with an error on some computers; fixed.')],
    },
    {
      version: '2.45.0', date: '2026-11-23',
      title: c('Editor más fluido', 'Smoother editor'),
      improved: [
        c('El editor cambia solo el bloque que tocas: sin parpadeos ni pérdida del cursor.', 'The editor only redraws the block you touch: no flicker and no lost cursor.'),
      ],
    },
    {
      version: '2.44.0', date: '2026-11-23',
      title: c('Bloques validados y copias de seguridad', 'Validated blocks and safety copies'),
      improved: [
        c('Los bloques de imagen y texto, portada, vídeo e insertados se comprueban contra WordPress para que no den avisos al abrirlos.', 'Image-and-text, cover, video and embedded blocks are checked against WordPress so they raise no warnings when opened.'),
        c('Se guarda una copia local antes de enviar cada entrada.', 'A local copy is saved before each post is sent.'),
        c('Registro de errores para localizar problemas.', 'Error log to help track down problems.'),
      ],
    },
    {
      version: '2.43.0', date: '2026-11-23',
      title: c('Vídeos en mejor calidad', 'Better quality videos'),
      new: [
        c('Aviso cuando un vídeo o una foto tiene poca resolución, y opción de sustituirlo por el original.', 'Warning when a video or photo has low resolution, with an option to replace it with the original.'),
        c('Los vídeos y fotos de Meta se suben a tu web.', 'Meta videos and photos are uploaded to your website.'),
      ],
      improved: [c('Se usa la mejor versión del vídeo de Meta, comprimida a 1080p y con portada.', 'The best version of the Meta video is used, compressed to 1080p and with a cover image.')],
    },
    {
      version: '2.42.0', date: '2026-11-23',
      title: c('Complemento de Ecos para WordPress', 'Ecos plugin for WordPress'),
      new: [c('Complemento de Ecos para WordPress: el carrusel y los vídeos se cargan una sola vez y la caché se vacía al publicar.', 'Ecos plugin for WordPress: the carousel and videos load only once and the cache is cleared on publishing.')],
      web: [c('Instala el complemento de Ecos en tu WordPress.', 'Install the Ecos plugin on your WordPress.')],
      plugin: '1.0.0',
    },
    {
      version: '2.41.3', from: '2.40.0', date: '2026-11-23',
      title: c('Carrusel y vídeos', 'Carousel and videos'),
      new: [
        c('Carrusel con vídeos y opciones de estilo para vídeos: marco, sombra, zoom, proporción y colocación.', 'Carousel with videos and video style options: frame, shadow, zoom, ratio and placement.'),
        c('Botón «Importar» en el editor para cargar entradas o páginas exportadas de WordPress o un archivo HTML.', '"Import" button in the editor to load posts or pages exported from WordPress or an HTML file.'),
      ],
      improved: [
        c('Los vídeos del carrusel ocupan toda la diapositiva, con botón de sonido y pausa al tocar.', 'Carousel videos fill the whole slide, with a sound button and tap-to-pause.'),
        c('Un vídeo suelto se reproduce solo y en silencio al verse.', 'A standalone video plays by itself and silently when it comes into view.'),
      ],
      fixed: [c('El carrusel funciona en la web aunque WordPress rompa su script.', 'The carousel works on the website even when WordPress breaks its script.')],
    },
    {
      version: '2.39.0', from: '2.30.0', date: '2026-11-22',
      title: c('Inicio, Google Fotos y editor', 'Home, Google Photos and editor'),
      new: [
        c('Inicio renovado con una agenda por día, semana, mes o año.', 'Renewed Home with a day, week, month or year agenda.'),
        c('Google Fotos: conecta tu cuenta, elige fotos y revísalas antes de subirlas.', 'Google Photos: connect your account, pick photos and review them before uploading.'),
        c('Juntar varias publicaciones en una sola entrada, por jornadas.', 'Join several posts into a single entry, by day.'),
        c('Fondo de página personalizable.', 'Customisable page background.'),
        c('Barra de formato flotante al seleccionar texto, como en Word.', 'Floating format bar when selecting text, as in Word.'),
        c('Imagen y texto y carrusel con más opciones de tamaño, alineación y estilo.', 'Image-and-text and carousel with more size, alignment and style options.'),
        c('Arrastra una foto dentro del texto y suelta bloques unos sobre otros.', 'Drag a photo into the text and drop blocks onto other blocks.'),
        c('Compartir en Facebook, opcional.', 'Optional sharing on Facebook.'),
      ],
      improved: [
        c('«Convertir en artículo» reescribe por tramos sin mover fotos ni bloques.', '"Turn into article" rewrites section by section without moving photos or blocks.'),
        c('«Describir fotos» va de una en una, con progreso y botón de parada.', '"Describe photos" goes one at a time, with progress and a stop button.'),
        c('Mejor reconocimiento de la misma publicación en Instagram y Facebook.', 'Better recognition of the same post on Instagram and Facebook.'),
      ],
      fixed: [c('Varios retoques visuales en el carrusel, el texto justificado y la cabecera.', 'Several visual fixes in the carousel, justified text and the header.')],
    },
    {
      version: '2.29.0', from: '2.20.0', date: '2026-11-22',
      title: c('Páginas, buscador y copia de la web', 'Pages, search and site backup'),
      new: [
        c('Editor de páginas y conversión de páginas de Spectra en páginas editables de Ecos.', 'Page editor and conversion of Spectra pages into editable Ecos pages.'),
        c('Buscador general (Ctrl+K) y copia de seguridad de la web.', 'General search (Ctrl+K) and website backup.'),
        c('Aviso de publicaciones nuevas y pestaña Redes.', 'New-posts notice and a Networks tab.'),
        c('Vista previa en Google y redes y descripción para buscadores.', 'Google and social preview and a description for search engines.'),
        c('Calendario editorial con arrastrar y soltar, plantillas de contenido y revisión del blog.', 'Editorial calendar with drag and drop, content templates and blog review.'),
        c('Pegar imágenes en el editor y menú del botón derecho.', 'Paste images in the editor and a right-click menu.'),
      ],
      improved: [
        c('Mapa de páginas con zoom, botones y unión de páginas.', 'Page map with zoom, buttons and page joining.'),
        c('Errores en español claro y deshacer en lote.', 'Errors in plain language and batch undo.'),
      ],
    },
    {
      version: '2.19.0', from: '2.10.0', date: '2026-11-21',
      title: c('Entradas y páginas nuevas', 'New posts and pages'),
      new: [
        c('Crear entradas y páginas nuevas en Ecos, editar páginas y duplicarlas.', 'Create new posts and pages in Ecos, edit pages and duplicate them.'),
        c('Estructura con creación de páginas, avisos y mapa.', 'Structure with page creation, warnings and a map.'),
        c('Mejorar fotos con IA.', 'Improve photos with AI.'),
      ],
    },
    {
      version: '2.9.0', from: '2.0.0', date: '2026-11-21',
      title: c('Seguridad, calendario y herramientas', 'Security, calendar and tools'),
      new: [
        c('Autoguardado y fotos optimizadas.', 'Autosave and optimised photos.'),
        c('Calendarios, historial de cambios, buscar y reemplazar y biblioteca de medios.', 'Calendars, change history, find and replace and a media library.'),
        c('Desbloqueo con Windows Hello (huella, cara o PIN).', 'Unlock with Windows Hello (fingerprint, face or PIN).'),
        c('Revisión de enlaces rotos.', 'Broken link check.'),
        c('«Normalizar formato» en el editor y al restaurar.', '"Normalise format" in the editor and when restoring.'),
      ],
      fixed: [c('Carrusel duplicado al leerlo y «Editar entrada»; el editor se abre desde Blog y Calendario.', 'Duplicated carousel when reading a post and "Edit post"; the editor opens from Blog and Calendar.')],
    },
    {
      version: '1.12.0', from: '1.0.0', date: '2026-11-20',
      title: c('Editor, restauración y contraseña', 'Editor, restore and password'),
      new: [
        c('Editor completo: formato, fuentes, colores, vídeo por enlace, tablas, botones, índice e IA por bloque.', 'Full editor: formatting, fonts, colours, video by link, tables, buttons, table of contents and AI per block.'),
        c('Contraseña y doble factor con bóveda cifrada y bloqueo automático.', 'Password and two-factor with an encrypted vault and automatic lock.'),
        c('Tema Vinilo y barra inferior para navegar.', 'Vinyl theme and a bottom bar to navigate.'),
        c('Editar en Ecos las entradas ya enviadas, y actualizar desde WordPress en ambos sentidos.', 'Edit already-sent posts in Ecos, and update from WordPress in both directions.'),
        c('«Convertir en artículo» con opciones, y IA por línea de comandos (Claude Code, Codex, Gemini).', '"Turn into article" with options, and command-line AI (Claude Code, Codex, Gemini).'),
        c('Estructura de la web: portada, menú, páginas y categorías en un esquema editable.', 'Site structure: front page, menu, pages and categories in an editable outline.'),
      ],
    },
    {
      version: '0.9.0', from: '0.1.0', date: '2026-11-19',
      title: c('Primeras versiones', 'First versions'),
      new: [
        c('Publicaciones de Instagram y Facebook convertidas en entradas de WordPress.', 'Instagram and Facebook posts turned into WordPress posts.'),
        c('Editor visual, programar entradas, plantillas, resúmenes con IA y arrastrar y soltar.', 'Visual editor, scheduling, templates, AI summaries and drag and drop.'),
        c('Conectar con tu propio WordPress y restaurar entradas desde una copia de seguridad.', 'Connect to your own WordPress and restore posts from a backup.'),
        c('Español e inglés.', 'Spanish and English.'),
      ],
    },
  ];

  // ---------------------------------------------------------------- lógica
  const SECTIONS = ['new', 'improved', 'fixed', 'web'];
  const parse = (v) => String(v || '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  function compareVersions(a, b) {
    const x = parse(a), y = parse(b);
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  const entryFor = (v, list = ENTRIES) => list.find((e) => compareVersions(e.version, v) === 0) || null;
  // Entradas con versión posterior a `from` y no posterior a `to` (más nueva primero). Sin `from`: todas hasta `to`.
  function changesSince(from, to, list = ENTRIES) {
    return list.filter((e) => (!from || compareVersions(e.version, from) > 0) && (!to || compareVersions(e.version, to) <= 0));
  }
  // Une las secciones de varias entradas (para el diálogo tras actualizar)
  function merge(entries) {
    const out = { plugin: null, new: [], improved: [], fixed: [], web: [] };
    for (const e of entries) {
      for (const s of SECTIONS) for (const it of e[s] || []) out[s].push({ ...it, version: e.version });
      if (e.plugin && (!out.plugin || compareVersions(e.plugin, out.plugin) > 0)) out.plugin = e.plugin;
    }
    return out;
  }
  const label = (e) => (e.from && e.from !== e.version ? e.from.replace(/\.0$/, '') + '–' + e.version.replace(/\.0$/, '') : e.version);
  const pick = (o, lang) => (o && typeof o === 'object' ? (o[lang] ?? o.es) : o);

  const api = { ENTRIES, SECTIONS, compareVersions, entryFor, changesSince, merge, label, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Changelog = api;
})(typeof window !== 'undefined' ? window : globalThis);
