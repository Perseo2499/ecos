// Ecos · Errores técnicos en español. friendlyError(e) traduce los mensajes típicos de JavaScript, de red y de
// WordPress a frases claras; el texto original queda como «detalle» (se enseña en un <details> o va al registro).
// Los mensajes que ya están en español se dejan tal cual. (Sirve en la app y en las pruebas.)
(function (root) {
  const RETRY = ' Prueba a reintentarlo; si sigue igual, reinicia Ecos.';
  // [patrón, frase]
  const RULES = [
    [/cannot (?:read|set) propert(?:y|ies) of (?:undefined|null)|undefined is not an object|null is not an object|is not a function|is not iterable|is not defined|is undefined|is null|not a constructor|Cannot destructure|reading '[^']*'/i,
      'Ecos ha recibido datos incompletos y no ha podido mostrar esta parte.' + RETRY],
    [/Unexpected token|Unexpected end of JSON|JSON\.parse|is not valid JSON|SyntaxError/i, 'La respuesta de la web no tiene el formato esperado. ¿Es correcta la dirección de WordPress?'],
    [/ECONNREFUSED|connection refused/i, 'La web ha rechazado la conexión. Puede estar caída un momento; vuelve a intentarlo en unos minutos.'],
    [/ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out|timeout|UND_ERR_CONNECT_TIMEOUT|net::ERR_TIMED_OUT/i, 'La web ha tardado demasiado en responder. Comprueba tu conexión a internet y vuelve a intentarlo.'],
    [/ENOTFOUND|EAI_AGAIN|getaddrinfo|net::ERR_NAME_NOT_RESOLVED/i, 'No se encuentra esa dirección en internet. Revisa que esté bien escrita y que tengas conexión.'],
    [/ECONNRESET|socket hang up|EPIPE|net::ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/i, 'Se ha cortado la conexión a mitad de camino. Vuelve a intentarlo.'],
    [/Failed to fetch|NetworkError|Network request failed|Load failed|net::ERR_|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|fetch failed|certificate|CERT_|SSL/i, 'No se ha podido conectar. Comprueba tu conexión a internet y vuelve a intentarlo.'],
    [/\b401\b|Unauthorized|rest_not_logged_in|incorrect_password|invalid_username|invalid_email/i, 'WordPress no acepta el usuario o la contraseña de aplicación. Revísalos en Conexiones.'],
    [/\b403\b|Forbidden|rest_forbidden|not allowed to|no tienes permiso/i, 'WordPress dice que este usuario no tiene permiso para hacer esto. Prueba con un usuario administrador o editor.'],
    [/\b404\b|Not Found|rest_no_route|rest_post_invalid_id|no route was found/i, 'WordPress no ha encontrado lo que se pedía (puede que ya no exista o que la dirección no sea la correcta).'],
    [/\b429\b|Too Many Requests/i, 'La web recibe demasiadas peticiones seguidas. Espera un minuto y vuelve a intentarlo.'],
    [/\b(?:500|502|503|504)\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out|critical error/i, 'La web ha tenido un problema interno. Suele pasar un momento; vuelve a intentarlo en unos minutos.'],
    [/ENOENT|no such file/i, 'No se encuentra un archivo que Ecos necesitaba. Comprueba que no lo hayas movido o borrado.'],
    [/EACCES|EPERM|permission denied/i, 'Ecos no tiene permiso para usar ese archivo o carpeta.'],
    [/ENOSPC/i, 'No queda espacio en el disco.'],
  ];
  const ENGLISH = /\b(the|is|of|not|you|your|sorry|error|failed|invalid|undefined|cannot|unexpected)\b/i;

  function rawText(e) {
    if (e == null) return '';
    let s = typeof e === 'string' ? e : (e.message != null ? String(e.message) : String(e));
    s = s.replace(/^Error invoking remote method '[^']*':\s*/i, '').replace(/^(?:Type|Reference|Syntax|Range)?Error:\s*/, '');
    return s.trim();
  }
  // → { text, detail, translated }. detail = mensaje original (solo si se ha traducido).
  function friendlyError(e) {
    const raw = rawText(e);
    if (!raw) return { text: 'Ha ocurrido un error inesperado.', detail: '', translated: true };
    const strip = raw.replace(/^WordPress:\s*/i, '');
    // Ya está en español (tiene letras o signos propios del castellano y ninguna palabra técnica inglesa)
    if (/[áéíóúñ¿¡«»]|\b(no|se|el|la|de|con|una?|que|puede|escribe|elige|esta|ha)\b/i.test(strip) && !ENGLISH.test(strip.replace(/\(wp-json\)/, ''))) {
      // …salvo si lleva un código de red o de estado muy claro
      if (!/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/.test(raw)) return { text: raw, detail: '', translated: false };
    }
    for (const [re, msg] of RULES) if (re.test(raw)) return { text: msg, detail: raw, translated: true };
    if (/^[\x20-\x7E]+$/.test(raw) && ENGLISH.test(raw)) return { text: 'Ha ocurrido un problema técnico.' + RETRY, detail: raw, translated: true };
    return { text: raw, detail: '', translated: false };
  }
  // ¿Es un mensaje técnico suelto (sin una frase en español)? Los mensajes mezclados se traducen donde se generan.
  const looksTechnical = (s) => { s = String(s || ''); return !/[áéíóúñ¿¡«»]|\b(no|se|el|la|de|con|una?|que|puede|escribe|elige|esta|ha)\b/i.test(s) && (RULES.some(([re]) => re.test(s)) || (/^[\x20-\x7E]+$/.test(s) && ENGLISH.test(s))); };
  const friendlyText = (e) => friendlyError(e).text;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // HTML para pantallas con error: frase + <details> con el original (el título del <summary> lo traduce quien llama)
  function errorHtml(e, detailLabel) {
    const f = friendlyError(e);
    return `<span class="err-msg">${esc(f.text)}</span>` + (f.detail ? `<details class="err-detail"><summary>${esc(detailLabel || 'Detalle técnico')}</summary><code>${esc(f.detail)}</code></details>` : '');
  }
  const api = { friendlyError, friendlyText, errorHtml, looksTechnical };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FriendlyError = api;
})(typeof window !== 'undefined' ? window : globalThis);
