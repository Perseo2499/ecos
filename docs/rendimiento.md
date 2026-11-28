# Rendimiento con webs grandes

Ecos tiene que ir fluido con webs grandes: **3.000+ entradas, 15.000+ fotos en la biblioteca, 2.000+ publicaciones de redes** y
entradas largas (**250 bloques, 110 fotos**). El banco de pruebas es `test-ui/perf.test.js` (datos deterministas de `test-ui/perf-data.js`
sobre el mock compartido). Mide con Playwright: tiempo hasta pintar, tareas largas (`PerformanceObserver` «longtask») y la latencia
de cada tecla en el editor.

```
npm run test:ui                                                                      # incluido: falla si se superan los umbrales
ECOS_PERF_NOCHECK=1 ECOS_PERF_OUT=/tmp/perf.json node --test test-ui/perf.test.js    # solo mide y guarda las cifras
ECOS_PERF_SCALE=0.3 node --test test-ui/perf.test.js                                 # tamaños reducidos (prueba rápida)
```

## Antes y después

Medido en Chromium headless de Playwright, 4 CPU compartidas, con un solo archivo de prueba (con `npm run test:ui` las cifras suben porque
los archivos corren en paralelo). Las cifras varían ±30 % entre ejecuciones; lo que importa son los órdenes de magnitud.

| Escenario | Antes: tiempo (ms) | Antes: tarea larga máx. (ms) | Después: tiempo (ms) | Después: tarea larga máx. (ms) |
| --- | ---: | ---: | ---: | ---: |
| Inicio: abrir | 738 | 149 | 716 | 123 |
| Blog: lista (primera pintura) | 152 | 0 | 145 | 0 |
| Blog: búsqueda | 465 | 0 | 459 | 0 |
| Blog: cambio de filtro | 71 | 0 | 57 | 0 |
| Blog: línea temporal (salto) | 85 | 0 | 71 | 0 |
| Blog: scroll | 780 | 0 | 795 | 0 |
| Medios: abrir biblioteca | 545 | 466 | 179 | 87 |
| Medios: búsqueda | 360 | 0 | 375 | 0 |
| Medios: filtro «Sin usar» | 256 | 163 | 145 | 0 |
| Medios: siguiente página | 286 | 202 | 91 | 0 |
| Calendario: mes | 109 | 0 | 101 | 0 |
| Calendario: año | 138 | 0 | 125 | 0 |
| Publicaciones Detalle: primera pintura | 2812 | 2028 | 820 | 80 |
| Publicaciones Detalle: todo listo | 12 | 0 | 5946 | 179 |
| Publicaciones Detalle: búsqueda | 297 | 196 | 406 | 101 |
| Publicaciones Detalle: scroll | 1654 | 148 | 1802 | 175 |
| Publicaciones Detalle: línea temporal (salto) | 721 | 60 | 867 | 89 |
| Publicaciones Cuadrícula: cambio de vista | 972 | 791 | 422 | 104 |
| Publicaciones Cuadrícula: scroll | 835 | 0 | 1229 | 0 |
| Buscador Ctrl+K: abrir | 292 | 57 | 125 | 0 |
| Buscador Ctrl+K: escribir | 1164 | 62 | 873 | 0 |
| Editor enorme: abrir (render) | 439 | 212 | 212 | 62 |
| Editor enorme: escribir en un párrafo | 8651 | 164 | 1603 | 0 |
| Editor enorme: latencia media por tecla | 166 | 211 | 23 | 62 |
| Editor enorme: arrastrar un bloque | 819 | 267 | 301 | 160 |
| Editor enorme: deshacer | 678 | 219 | 233 | 86 |

Notas para leer la tabla:

- **Blog**: la lista se pide por páginas de 20 a WordPress, así que con 3.000 entradas ya iba bien; lo que se comprueba es que la línea
  temporal (3.000 fechas) y el scroll no generan tareas largas (> 200 ms).
