# Pruebas contra un WordPress real

`npm test` prueba la lógica de Ecos sin red. Estas pruebas (`test-wp/`) usan **los propios módulos de Ecos**
(`src/wpself.js`, `src/transform.js`, `src/parseblocks.js`, `src/wpblocks.js`, `src/wpeditor.js`) contra un WordPress de verdad,
para detectar a tiempo cualquier incompatibilidad con una versión nueva de WordPress, Astra, Spectra, Yoast o con el Complemento de Ecos.

## Qué comprueban

1. Conectar con usuario y contraseña de aplicación (y que una contraseña mala da un error claro).
2. Complemento de Ecos: instalado, misma versión que la app, rutas `status`, `theme`, `export`, `render`, `lock`.
3. Estructura del sitio: categorías, páginas y ajustes de lectura.
4. Subir una foto, ponerle texto alternativo y leerla de vuelta con `context=edit`.
5. Crear una entrada con muestras de **todos** los tipos de bloque que genera Ecos (los de `test/moreblocks-samples.js` y los de serie:
   texto, listas, citas, imágenes, galería y mosaico, imagen y texto, columnas, grupo, portada, botones, tabla, detalles, índice, vídeo,
   embed, carrusel), con categoría nueva, imagen destacada, extracto y descripción SEO.
6. Ida y vuelta: lo guardado en WordPress es lo enviado, y `composeBlocks(parseBlocks(lo leído))` da lo mismo; vuelven los bloques de Ecos.
7. Web pública (GET del enlace): están todas las clases `ecos-*` del contenido, el bloque `ecos-fx` con su CSS, la hoja `ecos.css` y los
   scripts del complemento (`ecos-anim.js`, `ecos-carousel.js`, `ecos-videos.js`, `ecos-more.js`) encolados; la página la pinta Astra (y Spectra, si está).
8. Yoast SEO: Ecos lo detecta, puede escribir la descripción, la lee de vuelta y la web pública lleva `<meta name="description">` y el título.
9. Vista previa exacta del complemento (`/ecos/v1/render`).
10. Bloques sincronizados (`wp_block`): crear (sincronizado y sin sincronizar), leer, listar, actualizar, usarlo por referencia en una entrada
    (la web muestra su contenido) y borrar.
11. Bloqueo de edición (tomar y soltar).
12. Editor de WordPress: `/ecos/v1/editor-session` devuelve una dirección de un solo uso; con ella se entra **una vez** (redirige al editor y
    entrega las cookies de sesión) y la **segunda vez se rechaza** (HTTP 403 y sin cookies).
13. Listados y calendario ven la entrada; al final se **borra todo** (entradas, foto, bloques y categoría de prueba).

## Ejecutarlas contra cualquier WordPress

Necesitas un usuario con permiso para publicar y subir fotos y su **contraseña de aplicación** (wp-admin → Usuarios → Perfil).
**Usa una web de pruebas**: se crean y se borran entradas, fotos y bloques.

```bash
npm install --ignore-scripts          # una vez
echo -n electron > node_modules/electron/path.txt   # si no has instalado Electron (los módulos solo necesitan que exista su ruta)
export WP_URL=https://mi-web-de-pruebas.example
export WP_USER=pruebas
export WP_APP_PASSWORD="abcd efgh ijkl mnop qrst uvwx"
npm run test:wp
```

Opcionales: `WP_EXPECT_SPECTRA=1` (falla si Spectra no está activo), `WP_EXPECT_YOAST=0` (la web no tiene Yoast SEO: se omiten sus pruebas).
Se necesitan el complemento de Ecos (`npm run plugin` genera `build/ecos-wordpress.zip`) y, para el 100 % de las pruebas, Astra, Spectra y Yoast.

## Levantar un WordPress de pruebas con Docker

```bash
npm run plugin                 # build/ecos-wordpress.zip
bash test-wp/setup.sh          # WordPress + MySQL en http://localhost:8080 con Astra, Spectra, Yoast SEO, el complemento y un usuario
# copia las líneas «export …» que muestra al terminar
npm run test:wp
docker compose -f test-wp/docker-compose.yml down -v    # apagar y borrar
```

`WP_PORT` cambia el puerto y `WP_IMAGE` la versión de WordPress (por ejemplo `WP_IMAGE=wordpress:6.5`).

## Probar el guion sin WordPress ni Docker

`node test-wp/run.js --sim` arranca `test-wp/sim-server.js`, un servidor mínimo que imita lo que Ecos usa de WordPress. Solo sirve para
comprobar que el guion está bien escrito; **no sustituye** a un WordPress real.

## En GitHub

`.github/workflows/pruebas.yml` (en cada `push` y `pull_request`, en paralelo al flujo de Windows y sin depender de él):

- Job **WordPress real (Docker)**: `test-wp/setup.sh` levanta todo con reintentos. Si Docker Hub o wordpress.org no responden tras varios
  reintentos, el job lo avisa (`::warning::`) y **termina en verde sin probar**: un servicio externo caído no bloquea nada. Si WordPress
  arranca y una prueba falla, el job **falla** (es una incompatibilidad real).
- Job **Interfaz (Playwright)**: ver `docs/pruebas-interfaz.md`.
