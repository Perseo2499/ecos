# Avisos de software de terceros / Third-party notices

Ecos es software libre bajo la licencia [GPL-3.0-or-later](LICENSE) (© 2026 Perseo2499). Incluye los componentes de terceros de abajo, cada uno con su propia licencia.
Este archivo lo genera `node scripts/third-party.js` a partir de `package-lock.json`; no lo edites a mano.

## Componentes destacados

### FFmpeg (mediante `ffmpeg-static`)

- Ecos incluye un ejecutable de **FFmpeg** (paquete npm `ffmpeg-static` 5.3.0, publicación de binarios `b6.1.1`, FFmpeg 6.1.1) para recomprimir vídeos y convertir imágenes a WebP. Se ejecuta como programa aparte (no se enlaza con el código de Ecos).
- Licencia del binario: **GPL-3.0-or-later** (las compilaciones de Windows de gyan.dev usadas por `ffmpeg-static` se construyen con `--enable-gpl --enable-version3`). El paquete `ffmpeg-static` también es GPL-3.0-or-later.
- **Código fuente de FFmpeg**: <https://ffmpeg.org/download.html> (repositorio: <https://git.ffmpeg.org/ffmpeg.git>; etiqueta de la versión 6.1.1: `n6.1.1`). Texto de la licencia: <https://www.gnu.org/licenses/gpl-3.0.html>.
- Origen de los binarios: <https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1> (Windows x64 de <https://www.gyan.dev/ffmpeg/builds/>; sus scripts de compilación y opciones están en esa web). Si necesitas el código fuente exacto del binario incluido, pídelo abriendo una incidencia en <https://github.com/Perseo2499/ecos/issues> o consúltalo en los enlaces anteriores.
- FFmpeg es una marca registrada de Fabrice Bellard. Los derechos de autor de FFmpeg pertenecen a sus autores (<https://ffmpeg.org/legal.html>).

### Electron y Chromium

- Ecos se ejecuta sobre **Electron** 45.3.2 (<https://www.electronjs.org>, licencia MIT, © GitHub Inc. y colaboradores), que incluye **Chromium** y **Node.js**.
- Chromium incluye numerosos componentes con licencias BSD, MIT, Apache-2.0, MPL, LGPL y otras. Sus avisos completos están en los archivos `LICENSE` y `LICENSES.chromium.html` que acompañan a Electron en la carpeta de instalación de Ecos (y en <https://github.com/electron/electron/blob/main/LICENSE>).
- Código fuente: Electron <https://github.com/electron/electron>, Chromium <https://chromium.googlesource.com/chromium/src>, Node.js <https://github.com/nodejs/node>.

### Otros componentes incluidos

- **Real-ESRGAN ncnn Vulkan** (mejora de fotos con IA): <https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan> (licencia MIT). No forma parte del instalador: Ecos lo descarga de ese repositorio solo si el usuario activa «mejorar fotos con IA».

## Dependencias de producción (npm)

Total: 79 paquetes empaquetados en Windows x64. «Directa» = declarada en `package.json`.

| Paquete | Versión | Licencia | Directa |
|---|---|---|---|
| @anthropic-ai/sdk | 1.10.0 | Apache-2.0 | sí |
| @babel/runtime | 7.29.14 | MIT |  |
| @derhuerst/http-basic | 8.2.4 | MIT |  |
| @lydell/node-pty | 1.2.0-beta.18 | MIT | sí |
| @lydell/node-pty-win32-x64 | 1.2.0-beta.18 | MIT |  |
| @opentelemetry/api | 1.10.0 | Apache-2.0 |  |
| @stablelib/base64 | 1.0.1 | MIT |  |
| @types/node | 10.17.60 | MIT |  |
| @xterm/addon-fit | 0.11.0 | MIT | sí |
| @xterm/xterm | 6.0.0 | MIT | sí |
| adm-zip | 0.5.18 | MIT | sí |
| agent-base | 6.0.2 | MIT |  |
| ansi-regex | 5.0.1 | MIT |  |
| ansi-styles | 4.3.0 | MIT |  |
| argparse | 2.0.1 | Python-2.0 |  |
| buffer-from | 1.1.2 | MIT |  |
| builder-util-runtime | 9.7.0 | MIT |  |
| camelcase | 5.3.1 | MIT |  |
| caseless | 0.12.0 | Apache-2.0 |  |
| cliui | 6.0.0 | ISC |  |
| color-convert | 2.0.1 | MIT |  |
| color-name | 1.1.4 | MIT |  |
| concat-stream | 2.0.0 | MIT |  |
| debug | 4.4.3 | MIT |  |
| decamelize | 1.2.0 | MIT |  |
| dijkstrajs | 1.0.3 | MIT |  |
| electron-updater | 6.8.11 | MIT | sí |
| emoji-regex | 8.0.0 | MIT |  |
| env-paths | 2.2.1 | MIT |  |
| fast-sha256 | 1.3.0 | Unlicense |  |
| ffmpeg-static | 5.3.0 | GPL-3.0-or-later | sí |
| find-up | 4.1.0 | MIT |  |
| fs-extra | 10.1.0 | MIT |  |
| get-caller-file | 2.0.5 | ISC |  |
| graceful-fs | 4.2.12 | BlueOak-1.0.0 |  |
| http-response-object | 3.0.2 | MIT |  |
| https-proxy-agent | 5.0.1 | MIT |  |
| inherits | 2.0.4 | ISC |  |
| is-fullwidth-code-point | 3.0.0 | MIT |  |
| js-yaml | 4.3.2 | MIT |  |
| json-schema-to-ts | 3.1.1 | MIT |  |
| jsonfile | 6.2.1 | MIT |  |
| lazy-val | 1.0.5 | MIT |  |
| locate-path | 5.0.0 | MIT |  |
| lodash.escaperegexp | 4.1.2 | MIT |  |
| lodash.isequal | 4.5.0 | MIT |  |
| ms | 2.1.3 | MIT |  |
| p-limit | 2.3.0 | MIT |  |
| p-locate | 4.1.0 | MIT |  |
| p-try | 2.2.0 | MIT |  |
| parse-cache-control | 1.0.1 | BSD-3-Clause (declarada como «BSD»; revisado el LICENSE) |  |
| path-exists | 4.0.0 | MIT |  |
| pend | 1.2.0 | MIT |  |
| pngjs | 5.0.0 | MIT |  |
| progress | 2.0.3 | MIT |  |
| qrcode | 1.5.4 | MIT | sí |
| readable-stream | 3.6.2 | MIT |  |
| require-directory | 2.1.1 | MIT |  |
| require-main-filename | 2.0.0 | ISC |  |
| safe-buffer | 5.2.1 | MIT |  |
| sax | 1.6.1 | BlueOak-1.0.0 |  |
| semver | 7.7.4 | ISC |  |
| set-blocking | 2.0.0 | ISC |  |
| standardwebhooks | 1.3.0 | MIT |  |
| string_decoder | 1.3.0 | MIT |  |
| string-width | 4.2.3 | MIT |  |
| strip-ansi | 6.0.1 | MIT |  |
| tiny-typed-emitter | 2.1.0 | MIT |  |
| ts-algebra | 2.0.0 | MIT |  |
| typedarray | 0.0.6 | MIT |  |
| universalify | 2.0.1 | MIT |  |
| util-deprecate | 1.0.2 | MIT |  |
| which-module | 2.0.1 | ISC |  |
| wrap-ansi | 6.2.0 | MIT |  |
| y18n | 4.0.3 | ISC |  |
| yargs | 15.4.1 | MIT |  |
| yargs-parser | 18.1.3 | ISC |  |
| yauzl | 3.4.0 | MIT | sí |
| zod | 4.6.7 | MIT | sí |

## Compatibilidad con GPL-3.0

Todas las licencias anteriores (MIT, ISC, BSD, Apache-2.0, GPL, etc.) son compatibles con su distribución junto a un programa GPL-3.0-or-later. Apache-2.0 es compatible con GPL-3.0 (no con GPL-2.0).