- **Publicaciones Detalle: primera pintura** es lo que ve la persona (de 2,8 s con una tarea de 2 s a 0,8 s). «Todo listo» es el tiempo hasta
  que las 2.000 filas están en el DOM: ahora se pintan en segundo plano por tandas de ~14 ms (antes era un solo bloqueo de 2 s, por eso
  «antes» marca ~0). Las tareas largas que quedan en ese tramo son de ≤ 180 ms con la CPU saturada.
- **Editor enorme: escribir**: de 166 ms a 23 ms por tecla (la entrada de 250 bloques ya no se recalcula entera con cada letra, y la lista
  de Publicaciones de debajo no se maqueta mientras se edita).
- La memoria JS (`performance.memory`) sale cuantizada en headless (25 MB en todos los pasos) y no aporta información; no se usa como umbral.

## Qué se ha cambiado

Interfaz (`renderer/`):

- **Publicaciones**: la lista se pinta por tandas (las 36 primeras filas al momento y el resto en segundo plano, cancelando si cambia el filtro);
  todas acaban en el DOM, así que selección, teclado, encabezados de mes/día y línea temporal siguen igual (al saltar a un mes se termina de
  pintar antes). «Ver más» solo se mide en las filas visibles (`IntersectionObserver`) en vez de forzar el diseño de las 2.000. Búsqueda con
  *debounce*, minúsculas y fechas calculadas una sola vez, «Quitar selección» sin repintar la lista, `decoding="async"` en las miniaturas.
- **Cuadrícula** y **editor**: `content-visibility: auto` (con `overflow-clip-margin` para no recortar sombras ni la barra del bloque).
  En Detalle no se usa: sus filas son de altura variable y la línea temporal mide los encabezados. Con el editor abierto, la lista de
  debajo no se maqueta (`content-visibility: hidden`, conservando su altura: al cerrar el editor vuelve al mismo sitio).
- **Editor**: al teclear solo se programa el autoguardado; revisión, accesibilidad/SEO y vista de «Cómo se verá» se ponen al día 350 ms
  después de dejar de escribir. La bandeja de fotos no se reconstruye si no ha cambiado. Fotos con `loading="lazy"` y `decoding="async"`.
- **Biblioteca de medios**: fecha original, orden y texto en minúsculas se calculan una vez por foto (15.000 expresiones regulares y
  ordenaciones con `new Date` en cada filtro eran la tarea larga de 460 ms); la lista ordenada se reutiliza al filtrar y paginar.
- **Buscador Ctrl+K**: el texto sin tildes de cada foto y publicación se guarda en caché y la búsqueda para al encontrar los primeros resultados.
- **Blog**: miniaturas con `decoding="async"`; «Actualizar» salta la caché corta de listas.

Lectura de datos (`src/`, `main.js`):

- `src/wpself.js`: `_fields` en las listas de entradas (sin el contenido) y en la biblioteca (solo medidas, peso y tamaños de `media_details`);
  la miniatura de cada entrada del Blog es la mediana (o pequeña) de la imagen destacada, no la original; las fechas de la línea temporal se
  piden en paralelo (4 a la vez) en vez de una página tras otra; caché en memoria con caducidad de 8 s para las listas del Blog y sus
  fechas (se vacía con cualquier escritura en WordPress y se salta con «Actualizar»).
- `main.js`: la copia local de la biblioteca (varios MB con miles de fotos) y el autoguardado del borrador se leen y escriben con
  `fs.promises`, sin bloquear el hilo principal.

## Umbrales de la prueba

Holgados a propósito (CI lenta): por ejemplo, el Blog con 3.000 entradas pinta en < 1,5 s y el scroll no genera tareas largas > 200 ms;
Publicaciones, la biblioteca de 15.000 fotos, el calendario, Ctrl+K y el editor con 250 bloques tienen los suyos en `LIMITS`
(`test-ui/perf.test.js`). La latencia media por tecla en el editor enorme no puede pasar de 300 ms.
