# Actualizar Electron

Procedimiento para subir de versión mayor de Electron (y lo que va ligado a él). Última actualización: Electron 33 → 45.3.2 (Node 24.22, Chromium 156, V8 15.6).

## 1. Elegir la versión

```bash
npm view electron dist-tags --json | grep -E '"(latest|[0-9]+-x-y)"'
npm view electron time --json | grep -E '"4[0-9]\.[0-9]+\.[0-9]+"'
```

- Se usa la línea estable más reciente (`latest`), con un parche que tenga **al menos 2-3 semanas** de antigüedad.
- En `package.json` se fija **exacta** (`"electron": "45.3.2"`, sin `^`) para que `npm ci` y la CI usen siempre la misma.
- Electron-builder: última estable (`26.x`) con al menos unas semanas. `electron-updater` se sube a la última 6.x.
- Dependencias nativas: `@lydell/node-pty` (terminal de desarrollo) trae binarios precompilados N-API por plataforma (`@lydell/node-pty-win32-x64`…), **no se recompila** para Electron; `ffmpeg-static` descarga un binario independiente de Electron. Solo hay que comprobar que arrancan (ver 4).

```bash
npm install --ignore-scripts --no-audit --no-fund
rm -rf node_modules/electron/dist node_modules/electron/path.txt
node node_modules/electron/install.js
node_modules/electron/dist/electron --version
```

## 2. Notas de cambios incompatibles

Leer https://www.electronjs.org/docs/latest/breaking-changes (o `docs/breaking-changes.md` en el repositorio de Electron) de **cada versión mayor** entre la anterior y la nueva, y buscar en `main.js`, `preload.js`, `src/` y `renderer/` cada API afectada:

```bash
grep -rnE "safeStorage|clipboard|BrowserView|registerFileProtocol|webUtils|desktopCapturer|setPermissionRequestHandler|console-message|capturePage|toBitmap|showOpenDialog|nativeImage|setWindowOpenHandler|protocol\.|net\.(request|fetch)|nodeIntegration|sandbox" main.js preload.js src renderer
```

Puntos de Ecos que dependen de Electron:

| Zona | Dónde | Qué vigilar |
| --- | --- | --- |
| Preload con sandbox | `preload.js`, `src/wpeditorbar-preload.js` | Solo pueden hacer `require('electron')` (desde 45 no hay `events`, `url`, `timers`, `Buffer`). |
| Ruta de archivos arrastrados | `preload.js` (`webUtils.getPathForFile`) | `File.path` no existe desde 32. |
| Portapapeles | `renderer/` | Solo `navigator.clipboard`; el módulo `clipboard` ya no está en el renderer (44). |
| Imágenes | `main.js`, `src/imgopt.js`, `src/dupes.js` | `toBitmap()` normaliza a sRGB desde 43 (afecta al hash de fotos duplicadas solo con perfiles de color); `capturePage` devuelve DIPs desde 46. |
| Cifrado de claves | `src/store.js` (`safeStorage`) | **Pendiente para Electron 46**: `isEncryptionAvailable/encryptString/decryptString` se eliminan; migrar a `isAsyncEncryptionAvailable/encryptStringAsync/decryptStringAsync` (los datos ya guardados se leen igual). Requiere que `store.js` pase a ser asíncrono. |
| Editor de WordPress | `src/wpeditorwin.js` | `WebContentsView` en partición propia, `setPermissionRequestHandler`, `will-prevent-unload`. Desde 46 los manejadores `unload` no se ejecutan en páginas http(s). |
| Diálogos | `main.js` | Sin `defaultPath`, los diálogos abren en Descargas (43). |
| Actualizador | `src/updater.js` | `electron-updater` 6.x con `electron-builder` 26.x. |
| Inicio de sesión de Google | `src/oauth.js`, `src/gphotos.js` | Servidor local en `localhost:53682`. |
| Arranque y modo seguro | `main.js`, `src/startup.js` | Banderas (`no-sandbox`…) y `startup.json`. |

## 3. Node y Chromium incluidos

Versiones: `ELECTRON_RUN_AS_NODE` no sirve; usar un script de Electron que imprima `process.versions`. Comprobar `fetch`/`undici`, `AbortSignal.timeout`, `structuredClone` y la CSP (la ventana debe cargar sin errores en consola). Las pruebas de `npm test` corren con el Node del sistema (22 en la CI), no con el de Electron.

## 4. Pruebas

```bash
npm install --ignore-scripts --no-audit --no-fund   # si faltan node_modules
npm test                                            # incluye test/startup.test.js y test/wpeditor-electron.test.js (Electron real con xvfb-run)
xvfb-run -a npm run test:ui
node test-wp/run.js --sim
xvfb-run -a node_modules/electron/dist/electron --no-sandbox scripts/wped-electron-check.js   # ventana del editor de WordPress
```

Arranque de la app real (usa `~/.config/Ecos-dev`; borrarlo después). La terminal se autocomprueba con `ECOS_SELFTEST_PTY=1`:

```bash
ECOS_SELFTEST_PTY=1 timeout 40 xvfb-run -a node_modules/electron/dist/electron --no-sandbox .
cat ~/.config/Ecos-dev/logs/ecos.log   # debe tener «Ventana cargada», «Autocomprobación terminal: OK» y ningún «ERROR FATAL»
rm -rf ~/.config/Ecos-dev
```

Captura de pantalla: un script que haga `require('<ruta>/main.js')` y, pasados unos segundos, `BrowserWindow.getAllWindows()[0].webContents.capturePage()` y guarde `img.toPNG()`.

Empaquetado (sin Windows, solo comprueba la configuración y que descarga/empaqueta):

```bash
npx electron-builder --win --x64 --dir --publish never -c.win.signAndEditExecutable=false -c.directories.output=/tmp/ecos-dist
```

(En Linux faltan `build/winhello.exe` y `build/ecos-wordpress.zip`, y los binarios de `node-pty` para Windows se instalan solo en Windows: avisos esperados.)

## 5. Qué revisar en la ejecución de GitHub (Windows)

`.github/workflows/build.yml`:

1. `npm ci` termina sin errores (nuevo `package-lock.json`) y `npm test` pasa en Windows.
2. «Compilar»: electron-builder 26 empaqueta NSIS y portable, firma (SignPath/Azure/certificado según configuración) y genera `latest.yml`. Las `asarUnpack` de `@lydell/node-pty*` y `ffmpeg-static` siguen siendo necesarias.
3. «Prueba de arranque en Windows»: sigue abierta tras 25 s, `ecos.log` con «Ventana cargada» y **«Autocomprobación terminal: OK»** (comprueba que node-pty/ConPTY funciona con el nuevo Electron), sin «ERROR FATAL».
4. Sin paso de reconstrucción de node-pty: usa binarios precompilados. Si en el futuro se cambiara a un `node-pty` que compile, añadir `electron-rebuild` antes de empaquetar.
5. Comprobar a mano en un Windows real: actualización desde la versión anterior (electron-updater), Windows Hello, inicio de sesión de Google, editor de WordPress, arrastrar archivos, y que el aviso de SmartScreen/firma no cambia.
6. Versiones de acciones (`actions/checkout@v4`, `setup-node@v4`, `upload-artifact@v4`, `softprops/action-gh-release@v2`): revisar si hay mayores nuevas y si avisan de la retirada de Node 20 en los ejecutores.
