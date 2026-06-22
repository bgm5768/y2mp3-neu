/**
 * resources/js/ui/dialog.js
 * Lightweight in-app prompt and confirmation dialogs.
 */

let elements = null;
let active = null;
let previousFocus = null;

function buildDialog() {
  const backdrop = document.createElement('div');
  backdrop.className = 'app-dialog-backdrop hidden';
  backdrop.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = 'app-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'app-dialog-title');
  dialog.setAttribute('aria-describedby', 'app-dialog-message');

  const header = document.createElement('div');
  header.className = 'app-dialog-header';

  const kicker = document.createElement('div');
  kicker.className = 'app-dialog-kicker';

  const title = document.createElement('h2');
  title.id = 'app-dialog-title';
  title.className = 'app-dialog-title';

  const message = document.createElement('p');
  message.id = 'app-dialog-message';
  message.className = 'app-dialog-message';

  header.append(kicker, title, message);

  const field = document.createElement('label');
  field.className = 'app-dialog-field';

  const label = document.createElement('span');
  label.className = 'app-dialog-label';

  const input = document.createElement('input');
  input.className = 'app-dialog-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const select = document.createElement('select');
  select.className = 'app-dialog-select hidden';

  const hint = document.createElement('small');
  hint.className = 'app-dialog-hint';

  field.append(label, input, select, hint);

  const detail = document.createElement('div');
  detail.className = 'app-dialog-detail hidden';

  const error = document.createElement('div');
  error.className = 'app-dialog-error hidden';
  error.setAttribute('role', 'alert');

  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-ghost app-dialog-cancel';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-primary app-dialog-confirm';

  actions.append(cancel, confirm);
  dialog.append(header, field, detail, error, actions);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeDialog(getCancelValue());
  });
  cancel.addEventListener('click', () => closeDialog(getCancelValue()));
  confirm.addEventListener('click', submitDialog);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitDialog();
    }
  });
  select.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitDialog();
    }
  });

  return { backdrop, dialog, kicker, title, message, field, label, input, select, hint, detail, error, cancel, confirm };
}

function ensureDialog() {
  if (!elements) elements = buildDialog();
  return elements;
}

function setOptionalText(node, value) {
  const text = String(value || '').trim();
  node.textContent = text;
  node.classList.toggle('hidden', !text);
}

function getCancelValue() {
  return active?.mode === 'confirm' ? false : null;
}

function normalizeValidationResult(result, fallbackValue) {
  if (typeof result === 'string') {
    return result ? { ok: false, message: result, value: fallbackValue } : { ok: true, value: fallbackValue };
  }
  if (result === false) return { ok: false, message: '입력값을 확인해 주세요.', value: fallbackValue };
  if (result && typeof result === 'object') {
    return {
      ok: result.ok !== false,
      message: result.message || '',
      value: Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : fallbackValue
    };
  }
  return { ok: true, value: fallbackValue };
}

function setError(message) {
  if (!elements) return;
  setOptionalText(elements.error, message);
  elements.input.setAttribute('aria-invalid', message ? 'true' : 'false');
  elements.select.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function focusInitialControl() {
  if (!elements || !active) return;
  window.setTimeout(() => {
    if (!elements || !active || elements.backdrop.classList.contains('hidden')) return;
    if (active.mode === 'prompt') {
      elements.input.focus();
      elements.input.select();
      return;
    }
    if (active.mode === 'select') {
      elements.select.focus();
      return;
    }
    elements.confirm.focus();
  }, 0);
}

function handleKeydown(event) {
  if (!active || !elements || elements.backdrop.classList.contains('hidden')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialog(getCancelValue());
    return;
  }

  if (event.key !== 'Tab') return;

  const focusable = [elements.input, elements.select, elements.cancel, elements.confirm]
    .filter(node => !node.disabled && !node.closest('.hidden'));
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openDialog(mode, options = {}) {
  const dialog = ensureDialog();

  if (active) closeDialog(getCancelValue(), { restoreFocus: false });

  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  active = { mode, options, resolve: null };

  dialog.backdrop.classList.toggle('app-dialog-danger', !!options.danger);
  dialog.kicker.textContent = options.kicker || (options.danger ? '주의' : '확인');
  dialog.title.textContent = options.title || (mode === 'confirm' ? '확인' : '입력');
  dialog.message.textContent = options.message || '';
  dialog.cancel.textContent = options.cancelText || '취소';
  dialog.confirm.textContent = options.confirmText || (mode === 'confirm' ? '확인' : '저장');

  dialog.confirm.className = `btn ${options.danger ? 'btn-danger' : 'btn-primary'} app-dialog-confirm`;

  const showField = mode === 'prompt' || mode === 'select';
  dialog.field.classList.toggle('hidden', !showField);
  dialog.input.classList.toggle('hidden', mode !== 'prompt');
  dialog.select.classList.toggle('hidden', mode !== 'select');

  if (mode === 'prompt') {
    dialog.label.textContent = options.label || '이름';
    dialog.input.value = options.value ?? '';
    dialog.input.placeholder = options.placeholder || '';
    dialog.input.maxLength = Number.isFinite(Number(options.maxLength)) ? Number(options.maxLength) : 240;
    setOptionalText(dialog.hint, options.hint);
  } else if (mode === 'select') {
    dialog.label.textContent = options.label || '선택';
    dialog.select.innerHTML = '';
    (options.options || []).forEach(option => {
      const item = document.createElement('option');
      item.value = String(option.value ?? '');
      item.textContent = option.label ?? option.value ?? '';
      item.disabled = !!option.disabled;
      dialog.select.appendChild(item);
    });
    dialog.select.value = String(options.value ?? dialog.select.options[0]?.value ?? '');
    dialog.confirm.disabled = !dialog.select.options.length;
    setOptionalText(dialog.hint, options.hint);
  } else {
    dialog.input.value = '';
    dialog.select.innerHTML = '';
    dialog.input.removeAttribute('aria-invalid');
    dialog.select.removeAttribute('aria-invalid');
    dialog.confirm.disabled = false;
  }

  if (mode !== 'select') dialog.confirm.disabled = false;

  setOptionalText(dialog.detail, options.detail);
  setError('');
  dialog.backdrop.classList.remove('hidden');
  document.addEventListener('keydown', handleKeydown);
  focusInitialControl();

  return new Promise(resolve => {
    active.resolve = resolve;
  });
}

function submitDialog() {
  if (!active || !elements) return;

  if (active.mode === 'confirm') {
    closeDialog(true);
    return;
  }

  const rawValue = active.mode === 'select' ? elements.select.value : elements.input.value;
  const validation = normalizeValidationResult(active.options.validate?.(rawValue), rawValue);
  if (!validation.ok) {
    setError(validation.message || '입력값을 확인해 주세요.');
    elements.input.focus();
    return;
  }

  closeDialog(validation.value);
}

function closeDialog(value, { restoreFocus = true } = {}) {
  if (!active || !elements) return;

  const resolve = active.resolve;
  active = null;
  elements.backdrop.classList.add('hidden');
  document.removeEventListener('keydown', handleKeydown);
  setError('');

  if (restoreFocus && previousFocus && document.contains(previousFocus)) {
    previousFocus.focus();
  }
  previousFocus = null;
  resolve?.(value);
}

export const Dialog = {
  prompt(options = {}) {
    return openDialog('prompt', options);
  },
  select(options = {}) {
    return openDialog('select', options);
  },
  confirm(options = {}) {
    return openDialog('confirm', options);
  }
};
