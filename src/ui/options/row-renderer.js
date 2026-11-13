export function createRow(container, columns, data = {}, opts = {}) {
  const row = document.createElement('div');
  row.className = `row${opts.className ? ` ${opts.className}` : ''}`;
  if (opts.id) {
    row.id = opts.id;
  }

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    let el;

    if (col.type === 'select') {
      el = document.createElement('select');
      el.className = col.className;
      for (let j = 0; j < col.options.length; j++) {
        const [value, label] = col.options[j];
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        el.appendChild(opt);
      }
      if (data[col.key] !== null && data[col.key] !== undefined) {
        el.value = data[col.key];
      }
    } else if (col.type === 'checkbox') {
      el = document.createElement('input');
      el.type = 'checkbox';
      el.className = col.className;
      el.checked = data[col.key] ?? col.default ?? false;
    } else {
      el = document.createElement('input');
      el.type = col.inputType || 'text';
      el.className = col.className;
      if (col.placeholder) el.placeholder = col.placeholder;
      const val = data[col.key] ?? col.default;
      if (val !== null && val !== undefined) el.value = val;
    }

    row.appendChild(el);
  }

  if (opts.removable) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'removeParent';
    btn.textContent = '\u00d7';
    btn.title = 'Remove row';
    row.appendChild(btn);
  }

  if (opts.before) {
    container.insertBefore(row, opts.before);
  } else {
    container.appendChild(row);
  }

  return row;
}

