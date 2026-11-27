# Pruebas de interfaz automáticas

`npm run test:ui` abre `renderer/index.html` en Chromium (Playwright) con un `window.api` simulado y recorre la interfaz.
Cada archivo de `test-ui/*.test.js` se ejecuta con `node --test`.

| Archivo | Qué cubre |
| --- | --- |
| `tour.test.js` | Recorrido por todas las pestañas y el editor; pantalla de arranque (vinilo y claro) |
| `patterns.test.js` | Patrones de la web, bloques sincronizados, plantillas propias (claro y vinilo) |
| `a11y.test.js` | Revisión de accesibilidad: panel, arreglos automáticos, aviso antes de publicar |
| `blocks-ui.test.js` | Inserta los 13 «Más bloques» en el editor, edita datos, estilo e iconos (claro, oscuro, vinilo) |
| `blocks-web.test.js` | HTML de salida de esos bloques cargado como página: pestañas, preguntas, puntos, comparador, donación, evento, contador, sin JS, móvil |
| `timeline.test.js` | Línea temporal de Publicaciones y Blog |
| `changelog.test.js` | Novedades por versión: diálogo, historial, filtros, inglés |
| `detail.test.js` | Publicaciones en modo Detalle y Cuadrícula |

- **Mock compartido**: `test-ui/mock-api.js` → `installMock(page, { theme, config, version, lang, patch })`. `patch(api, H)` se ejecuta dentro de la página
  para cambiar o añadir métodos. Los métodos no definidos devuelven `{}` y los `onXxx` no hacen nada.
- **Playwright**: la dependencia de desarrollo `playwright`; si no está instalada se usa el global (`/opt/node-tools`, o `PLAYWRIGHT_MODULE=ruta`).
  La primera vez: `npx playwright install chromium`.
- **Capturas**: no se guardan por defecto. `ECOS_UI_SHOTS=/ruta/capturas npm run test:ui` las guarda (en GitHub, solo se suben si algo falla).
- `ECOS_UI_VERBOSE=1` muestra cada comprobación; un solo archivo: `node --test test-ui/detail.test.js`.
- Las comprobaciones «blandas» (`check`) se acumulan y el fallo lista todas las que no se cumplieron.
