# Cómo solicitar la firma de código gratuita de SignPath Foundation

> **Aviso de fiabilidad.** Esta guía está escrita **de memoria**, sin acceso a internet al redactarla. Los nombres de campos, las URL, los requisitos y la sintaxis del XML pueden haber cambiado. Todo lo marcado con **[VERIFICAR]** hay que comprobarlo en la documentación oficial antes de fiarse: <https://signpath.org> (programa para proyectos de código abierto) y <https://about.signpath.io/documentation> (manual de SignPath, en especial *Artifact configuration*, *Trusted build systems* y *GitHub Actions*).

## 1. Antes de pedirlo: lo que ya está preparado en el repositorio

- Licencia GPL-3.0-or-later (`LICENSE`, `NOTICE`) y repositorio público: <https://github.com/Perseo2499/ecos>.
- Política de firma y privacidad: [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) (inglés) y [politica-firma.md](politica-firma.md) (español), enlazadas desde el README. SignPath pide que el proyecto publique una página «Code signing policy» con el texto de atribución *Free code signing provided by SignPath.io, certificate by SignPath Foundation*, los roles y la política de privacidad **[VERIFICAR]**.
- Compilación reproducible desde GitHub Actions (`.github/workflows/build.yml`), con el paso de SignPath listo pero apagado hasta que existan sus secretos y variables.
- Condiciones habituales del programa que conviene cumplir **[VERIFICAR]**: licencia de código abierto aprobada por la OSI; sin software malicioso ni que cambie ajustes del sistema sin permiso; proyecto activo, documentado y ya publicado (no en fase de idea); compilación en un sistema de integración continua soportado (GitHub Actions lo es); no usar componentes propietarios sin licencia compatible; equipo con roles definidos y autenticación en dos pasos.

**Tareas tuyas antes de enviar el formulario**

1. Activa la **verificación en dos pasos (2FA)** en tu cuenta de GitHub (Settings → Password and authentication). Usa también 2FA cuando crees tu cuenta en SignPath.
2. Revisa que el repositorio tiene `LICENSE`, el `README.md` actualizado y al menos una versión publicada en Releases.
3. Si quieres poner otro nombre como titular (en lugar de «Perseo2499»), cámbialo en `LICENSE`/`NOTICE`, `package.json` (`author`, `build.copyright`) y en las políticas. SignPath firma a nombre de **SignPath Foundation** (el certificado es de la fundación, no tuyo): en el «Editor» de Windows saldrá «SignPath Foundation», no tu nombre.

## 2. Solicitar el programa

1. Entra en <https://signpath.org> y busca la opción para solicitar el programa para código abierto (suele ser «Apply» / «Get started»; la URL del formulario puede ser `https://signpath.org/apply`) **[VERIFICAR]**.
2. Datos que suelen pedir **[VERIFICAR]** (ten esto a mano):
   - **Nombre del proyecto:** Ecos
   - **URL del repositorio:** https://github.com/Perseo2499/ecos
   - **Licencia:** GPL-3.0-or-later (OSI-approved)
   - **Descripción:** aplicación de escritorio (Electron) para Windows que pasa publicaciones de Instagram y Facebook a un blog de WordPress y gestiona la web. Software libre; sin telemetría.
   - **Sitio web / página de descargas:** https://github.com/Perseo2499/ecos (Releases: https://github.com/Perseo2499/ecos/releases)
   - **Página de «Code signing policy»:** https://github.com/Perseo2499/ecos/blob/main/docs/CODE_SIGNING_POLICY.md
   - **Sistema de compilación (CI):** GitHub Actions, ejecutores alojados por GitHub (`windows-latest`)
   - **Tipo de archivos a firmar:** ejecutables de Windows (.exe): instalador NSIS y ejecutable portable, creados con electron-builder
   - **Equipo:** tú (Perseo2499) como autor/revisor y aprobador; cuenta de GitHub y correo de contacto
   - **Confirmaciones:** el proyecto no contiene malware ni cambia ajustes del sistema sin permiso; dependencias con licencias compatibles (ver `THIRD-PARTY-NOTICES.md`); 2FA activada
3. Espera la respuesta por correo. Puede tardar días o semanas, y pueden pedirte cambios (por ejemplo, ajustar la política de firma). Puede que pidan un proyecto con más historial o usuarios; si lo rechazan, la ruta alternativa del repositorio sigue siendo Azure Trusted Signing o un certificado propio (`docs/firma-windows.md`).

## 3. Cuando lo aprueben

Los nombres exactos de los menús pueden variar **[VERIFICAR]**.

