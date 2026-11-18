# Ecos — de tus redes a tu blog

Aplicación de escritorio (Electron) que lee las publicaciones de Instagram y Facebook de la
Asociación ELIN y las convierte en entradas del blog de **asociacionelin.com** (WordPress.com).

## Descargar
Última versión para Windows: **[Releases](https://github.com/Perseo2499/ecos/releases/latest)** → `Ecos-Setup-x.y.z.exe` (instalador; se actualiza solo). También hay una versión portable, que no se actualiza.
Cada cambio subido a `main` compila una versión nueva automáticamente; para publicar otra versión, sube el número en `package.json`.

## 1. Requisitos
- Windows 10/11 con [Node.js 20 o superior](https://nodejs.org).
- Instagram como **cuenta profesional** (Empresa o Creador) **vinculada a una Página de Facebook**.
- Ser administrador de esa Página y del sitio de WordPress.com.

## 2. Instalar y arrancar
```bash
npm install
npm start
```
Para generar el instalador `.exe`: `npm run dist` (queda en `dist/`).

## 3. Crear la app de Meta (una sola vez)
1. Entra en https://developers.facebook.com/apps y pulsa **Crear app** → tipo **Empresa**.
2. Añade el producto **Inicio de sesión con Facebook**.
3. En *Configuración → Básica* copia el **App ID** y el **App Secret**.
4. En *Inicio de sesión con Facebook → Configuración*, añade `http://localhost:53682/meta` en *URI de redireccionamiento de OAuth válidos*.
   El inicio de sesión se abre en tu **navegador predeterminado**, donde ya tienes tus cuentas abiertas.
5. Mantén la app en **modo desarrollo**: así funciona con tu cuenta sin pasar la revisión de Meta.
   Los permisos que pide son `pages_show_list`, `pages_read_engagement`, `instagram_basic` y `business_management`.

### Si Meta no te deja añadir los permisos
Las apps creadas con el caso de uso «Inicio de sesión con Facebook» (consumidores) no admiten los permisos de páginas ni de Instagram. Crea otra app eligiendo **Otro → Empresa**, añade el producto **Inicio de sesión con Facebook para empresas**, crea una **configuración** con el tipo de token *Token de acceso de usuario* y los permisos de arriba, y pega su **ID de configuración** en Ecos.

## 4. Crear la app de WordPress.com (una sola vez)
1. Entra en https://developer.wordpress.com/apps/ → **Create New Application**.
2. *Website URL*: `https://www.asociacionelin.com/`. *Redirect URLs*: `http://localhost:53682/wordpress`.
3. Tipo: **Web**. Copia el **Client ID** y el **Client Secret**.

## 5. Cuatro formas de traer publicaciones
| Origen | Cuándo usarlo | Requisitos |
|---|---|---|
| **Conectar con Meta** | Día a día, automático | Instagram profesional (gratis) vinculado a una Página, y app de Meta |
| **ZIP de Meta** | Cuentas personales o importar el histórico completo | Ninguno. Pídelo en *Centro de cuentas → Tu información y permisos → Descargar tu información*, en formato **JSON** |
| **Capturas (IA)** | Publicaciones sueltas de cualquier cuenta | Clave de la API de Anthropic (unos céntimos por captura) |
| **Manual** | Siempre funciona | Ninguno: pegas el texto y añades las fotos |

Con las capturas, la IA (Claude) lee el texto y recorta las fotos de la captura. La calidad de la foto es la de la pantalla; si el texto termina en «… más», despliégalo antes de hacer la captura.

## 6. Uso
1. En **Configuración**, pega las claves, guarda y pulsa **Conectar** en cada tarjeta.
2. En **Publicaciones**, elige la página, marca Instagram y/o Facebook y pulsa **Cargar publicaciones**.
3. Selecciona una publicación (o varias, para hacer una entrada de resumen) y pulsa **Crear entrada**.
   Las imágenes se suben a la biblioteca de medios de WordPress en ese momento (las URLs de Meta caducan).
4. Revisa el título, las etiquetas (salen de los hashtags), la categoría y el contenido, y pulsa **Enviar a WordPress**.
   Por defecto se crea como **borrador** y se abre el editor de WordPress.com.

## Qué hace la conversión
- Primera frase → título; párrafos → bloques de párrafo; @menciones y URLs → enlaces.
- Hashtags → etiquetas de WordPress (se quitan del final del texto).
- Una imagen → bloque de imagen; carrusel → galería; vídeo/Reel → se incrusta la publicación original.
- Primera imagen → imagen destacada. Al final añade «Publicado originalmente en Instagram/Facebook».

## Estructura
| Archivo | Función |
|---|---|
| `main.js` | Proceso principal y comunicación con la interfaz |
| `src/meta.js` | Inicio de sesión y lectura de publicaciones en Graph API |
| `src/wpcom.js` | Inicio de sesión, subida de medios y creación de entradas en WordPress.com |
| `src/importers.js` | Importar ZIP de Meta, capturas con IA y entrada manual |
| `src/transform.js` | Publicación → bloques de Gutenberg |
| `src/oauth.js` | Inicio de sesión en el navegador del sistema (servidor local en el puerto 53682) |
| `src/updater.js` | Actualizaciones automáticas desde GitHub Releases |
| `src/store.js` | Configuración; los tokens se guardan cifrados con DPAPI de Windows |
| `renderer/` | Interfaz |

## Notas
- El token de Meta dura unos 60 días; cuando caduque, pulsa otra vez **Conectar con Facebook**.
- Si Meta deja obsoleta la versión de la API, cámbiala en *Configuración → Versión de Graph API*.

## Licencia
© 2026 Asociación Elín. **Todos los derechos reservados.** El código es visible, pero no se puede copiar, modificar ni redistribuir sin permiso. Ver [LICENSE](LICENSE).
