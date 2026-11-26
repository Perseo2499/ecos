# Nota para la Política de privacidad: estadísticas de visitas

El Complemento de Ecos (v1.1 o posterior) cuenta las visitas **sin usar cookies** y **sin guardar datos personales**. Por eso no hace falta añadir nada a la Política de cookies ni un aviso de consentimiento por este contador. Sí conviene mencionarlo en la Política de privacidad. Texto para copiar y pegar:

---

**Estadísticas de visitas**

Para saber qué contenidos interesan más, esta web cuenta cuántas veces se visita cada página o entrada. Lo hacemos con un contador propio, alojado en nuestro propio WordPress, que **no utiliza cookies** ni ningún otro identificador en tu dispositivo. Solo se guarda un número total de visitas por página y por día. **No se almacena tu dirección IP, tu navegador ni ningún dato que permita identificarte**, no se elaboran perfiles ni se comparte información con terceros. Estos datos agregados son anónimos, por lo que no se consideran datos personales.

---

## Detalles técnicos (por si alguien los pregunta)

- Se guarda en la tabla `{prefijo}ecos_views`: `post_id`, `day` y `views`. Nada más.
- Para evitar abusos, el servidor guarda temporalmente (máximo 30 minutos) un resumen irreversible (hash con la clave secreta del sitio) de la conexión, solo para limitar el número de avisos. No se conserva la IP ni se puede obtener a partir de él.
- El navegador recuerda, solo mientras la pestaña está abierta (`sessionStorage`), que ya avisó de esa página, para no contarla dos veces en 30 minutos. No es una cookie y no sale del dispositivo.
- No se cuentan los robots, las precargas ni las visitas de quienes tienen sesión iniciada con permiso para editar.
- Al desinstalar el complemento se borran la tabla y los ajustes.

---

# Nota para la Política de privacidad: fuentes de Google (opcional)

El editor de Ecos permite elegir, para cualquier bloque, una de unas veinte **fuentes de Google Fonts** (Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, Raleway, Merriweather, Playfair Display, Lora, Source Serif, Work Sans, Rubik, Karla, DM Sans, Quicksand, Oswald, Bebas Neue y Caveat). **Esto es opcional: si no eliges ninguna, no se conecta con Google.**

**Aviso importante: Google Fonts conecta con Google.** Cuando una entrada o página usa una de esas fuentes:

- **En tu web**, el Complemento de Ecos (v1.4 o posterior) carga la hoja de estilos desde `fonts.googleapis.com` (y los archivos de la fuente desde `fonts.gstatic.com`) **solo en las entradas y páginas que usan una fuente de Google**, y solo las familias usadas en esa entrada. El navegador de quien visita la web se conecta entonces con los servidores de Google, que pueden recibir su dirección IP y datos técnicos del navegador. Si no quieres esa conexión, no elijas fuentes de Google (la fuente «La de tu web» no la produce).
- **En el editor de Ecos**, la aplicación enlaza esa misma hoja de estilos de Google solo mientras hay un bloque con una fuente de Google en la entrada abierta. Sin conexión a internet, el editor y la web usan la fuente del sistema.

Si tu web usa fuentes de Google, conviene mencionarlo en la Política de privacidad (y en la de cookies, si la tienes). Texto para copiar y pegar:

---

**Fuentes de Google**

Algunas páginas de esta web usan tipos de letra de Google Fonts. Para mostrarlos, tu navegador se conecta con los servidores de Google (fonts.googleapis.com y fonts.gstatic.com), que pueden recibir tu dirección IP y datos técnicos de tu navegador. Más información en la política de privacidad de Google.

---
