function openMapReview(map) {
  const dialog = document.createElement('dialog');
  dialog.className = 'map-review';
  dialog.setAttribute('aria-label', 'ตรวจแผนที่ ' + map.plot);
  dialog.innerHTML = `
    <header><strong></strong><button type="button" data-action="close">ปิด</button></header>
    <div class="review-tools">
      <button type="button" data-action="pan" aria-pressed="true">ลากแผนที่</button>
      <button type="button" data-action="mark" aria-pressed="false">วงจุดแก้ไข</button>
      <button type="button" data-action="in" aria-label="ซูมเข้า">+</button>
      <button type="button" data-action="out" aria-label="ซูมออก">−</button>
      <button type="button" data-action="fit">ดูเต็มแปลง</button>
      <button type="button" data-action="export" disabled>ส่งออก PNG</button>
    </div>
    <canvas aria-label="แผนที่สำหรับวงตำแหน่งที่ต้องแก้ไข"></canvas>
    <form hidden>
      <label>รายละเอียดที่ต้องแก้<textarea required maxlength="400" rows="2"></textarea></label>
      <button type="submit">บันทึกคอมเมนต์</button>
      <button type="button" data-action="cancel">ยกเลิกรอยวง</button>
    </form>
    <div class="review-notes">
      <p role="status">กำลังโหลดแผนที่…</p>
      <ol aria-label="รายการจุดที่ต้องแก้ไข"></ol>
    </div>`;
  dialog.querySelector('strong').textContent = map.plot + ' · ' + map.province + ' · ' + map.kind;
  const canvas = dialog.querySelector('canvas');
  const context = canvas.getContext('2d');
  const form = dialog.querySelector('form');
  const field = form.querySelector('textarea');
  const list = dialog.querySelector('ol');
  const status = dialog.querySelector('[role=status]');
  const button = (action) => dialog.querySelector('[data-action="' + action + '"]');
  const image = new Image();
  const asset = new URL(map.src, location.href);
  const keyPrefix = 'map-review:' + map.plot + ':' + asset.pathname;
  const storageKey = keyPrefix + asset.search;
  let notes = [];
  let storageAvailable = true;
  try {
    let stored = localStorage.getItem(storageKey);
    if (stored === null && asset.search === '?v=satellite-baseline') {
      // These map editions use the same printed frame and extent.
      stored = localStorage.getItem(keyPrefix + '?v=boundary-baseline') ?? localStorage.getItem(keyPrefix);
    }
    const saved = JSON.parse(stored || '[]');
    if (Array.isArray(saved)) notes = saved;
  } catch {
    storageAvailable = false;
  }
  let mode = 'pan', drag = null, pending = null;
  let width = 1, height = 1, scale = 1, minimum = 1, left = 0, top = 0;
  let ready = false;
  const help = 'เลื่อนล้อเมาส์เพื่อซูมตรงตำแหน่งที่ชี้ หรือใช้ + และ − แล้วลากแผนที่';
  const savedMessage = () => storageAvailable ? 'คอมเมนต์เก็บในเบราว์เซอร์นี้' : 'เบราว์เซอร์บันทึกไม่ได้ กรุณาส่งออกก่อนปิด';
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(notes)); }
    catch { storageAvailable = false; }
    status.textContent = savedMessage();
  };
  const contain = () => {
    left = Math.min(Math.max(left, width * .2 - image.width * scale), width * .8);
    top = Math.min(Math.max(top, height * .2 - image.height * scale), height * .8);
  };
  function drawMark(ctx, mark, number, zoom, offsetX, offsetY) {
    const x = offsetX + mark.x * zoom;
    const y = offsetY + mark.y * zoom;
    const rx = mark.rx * zoom;
    const ry = mark.ry * zoom;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#172033';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#56e7ff';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (!number) return;
    const labelX = x + rx;
    const labelY = y - ry;
    ctx.beginPath();
    ctx.arc(labelX, labelY, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#172033';
    ctx.fill();
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), labelX, labelY);
  }
  function draw() {
    if (!ready) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, left, top, image.width * scale, image.height * scale);
    notes.forEach((note, i) => drawMark(context, note, i + 1, scale, left, top));
    if (pending) drawMark(context, pending, 0, scale, left, top);
  }
  function fit() {
    if (!ready) return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    minimum = Math.min(width / image.width, height / image.height) * .97;
    scale = minimum;
    left = (width - image.width * scale) / 2;
    top = (height - image.height * scale) / 2;
    draw();
  }
  function zoom(factor, x = width / 2, y = height / 2) {
    if (!ready) return;
    const next = Math.max(minimum, Math.min(minimum * 16, scale * factor));
    left = x - (x - left) * next / scale;
    top = y - (y - top) * next / scale;
    scale = next;
    contain();
    draw();
  }
  function renderNotes() {
    list.replaceChildren();
    notes.forEach((note, index) => {
      const row = document.createElement('li');
      const focus = document.createElement('button');
      focus.type = 'button';
      focus.textContent = 'ไปจุดที่ ' + (index + 1);
      focus.onclick = () => {
        scale = Math.min(minimum * 16, Math.max(minimum * 2, Math.min(width / note.rx, height / note.ry) / 4));
        left = width / 2 - note.x * scale;
        top = height / 2 - note.y * scale;
        draw();
      };
      const text = document.createElement('textarea');
      text.rows = 2;
      text.maxLength = 400;
      text.value = note.text;
      text.setAttribute('aria-label', 'คอมเมนต์จุดที่ ' + (index + 1));
      text.onchange = () => {
        note.text = text.value.trim() || note.text;
        text.value = note.text;
        save();
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'ลบ';
      remove.setAttribute('aria-label', 'ลบจุดที่ ' + (index + 1));
      remove.onclick = () => {
        notes.splice(index, 1);
        save();
        renderNotes();
      };
      row.append(focus, text, remove);
      list.append(row);
    });
    button('export').disabled = !ready || !notes.length;
    draw();
  }
  const point = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const imagePoint = (p) => ({
    x: Math.min(image.width, Math.max(0, (p.x - left) / scale)),
    y: Math.min(image.height, Math.max(0, (p.y - top) / scale)),
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const p = point(event);
    zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
  }, { passive: false });
  canvas.onpointerdown = (event) => {
    if (!ready || drag || !form.hidden || event.button !== 0) return;
    const p = point(event);
    const anchor = imagePoint(p);
    if (mode === 'mark' && (p.x < left || p.y < top || p.x > left + image.width * scale || p.y > top + image.height * scale)) return;
    drag = { id: event.pointerId, p, anchor, left, top, mode };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (drag?.id !== event.pointerId) return;
    const p = point(event);
    if (drag.mode === 'pan') {
      left = drag.left + p.x - drag.p.x;
      top = drag.top + p.y - drag.p.y;
      contain();
    } else {
      const end = imagePoint(p);
      pending = {
        x: (drag.anchor.x + end.x) / 2, y: (drag.anchor.y + end.y) / 2,
        rx: Math.abs(end.x - drag.anchor.x) / 2, ry: Math.abs(end.y - drag.anchor.y) / 2,
      };
    }
    draw();
  };
  canvas.onpointerup = (event) => {
    if (drag?.id !== event.pointerId) return;
    if (drag.mode === 'mark' && pending && pending.rx * scale >= 3 && pending.ry * scale >= 3) {
      form.hidden = false;
      field.focus();
    } else pending = null;
    drag = null;
    draw();
  };
  canvas.onpointercancel = () => { drag = null; pending = null; draw(); };
  const cancel = () => { pending = null; form.hidden = true; form.reset(); draw(); };
  form.onsubmit = (event) => {
    event.preventDefault();
    const text = field.value.trim();
    if (!pending || !text) return;
    if (notes.length >= 25) { status.textContent = 'บันทึกได้สูงสุด 25 จุดต่อแผนที่'; return; }
    notes.push({ ...pending, text });
    cancel();
    save();
    renderNotes();
  };
  for (const action of ['pan', 'mark']) {
    button(action).onclick = () => {
      mode = action;
      canvas.classList.toggle('marking', mode === 'mark');
      button('pan').setAttribute('aria-pressed', String(mode === 'pan'));
      button('mark').setAttribute('aria-pressed', String(mode === 'mark'));
      status.textContent = mode === 'mark' ? 'ลากเฉียงเพื่อวงบริเวณที่ต้องแก้ แล้วพิมพ์คอมเมนต์' : help;
    };
  }
  button('in').onclick = () => zoom(1.4);
  button('out').onclick = () => zoom(1 / 1.4);
  button('fit').onclick = fit;
  button('cancel').onclick = cancel;
  button('close').onclick = () => dialog.close();
  button('export').onclick = () => {
    const output = document.createElement('canvas');
    const ctx = output.getContext('2d');
    const size = Math.min(1, 1500 / image.width);
    output.width = Math.max(780, Math.ceil(image.width * size));
    const font = '20px sans-serif';
    ctx.font = font;
    const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
    const lines = notes.flatMap((note, i) => {
      const wrapped = [];
      for (const paragraph of [String(i + 1) + '. ' + note.text.replace(/\s+/g, ' ')]) {
        let line = '';
        for (const { segment } of segmenter.segment(paragraph)) {
          if (line && ctx.measureText(line + segment).width > output.width - 48) {
            wrapped.push(line);
            line = '';
          }
          line += segment;
        }
        wrapped.push(line);
      }
      return [...wrapped, ''];
    });
    const mapHeight = Math.ceil(image.height * size);
    const x = (output.width - image.width * size) / 2;
    output.height = mapHeight + 115 + lines.length * 30;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.fillStyle = '#172033';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('รายการแก้ไข · ' + map.plot + ' · ' + map.province + ' · ' + map.kind, 24, 36);
    ctx.drawImage(image, x, 56, image.width * size, mapHeight);
    notes.forEach((note, index) => drawMark(ctx, note, index + 1, size, x, 56));
    ctx.fillStyle = '#172033';
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, index) => ctx.fillText(line, 24, mapHeight + 95 + index * 30));
    output.toBlob((blob) => {
      if (!blob) { status.textContent = 'ส่งออกภาพไม่ได้'; return; }
      const url = URL.createObjectURL(blob);
      const download = document.createElement('a');
      download.href = url;
      download.download = map.plot + '-map-review.png';
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 'image/png');
  };
  const observer = new ResizeObserver(fit);
  dialog.addEventListener('close', () => { observer.disconnect(); dialog.remove(); }, { once: true });
  image.onload = () => {
    if (!dialog.isConnected) return;
    ready = true;
    fit();
    renderNotes();
    status.textContent = help + ' · ' + savedMessage();
  };
  image.onerror = () => { status.textContent = 'เปิดภาพแผนที่ไม่ได้'; };
  document.body.append(dialog);
  dialog.showModal();
  observer.observe(canvas);
  image.src = asset.href;
}
