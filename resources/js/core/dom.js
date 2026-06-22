/**
 * resources/js/core/dom.js
 * Small DOM helpers shared by UI modules.
 */

export function el(id) {
  return document.getElementById(id);
}

export function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}
