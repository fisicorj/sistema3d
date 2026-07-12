(function installSistema3DSanitizer() {
  'use strict';

  if (window.__S3D_HTML_SANITIZER__) return;
  window.__S3D_HTML_SANITIZER__ = true;

  const blockedTags = new Set([
    'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'APPLET', 'BASE', 'META', 'LINK'
  ]);

  const allowedInlineEvents = new Set(['onclick', 'onchange', 'onsubmit']);
  const forbiddenHandlerTokens = /(?:\balert\b|\bconfirm\b|\bprompt\b|\beval\b|\bFunction\b|\bfetch\b|\bXMLHttpRequest\b|\bdocument\b|\blocation\b|\bconstructor\b|\blocalStorage\b|\bsessionStorage\b|`|<|>)/i;

  const innerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!innerHTMLDescriptor?.set || !innerHTMLDescriptor?.get) {
    console.warn('[Sistema3D] Sanitizador de HTML não pôde ser instalado.');
    return;
  }

  function handlerLooksInternal(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 500 || forbiddenHandlerTokens.test(text)) return false;
    return !/[<>`]/.test(text);
  }

  function sanitizeAppHtml(input) {
    const template = document.createElement('template');
    innerHTMLDescriptor.set.call(template, String(input ?? ''));

    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
    const remove = [];

    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (blockedTags.has(el.tagName)) {
        remove.push(el);
        continue;
      }

      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';

        if (name.startsWith('on')) {
          if (!allowedInlineEvents.has(name) || !handlerLooksInternal(value)) {
            el.removeAttribute(attr.name);
          }
          continue;
        }

        if (
          (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'formaction') &&
          /^\s*(?:javascript|vbscript|data:text\/html)/i.test(value)
        ) {
          el.removeAttribute(attr.name);
        }

        if (name === 'srcdoc') el.removeAttribute(attr.name);
      }
    }

    remove.forEach((el) => el.remove());
    return innerHTMLDescriptor.get.call(template);
  }

  window.sanitizeAppHtml = sanitizeAppHtml;

  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: innerHTMLDescriptor.configurable,
    enumerable: innerHTMLDescriptor.enumerable,
    get() {
      return innerHTMLDescriptor.get.call(this);
    },
    set(value) {
      innerHTMLDescriptor.set.call(this, sanitizeAppHtml(value));
    }
  });
})();
