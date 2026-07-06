// Window-member autocomplete: the CodeMirror completion source that suggests
// live properties of window-global APIs at the cursor. The toolkit snippet catalog
// that used to dominate this file moved to toolkit-catalog.js (data, not completions).
import { completionPath } from '@codemirror/lang-javascript';

function _getObjProps(obj) {
  const props = new Set();
  for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
    Object.getOwnPropertyNames(o).forEach((k) => {
      if (!k.startsWith('_') && k !== 'constructor') props.add(k);
    });
  return [...props];
}

export function windowMemberCompletionSource(context) {
  const path = completionPath(context);
  if (!path || path.path.length === 0) return null;

  let target = window[path.path[0]];
  for (let i = 1; i < path.path.length; i++) {
    target = target?.[path.path[i]];
    if (!target) return null;
  }
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return null;

  const options = _getObjProps(target).map((k) => ({ label: k, type: 'property' }));
  if (!options.length) return null;

  return {
    from: context.pos - path.name.length,
    options,
    validFor: /^[\w$]*/,
  };
}
