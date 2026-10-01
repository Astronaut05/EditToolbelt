/**
 * A small element builder: the panel is plain DOM (UXP runs it as it is, no
 * framework to load), and text always goes in as text, never as HTML.
 */
type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') {
      el.addEventListener(name.replace(/^on/, '').toLowerCase(), value);
    } else if (name === 'value' && 'value' in el) {
      (el as HTMLInputElement).value = String(value);
    } else if (name === 'checked' && 'checked' in el) {
      (el as HTMLInputElement).checked = value === true;
    } else {
      el.setAttribute(name === 'className' ? 'class' : name, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'number' ? String(child) : child);
  }
  return el;
}

let ids = 0;
/** A unique id, for a label's `for`. */
export const uid = (prefix: string) => `${prefix}-${String((ids += 1))}`;

/** A labelled field: the label above the control. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || uid('f');
  control.id = id;
  return h(
    'div',
    { className: 'field' },
    h('label', { for: id }, label),
    control,
    hint ? h('p', { className: 'hint' }, hint) : null,
  );
}
