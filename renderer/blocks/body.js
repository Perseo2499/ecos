// Editor de bloques · cuerpo de cada bloque: elige la función del tipo (renderer/blocks/types/*.js registra cada una en
// BlockEditor.types) y le pasa el bloque, su posición, el hueco del cuerpo y el hueco de su barra de opciones.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { t } = K;

  E.types = {}; // tipo de bloque → function (b, i, body, extra, arr, textBlock): dibuja el bloque y su barra

  Object.assign(E, {
    body(b, i, body, extra, arr = this.draft.blocks) {
      const self = this;
      // texto editable con Intro (otro párrafo) y Retroceso (borrar si está vacío), común a párrafo y título
      const textBlock = (tag, cls) => this.editable(tag, b.html, b.ph ? t(b.ph) : b.type === 'paragraph' ? t('Escribe aquí… (pulsa / para elegir un bloque)') : t('Escribe aquí…'), (h) => (b.html = h), {
        cls, block: b,
        onKey(e, el) {
          // Intro al final de un párrafo crea otro; Retroceso en un bloque vacío lo borra
          if (b.type === 'paragraph' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            self.insertAt(i + 1, self.create('paragraph'), true, arr);
          }
          if (e.key === 'Backspace' && !el.textContent.trim() && arr.length > 1 && ['paragraph', 'heading'].includes(b.type)) {
            e.preventDefault();
            const prev = arr[i - 1];
            self.change(() => arr.splice(i, 1));
            if (prev) self.focus(prev.id, true);
          }
        },
      });
      const draw = this.types[b.type];
      if (draw) draw.call(this, b, i, body, extra, arr, textBlock); else body.textContent = b.type;
    },
  });
})();
