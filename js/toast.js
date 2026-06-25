// ============================================================
// SISTEMA DE NOTIFICACIONES (TOAST) — compartido
// Mensajes flotantes con animación de entrada/salida y una
// barra de tiempo que se vacía hasta que el toast desaparece solo.
// Uso: showToast({ title, message, type, duration })
// ============================================================

(function () {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  window.showToast = function ({ title, message = '', type = 'info', duration = 6000, code = '' }) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${getToastIcon(type)}</div>
      <div class="toast-body">
        <p class="toast-title">${escapeToastHtml(title)}</p>
        ${message ? `<p class="toast-message">${escapeToastHtml(message)}</p>` : ''}
        ${code ? `<button type="button" class="toast-code" data-code="${escapeToastHtml(code)}">${escapeToastHtml(code)}</button>` : ''}
      </div>
      <button class="toast-close" aria-label="Cerrar">
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <div class="toast-bar"><div class="toast-bar-fill"></div></div>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('is-visible'));

    const fill = toast.querySelector('.toast-bar-fill');
    fill.style.animationDuration = `${duration}ms`;

    let dismissTimer = setTimeout(() => dismiss(), duration);

    function dismiss() {
      clearTimeout(dismissTimer);
      toast.classList.remove('is-visible');
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 300);
    }

    toast.querySelector('.toast-close').addEventListener('click', dismiss);

    const codeBtn = toast.querySelector('.toast-code');
    if (codeBtn) {
      codeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const value = codeBtn.dataset.code;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(value);
          } else {
            const temp = document.createElement('textarea');
            temp.value = value;
            temp.style.position = 'fixed';
            temp.style.opacity = '0';
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
          }
          codeBtn.classList.add('is-copied');
          setTimeout(() => codeBtn.classList.remove('is-copied'), 1200);
        } catch (err) {
          console.error('No se pudo copiar:', err);
        }
      });
    }

    return dismiss;
  };

  function getToastIcon(type) {
    const icons = {
      success: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      error: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 6v5M10 14h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/></svg>',
      info: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5M10 6.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    };
    return icons[type] || icons.info;
  }

  function escapeToastHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();
