# Bloques de Spectra, Kadence Blocks y GenerateBlocks en Ecos

Ecos edita los bloques más usados de estos tres plugins con una **edición conservadora**: al leer una entrada, el bloque se guarda con su
comentario, sus atributos y su HTML originales (tipo interno `third`) y solo se tocan los textos, enlaces, imagen, nivel de título,
alineación y colores que se editan. Nunca se vuelve a generar el bloque desde cero: el CSS lo crea el plugin a partir de los atributos y del
`block_id` / `uniqueID` / `uniqueId`, que se conservan. Sin cambios, el bloque vuelve **byte a byte** igual (pruebas en `test/thirdparty.test.js`).
Si algo no encaja con lo esperado (estructura distinta, versión desconocida, JSON no válido, hijos inesperados), el bloque queda como «De WordPress»
(`raw`) como antes: nunca se rompe.

Código: `renderer/thirdparty.js` (lógica pura, tabla `SPECS`), `src/parseblocks.js` (lectura: `default` de `toBlockCore`), `src/transform.js`
(`case 'third'`), `renderer/blocks/third.js` y `renderer/third.css` (editor).

## Cómo se edita
- **Texto**: se busca el nodo por su clase CSS en el HTML guardado y se cambia solo su contenido. Si el plugin guarda también el texto como atributo
  del comentario (`label`, `ctaText`, `caption`…, o cualquier atributo con exactamente el mismo texto), se cambia a la vez para que el bloque siga
  siendo válido en el editor de WordPress. Texto en línea permitido: negrita, cursiva, subrayado, tachado, enlace, `<br>`.
- **Enlace / nueva ventana**: `href`, `target` y `rel` del HTML y los atributos del comentario (`link`, `opensInNewTab`, `target`…). En Spectra
  info-box también el `onclick`.
- **Nivel de título**: cambia la etiqueta `hN` (apertura y cierre) y el atributo (`headingTag`, `level`, `element`, `tagName`).
- **Alineación y colores**: solo atributos sencillos del comentario (`headingAlign`/`headingColor`, `align`/`color`, `hAlign`/`titleColor`, `alignment`/`textColor`…).
  Los colores de paleta del plugin (p. ej. `palette1`) se muestran sin marcar y se sustituyen por un color elegido.
- **Imagen** (solo `uagb/image`): `src`, `srcset`, clase `uag-image-ID`, `alt`, `width`/`height` y atributos `url`, `id`, `alt`, `naturalWidth/Height`.
- **Contenedores**: el HTML de antes y después de los hijos (`pre`/`post`, con fondos, formas, enlaces superpuestos…) se conserva tal cual; los hijos
  son bloques normales de Ecos o de terceros y se pueden editar, mover, borrar y añadir. Los hijos deben ir separados solo por espacio en blanco.
- Atributos del comentario cambiados se vuelven a escribir como WordPress (`--`, `<`, `>`, `&`, `"`); si no cambian, se conserva el comentario original.
- «Editar en WordPress» abre el editor oficial con el bloque completo para todo lo demás.

## Bloques admitidos
Versiones usadas para el estudio: **Spectra 2.20.7** y **Kadence Blocks 3.9.2** (código fuente: `save()`, `attributes.js`, `block.json`).
**GenerateBlocks**: no se pudo descargar su código (sin acceso a wordpress.org ni a su repositorio desde el entorno); la estructura de 1.x y 2.x está
tomada de su formato documentado y habrá que confirmarla con el WordPress de pruebas (`test-wp/`, que lo instala). Ante cualquier diferencia cae a `raw`.

| Plugin | Bloque | Editable |
|---|---|---|
| Spectra | `uagb/container` | contenedor con hijos |
| | `uagb/advanced-heading` | título, subtítulo, nivel, alineación, color |
| | `uagb/buttons` + `uagb/buttons-child` | contenedor; texto, enlace, nueva ventana, color del texto y del botón |
| | `uagb/info-box` | antetítulo, título, descripción, texto del botón, nivel, alineación, color, enlace del botón (con `ctaType` texto/botón) |
| | `uagb/icon-list` + `uagb/icon-list-child` | contenedor; texto y enlace (si tiene) |
| | `uagb/image` | foto (cambiar, alt), título y pie |
| Kadence | `kadence/rowlayout` + `kadence/column` | contenedores con hijos |
| | `kadence/advancedheading` | texto, nivel, alineación, color, enlace (si lo tiene) |
| | `kadence/advancedbtn` + `kadence/singlebtn` | contenedor; botón dinámico (solo atributos): texto, enlace, nueva ventana, colores |
| | `kadence/infobox` | título, texto, «saber más», alineación, color, enlace (si lo tiene) |
| | `kadence/iconlist` + `kadence/listitem` | contenedor; texto y enlace |
| GenerateBlocks | `generateblocks/container`, `grid`, `element`, `button-container` | contenedores con hijos |
| | `generateblocks/headline` (1.x), `generateblocks/text` (2.x) | texto, nivel, alineación y color (1.x), enlace de `text` en `<a>` (solo dirección) |
| | `generateblocks/button` (1.x) | texto, enlace, nueva ventana, colores |

## Lo que NO se admite (se queda como «De WordPress»)
- Cualquier otro bloque `uagb/*`, `kadence/*` o `generateblocks/*` (galerías, sliders, pestañas, formularios, tablas, testimonios, `kadence/icon` y
  `single-icon`, `generateblocks/media`, `query`…).
- `kadence/singlebtn` con HTML guardado (versiones antiguas, no autocerrado), `uagb/info-box` con descripción de varios párrafos
  (`enableMultilineParagraph`), contenedores con texto o etiquetas sueltas entre hijos, comentarios con JSON no válido, bloques sin los nodos esperados.
- Añadir un enlace a un bloque que no lo tenía (cambia su estructura), cambiar la imagen de Kadence/GenerateBlocks, los tamaños, márgenes, fondos y demás
  diseño (se ven y se conservan, pero se editan en WordPress), valores por dispositivo (tableta, móvil), nivel de título de `kadence/infobox`.
- La vista del editor es el HTML guardado con estilos neutros de Ecos (no carga el CSS que genera el plugin); la vista exacta se ve con «Vista previa»
  de la entrada (complemento) o «Editar en WordPress».
