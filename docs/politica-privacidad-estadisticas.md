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
