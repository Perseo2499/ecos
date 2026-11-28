# Plan: Ecos para Android (aparcado)

Estado: **aparcado** por decisión de quien mantiene Ecos (noviembre de 2026). No corre prisa; este documento guarda el plan para retomarlo.

## Idea

No se traslada la app de escritorio tal cual: se hace una versión **«compañera»** con lo más útil en el móvil, reutilizando la interfaz web de Ecos (`renderer/`) y sustituyendo la parte que hoy hace Electron/Node (`main.js`, `src/`).

## Qué se reutiliza

- La interfaz (HTML, CSS y JavaScript del renderer), adaptada a pantallas táctiles y estrechas (ya existe la adaptación por tamaño de ventana).
- La lógica pura que no depende de Node: composición y lectura de bloques (`src/transform.js`, `src/parseblocks.js`), revisión de accesibilidad, SEO, línea temporal, etc.

## Qué hay que rehacer o cambiar

| Parte | En escritorio | En Android |
|---|---|---|
| Puente con el sistema | Electron (`preload.js`, IPC) | Capacitor (WebView + plugins nativos) |
| WordPress, Meta, Google | `fetch` desde Node | `fetch` / plugin HTTP nativo (CORS) |
| Datos cifrados | `safeStorage` | Android Keystore (plugin de almacenamiento seguro) |
| IA | API y CLI (Claude Code, Codex, Gemini CLI) | Solo IA por clave de API (las CLI no existen en el móvil) |
| Vídeo (ffmpeg) y «Mejorar con IA» | Binarios locales | Fuera de la primera versión (o servicio aparte) |
| Editor de WordPress integrado | Ventana de Electron | Navegador integrado (Custom Tabs) |
| Terminal de desarrollo, copias de emergencia completas | Sí | No |

## Primera versión (alcance)

1. Conectar WordPress (contraseña de aplicación) y Meta.
2. Ver publicaciones de redes y pasarlas al blog (borrador).
3. Editar textos y fotos de entradas con el editor de bloques (versión táctil).
4. Revisar y aprobar entradas pendientes, con notas.
5. Agenda y avisos (notificaciones push locales).

## Esfuerzo estimado

Varias semanas de trabajo más la publicación en Google Play (cuenta de desarrollador, ficha, política de privacidad, firma de la app).
