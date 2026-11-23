# Política de firma de código

Ecos es una aplicación de escritorio libre y de código abierto (GPL-3.0-or-later) para pasar publicaciones de Instagram y Facebook a un blog de WordPress y gestionar la web.
Código fuente: <https://github.com/Perseo2499/ecos> · Versión en inglés (la que se presenta a SignPath): [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)

## Atribución

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).
(Firma de código gratuita proporcionada por SignPath.io; certificado de SignPath Foundation.)

Las versiones de Windows de Ecos publicadas en <https://github.com/Perseo2499/ecos/releases> se firman con un certificado emitido por SignPath Foundation, una vez que el proyecto sea aceptado en el programa. Las versiones anteriores no están firmadas, y lo que compiles tú mismo nunca se firma con ese certificado.

## Qué se firma

Solo los binarios de Windows generados por la compilación oficial de este repositorio:

- `Ecos-Setup-<versión>.exe` (instalador NSIS) y el `Ecos.exe` de su interior.
- `Ecos-<versión>-portable.exe` (versión portable).

Los binarios de terceros incluidos (por ejemplo FFmpeg) no los vuelve a firmar este proyecto, salvo los que formen parte del contenedor firmado según la configuración de artefacto de SignPath.

## Roles

| Rol | Quién |
|---|---|
| Committers y revisores | [Perseo2499](https://github.com/Perseo2499) (y quien contribuya con cambios revisados y fusionados por Perseo2499) |
| Aprobadores (aprueban cada solicitud de firma) | [Perseo2499](https://github.com/Perseo2499) |

Las contribuciones externas las revisa un committer antes de fusionarlas. Cada solicitud de firma necesita aprobación manual de un aprobador. Todos los miembros usan autenticación multifactor en GitHub y SignPath.

## Proceso de compilación y publicación

- Toda versión firmada se construye desde este repositorio, en ejecutores de GitHub, con el flujo de GitHub Actions [`.github/workflows/build.yml`](../.github/workflows/build.yml). Ningún binario firmado se compila ni se sube a mano.
- El flujo compila con `electron-builder` (sin firmar), sube los ejecutables como artefacto de Actions y los envía a SignPath con la acción oficial `signpath/github-action-submit-signing-request`. SignPath comprueba que el artefacto procede de este repositorio y de esa ejecución, y lo firma tras la aprobación.
- Los archivos firmados sustituyen a los sin firmar; los metadatos de actualización (`latest.yml`) se regeneran con el hash y el tamaño del instalador firmado, y se publica la versión en GitHub Releases.
- El número de versión está en `package.json` y cada versión lleva la etiqueta `v<versión>`.

## Compromisos

- Este proyecto no incluye software malicioso ni programas potencialmente no deseados, y no cambia ajustes del sistema (registro, seguridad, inicio automático y similares) sin permiso del usuario. El instalador solo instala Ecos y sus accesos directos; la app solo guarda sus propios datos en el perfil del usuario.
- Ecos se publica con una licencia de código abierto aprobada por la OSI (GPL-3.0-or-later). Sus dependencias y licencias están en [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
- Las claves de firma las custodia SignPath; el proyecto nunca tiene acceso a la clave privada.
- Si se descubre que una versión firmada es maliciosa o está comprometida, se avisará a SignPath Foundation, se retirará la versión y se publicará una corregida.

## Política de privacidad

Ecos no recopila, guarda ni envía datos personales a sus desarrolladores. No tiene telemetría, ni analítica, ni servicio de informes de fallos.

La app solo se comunica con los servicios que **tú** conectas o decides usar, y solo para hacer lo que le pides:

| Servicio | Cuándo | Qué se envía |
|---|---|---|
| Tu WordPress (propio o WordPress.com) | Al conectarlo, leer, publicar o gestionar la web | Tu token o credencial de acceso, entradas, páginas, imágenes y ajustes con los que trabajas |
| Meta (Instagram / Facebook, Graph API) | Al conectar tu cuenta e importar o compartir publicaciones | El token de autorización y las peticiones necesarias para leer tus publicaciones (y publicar un compartido, si lo activas) |
| Google Fotos (Picker API) | Si importas fotos desde allí | El token de autorización y las peticiones de selección |
| El proveedor de IA que elijas (por ejemplo Anthropic, OpenAI, Google o un servicio compatible local/propio) | Solo si activas las funciones de IA y pegas tu propia clave | El texto o las imágenes que le pides procesar y tu propia clave |
| GitHub (github.com) | Para buscar versiones nuevas de Ecos y descargarlas | Una petición HTTPS normal para los metadatos y el instalador; GitHub ve tu IP como en cualquier petición web |
| Release de Real-ESRGAN en GitHub | Solo si activas la mejora de fotos local | La descarga del motor; el procesamiento se hace en tu ordenador |

Las credenciales y claves se guardan en tu ordenador, en la carpeta de datos de la app, protegidas con el almacén seguro del sistema cuando está disponible. El registro de errores se queda en tu ordenador y no contiene contraseñas ni claves; solo se comparte si tú lo copias y lo envías.

Ecos no envía nada a los desarrolladores. Los servicios de terceros tienen sus propias políticas de privacidad, que se aplican a los datos que les envías.

## Contacto y avisos

Abre una incidencia en <https://github.com/Perseo2499/ecos/issues> para dudas, avisos de abuso o problemas de seguridad.