### 3.1 En SignPath (<https://app.signpath.io>)
1. Entra en la organización que te asignen. Apunta el **Organization ID** (aparece en la URL y en *Organization → Details*).
2. **Proyecto**: crea (o usa el que ya hayan creado) un proyecto con *slug* **`ecos`**.
3. **Trusted build system**: enlaza GitHub.com (*Trusted build systems → GitHub.com*) y asocia el proyecto con el repositorio `Perseo2499/ecos`. SignPath comprobará que cada artefacto llega de ese repositorio y flujo.
4. **Artifact configuration** (slug sugerido: `initial`; puedes usar `ecos-exe`): crea una nueva con este XML. Describe el ZIP que genera la acción de GitHub y que contiene los dos `.exe`:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <!-- Instalador NSIS y ejecutable portable de Ecos -->
       <pe-file-set>
         <include path="Ecos-Setup-*.exe" max-matches="1" />
         <include path="Ecos-*-portable.exe" max-matches="1" />
         <for-each>
           <authenticode-sign />
         </for-each>
       </pe-file-set>
     </zip-file>
   </artifact-configuration>
   ```

   Notas **[VERIFICAR]**: (a) la sintaxis de `pe-file-set` (con `<for-each>` o con `<authenticode-sign/>` directamente dentro) cambia según la versión del esquema; usa el editor de SignPath, que valida el XML. (b) La «firma deep» de SignPath recorre los archivos dentro de contenedores soportados (ZIP, MSI, etc.); **no** abre el instalador NSIS ni el portable para firmar el `Ecos.exe` de su interior, así que solo se firman los dos `.exe` exteriores. (c) Si el flujo sube los `.exe` directamente (sin carpeta), GitHub los empaqueta en un ZIP: por eso la raíz es `<zip-file>`.
5. **Signing policy** con *slug* **`release-signing`**: elige el certificado de SignPath Foundation; marca *Require approval* y añade como aprobador tu usuario; restringe el origen a tu repositorio y, si la interfaz lo ofrece, a la rama `main` **[VERIFICAR]**. Haz lo mismo, si quieres, con una `test-signing` para pruebas con certificado de prueba.
6. **API token**: crea un *CI user* (usuario de CI) y genera su **API token** (*Users → CI user*); concédele permiso de *Submitter* en la política `release-signing`.

### 3.2 En GitHub (repositorio `Perseo2499/ecos` → Settings → Secrets and variables → Actions)

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | el token del usuario de CI |
| Variable | `SIGNPATH_ORGANIZATION_ID` | el Organization ID de SignPath |
| Variable | `SIGNPATH_PROJECT_SLUG` | `ecos` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | el slug de la *artifact configuration* (p. ej. `initial`) |

Con los cinco valores puestos, el flujo compila sin firmar, sube los `.exe` como artefacto, SignPath los firma (te llegará una petición de aprobación: apruébala en SignPath), se sustituyen en `dist/`, se regeneran `latest.yml` (sha512 y tamaño) y el `.blockmap`, se comprueba que las firmas son válidas y se publica el Release. Si falta cualquiera de los cinco, todo sigue como antes (Azure, certificado propio o sin firmar).

### 3.3 Primera prueba
1. Ejecuta el flujo a mano (*Actions → Compilar para Windows → Run workflow*). Aprueba la petición en SignPath.
2. Descarga el instalador del Release, comprueba en *Propiedades → Firmas digitales* que sale «SignPath Foundation» y que Ecos se instala y se actualiza solo desde la versión anterior (la actualización automática verifica el hash de `latest.yml`).
3. Añade al README (ya está) la frase de atribución y mantén la política de firma pública.

## 4. Qué NO he podido comprobar al prepararlo

- Ninguna petición real a SignPath: ni el XML de la configuración de artefacto, ni la acción `signpath/github-action-submit-signing-request@v1` (nombres de entradas `github-artifact-id`, `wait-for-completion`, `output-artifact-directory`; si la versión `@v1` no existe, usa la que indique su README) ni los permisos del flujo (`actions: read`) se han ejecutado.
- Que la acción deje los archivos firmados sueltos o dentro de un ZIP: el flujo admite ambos casos, pero no está probado.
- La regeneración del `.blockmap` con `app-builder-bin` y de `latest.yml` solo se ha probado en Linux (con un archivo de prueba y con pruebas automáticas del script). Si el `.blockmap` fallara en Windows, el flujo lo borra (la descarga diferencial se desactiva y se baja el instalador entero; es seguro).
- El `Ecos.exe` interior del instalador y del portable queda sin firmar (SignPath firma los contenedores exteriores). Windows SmartScreen valora sobre todo el exterior, pero algunos antivirus pueden avisar del interior.
