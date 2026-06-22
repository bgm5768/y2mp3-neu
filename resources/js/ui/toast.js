/**
 * resources/js/ui/toast.js
 * Toast notification rendering.
 */

export const Toast = {
    show(msg, type = 'info', duration = 4000, action = null) {
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      const body = document.createElement('div');
      body.className = 'toast-body';
      body.textContent = msg;
      el.appendChild(body);
  
      let dismissed = false;
      const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        el.classList.add('removing');
        el.addEventListener('animationend', () => el.remove(), { once: true });
      };
  
      if (action && action.label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', async () => {
          try {
            if (typeof action.onClick === 'function') await action.onClick();
          } finally {
            dismiss();
          }
        });
        el.appendChild(btn);
      }
  
      document.getElementById('toast-container').appendChild(el);
      if (duration > 0) {
        setTimeout(dismiss, action ? Math.max(duration, 8000) : duration);
      }
    }
};
