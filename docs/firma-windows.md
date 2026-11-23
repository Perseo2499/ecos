# Firma de código de Ecos en Windows

Ecos se publica sin firmar, así que Windows SmartScreen avisa al instalarlo. Firmar el instalador quita el aviso de «editor desconocido» (con certificados de Azure Trusted Signing, la reputación llega de inmediato). El workflow `.github/workflows/build.yml` ya está preparado: **firma solo si encuentra los secretos y variables de abajo**; si no, compila como hasta ahora (con `WIN_CSC_LINK` si existe, o sin firmar).

## Opción recomendada: Azure Trusted Signing (Artifact Signing)

### 1. Cuenta de Azure
1. Entra en <https://portal.azure.com> con una cuenta de la asociación (mejor un correo de la entidad que uno personal) y crea una suscripción de pago por uso (hace falta tarjeta; no hay cuota fija de Azure).
2. Crea un grupo de recursos, por ejemplo `ecos-firma`.

### 2. Recurso Trusted Signing
1. En el portal busca «Trusted Signing Accounts» (también aparece como «Artifact Signing») → Crear.
2. Elige grupo de recursos, un **nombre de cuenta** (será `AZURE_SIGNING_ACCOUNT`) y una región. La región fija la dirección del servicio (`endpoint`):
   - Este de EE. UU.: `https://eus.codesigning.azure.net`
   - Oeste de EE. UU. 2: `https://wus2.codesigning.azure.net`
   - Europa Occidental: `https://weu.codesigning.azure.net`
   - Norte de Europa: `https://neu.codesigning.azure.net`
3. Plan Basic (suficiente).

### 3. Validación de identidad de la organización
1. Dentro de la cuenta: «Identity validations» → Nueva → **Organización** (public trust).
2. Datos que piden: nombre legal exacto de la asociación, país, dirección, **CIF**, sitio web y correo corporativo. Para una asociación española prepara: certificado de inscripción en el Registro de Asociaciones, tarjeta/certificado del CIF (NIF de la entidad), estatutos y el DNI/identificación del representante legal. El nombre debe coincidir letra por letra con los documentos.
3. La validación la hace Microsoft (con un proveedor externo) y puede tardar de unos días a un par de semanas. Hay que ser el representante o tener autorización de la entidad. Nota: Microsoft limita este servicio a organizaciones con una antigüedad mínima de unos 3 años (comprueba las condiciones vigentes en su documentación); si no se cumple, usa la alternativa del final.
4. Cuando se apruebe, el nombre validado es el **publisher** (`AZURE_SIGNING_PUBLISHER`): copia el «Subject» exacto, p. ej. `CN=Asociación Elín, O=Asociación Elín, L=..., C=ES`... En electron-builder basta el nombre de organización que aparece en el certificado (`publisherName`).

### 4. Perfil de certificado público
En la cuenta: «Certificate profiles» → Crear → tipo **Public Trust** → elige la validación de identidad aprobada. El nombre del perfil será `AZURE_SIGNING_PROFILE`.

### 5. Registro de aplicación en Microsoft Entra ID
1. Portal Azure → Microsoft Entra ID → «Registros de aplicaciones» → Nuevo registro (`ecos-github-firma`).
2. Anota **Id. de aplicación (cliente)** → `AZURE_CLIENT_ID` y **Id. de directorio (inquilino)** → `AZURE_TENANT_ID`.
3. «Certificados y secretos» → Nuevo secreto de cliente (caduca como máximo en 24 meses: apunta la fecha para renovarlo). Copia el **valor** (solo se ve una vez) → `AZURE_CLIENT_SECRET`.

### 6. Permiso para firmar
En la cuenta de Trusted Signing (o en el perfil de certificado) → «Control de acceso (IAM)» → Agregar asignación de roles → rol **«Trusted Signing Certificate Profile Signer»** (en el portal puede llamarse «Artifact Signing Certificate Profile Signer») → asignarlo a la aplicación registrada en el paso 5.

### 7. Secretos y variables en GitHub
Repositorio `Perseo2499/ecos` → Settings → Secrets and variables → Actions.

**Secrets** (pestaña Secrets):

| Nombre | Valor |
|---|---|
| `AZURE_TENANT_ID` | Id. de directorio (inquilino) |
| `AZURE_CLIENT_ID` | Id. de aplicación (cliente) |
| `AZURE_CLIENT_SECRET` | Valor del secreto de cliente |

**Variables** (pestaña Variables, no son secretas):

| Nombre | Ejemplo |
|---|---|
| `AZURE_SIGNING_ENDPOINT` | `https://weu.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | nombre de la cuenta de Trusted Signing |
| `AZURE_SIGNING_PROFILE` | nombre del perfil de certificado |
| `AZURE_SIGNING_PUBLISHER` | nombre de la organización validada, tal cual figura en el certificado |

Con las siete cosas puestas, el siguiente build muestra «Firmando con Azure Trusted Signing» y electron-builder pasa `win.azureSignOptions` (`publisherName`, `endpoint`, `codeSigningAccountName`, `certificateProfileName`) por línea de comandos; sin ellas esa configuración no se activa. Si falta cualquiera, no se firma con Azure.

Los certificados de Trusted Signing duran solo unos días y se firman con sello de tiempo, así que lo firmado sigue siendo válido después.

### Costes aproximados
- Trusted Signing, plan Basic: unos **9,99 USD al mes** (5.000 firmas incluidas; Ecos usa unas pocas por versión). Precios orientativos; confirma en la calculadora de Azure.
- Entra ID y el registro de la aplicación: gratis. Validación de identidad: sin coste adicional.

## Alternativa: certificado OV tradicional
Si Trusted Signing no está disponible para la asociación:
1. Compra un certificado de firma de código **OV** (Sectigo, DigiCert, SSL.com…; unos 70–400 € al año). Desde 2023 las claves se entregan en un token/HSM, lo que complica usarlas en GitHub Actions; algunos proveedores ofrecen firma en la nube o archivos `.pfx` exportables (consulta antes de comprar). Los OV no quitan el aviso de SmartScreen de inmediato: la reputación se gana con descargas.
2. Convierte el `.pfx` a base64 (`certutil -encode cert.pfx cert.b64` o `base64 -w0 cert.pfx`).
3. En GitHub, Secrets: `WIN_CSC_LINK` (el contenido base64) y `WIN_CSC_KEY_PASSWORD` (su contraseña). El workflow los usa solo si Azure no está completo.

## Cómo comprobar que quedó firmado
Tras el build, en Windows: clic derecho sobre `Ecos-Setup-x.y.z.exe` → Propiedades → «Firmas digitales», o `Get-AuthenticodeSignature .\Ecos-Setup-x.y.z.exe` en PowerShell (debe decir `Valid`).
