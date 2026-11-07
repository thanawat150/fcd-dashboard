function openDashboardDownload(data) {
  const dialog = document.createElement('dialog');
  dialog.className = 'map-review download-dialog';
  dialog.setAttribute('aria-labelledby', 'download-title');
  dialog.innerHTML = `
    <header>
      <div>
        <p class="download-kicker">ส่งออกข้อมูล</p>
        <h2 id="download-title">ดาวน์โหลดภาพและข้อมูล</h2>
        <p>เลือกแปลงและชนิดไฟล์ที่ต้องการ ระบบจะรวมเป็น ZIP เดียว</p>
      </div>
      <button type="button" aria-label="ปิด"><span aria-hidden="true">×</span></button>
    </header>
    <form>
      <div class="download-scope">
      <label>ขอบเขต
        <select name="scope" aria-label="ขอบเขต">
          <option value="plot">แปลงที่เปิดอยู่</option>
          <option value="province">เลือกจังหวัด</option>
          <option value="filtered">ตามขอบเขตที่กรองอยู่</option>
          <option value="all">ทุกแปลง</option>
        </select>
      </label>
      <label data-province hidden>จังหวัด <select name="province" aria-label="จังหวัด"></select></label>
      </div>
      <fieldset>
        <legend>ไฟล์ที่ต้องการ</legend>
        <div class="download-options">
          <label><input type="checkbox" name="fcd" checked><span>ภาพ FCD</span><small aria-hidden="true">JPG</small></label>
          <label><input type="checkbox" name="drone" checked><span>ภาพโดรน</span><small aria-hidden="true">JPG</small></label>
          <label><input type="checkbox" name="pdd" checked><span>ภาพขอบเขต PDD</span><small aria-hidden="true">JPG</small></label>
          <label><input type="checkbox" name="drone_pdf" checked><span>PDF แผนที่</span><small aria-hidden="true">PDF</small></label>
          <label><input type="checkbox" name="csv" checked><span>ตารางข้อมูล CSV</span><small aria-hidden="true">CSV</small></label>
          <label><input type="checkbox" name="notes"><span>คอมเมนต์และรอยวง</span><small aria-hidden="true">JSON</small></label>
        </div>
        <p class="download-hint">คอมเมนต์และรอยวงมาจากเบราว์เซอร์ที่ใช้อยู่</p>
      </fieldset>
      <footer>
        <p data-summary aria-live="polite"></p>
        <button type="submit">ดาวน์โหลด ZIP</button>
      </footer>
      <p role="status"></p>
    </form>`;
  const form = dialog.querySelector('form');
  const fields = form.elements;
  const status = form.querySelector('[role=status]');
  const summary = form.querySelector('[data-summary]');
  const provinceRow = form.querySelector('[data-province]');
  const submit = form.querySelector('[type=submit]');
  const close = dialog.querySelector('header button');
  const assets = ['fcd', 'drone', 'pdd', 'drone_pdf'];
  const provinces = [...new Set(data.maps.map((row) => row.province))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'th'));
  fields.province.append(...provinces.map((province) => new Option(province)));
  if (provinces.includes(data.current?.province)) fields.province.value = data.current.province;
  fields.scope.options[0].disabled = !data.current;
  if (!data.current) fields.scope.value = 'filtered';
  let controller;
  function selectedRows() {
    switch (fields.scope.value) {
      case 'plot': return data.current ? [data.current] : [];
      case 'province': return data.maps.filter((row) => row.province === fields.province.value);
      case 'filtered': return data.scoped;
      default: return data.maps;
    }
  }
  function selectedAssets(rows) {
    return [...new Set(rows.flatMap((row) => assets.filter((kind) => fields[kind].checked && row[kind])
      .map((kind) => row[kind])))];
  }
  function update() {
    provinceRow.hidden = fields.scope.value !== 'province';
    const rows = selectedRows();
    const count = selectedAssets(rows).length;
    summary.textContent = rows.length + ' แปลง · ' + count + ' ไฟล์ภาพหรือ PDF' +
      (fields.csv.checked ? ' · ตาราง CSV 3 ไฟล์' : '') +
      (fields.notes.checked ? ' · รอยวงที่บันทึกไว้ (ถ้ามี)' : '');
    submit.disabled = !rows.length || (!count && !fields.csv.checked && !fields.notes.checked);
  }
  form.addEventListener('change', update);
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { controller?.abort(); dialog.remove(); }, { once: true });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (controller) return;
    const rows = selectedRows();
    const urls = selectedAssets(rows);
    const selected = new Set(rows.map((row) => row.plot));
    const archive = createDashboardZip();
    const label = { plot: data.current?.plot, province: fields.province.value, filtered: 'ตามตัวกรอง', all: 'ทุกแปลง' }[fields.scope.value];
    controller = new AbortController();
    try {
      if (fields.csv.checked) {
        archive.add('plot_maps.csv', dashboardCsv(rows, data.maps));
        archive.add('fcd_dashboard.csv', dashboardCsv(data.fcd.filter((row) => selected.has(row.plot)), data.fcd));
        archive.add('baseline.csv', dashboardCsv(data.baseline.filter((row) => selected.has(row.plot)), data.baseline));
      }
      if (fields.notes.checked) {
        const notes = rows.flatMap((row) => assets.slice(0, 3).filter((kind) => row[kind]).flatMap((kind) => {
          const url = new URL(row[kind], location.href);
          const key = 'map-review:' + row.plot + ':' + url.pathname;
          let saved = localStorage.getItem(key + url.search);
          if (saved === null && url.search === '?v=satellite-baseline') {
            saved = localStorage.getItem(key + '?v=boundary-baseline') ?? localStorage.getItem(key);
          }
          const marks = JSON.parse(saved || '[]');
          return Array.isArray(marks) && marks.length ? [{ plot: row.plot, kind, map: row[kind], marks }] : [];
        }));
        if (notes.length) archive.add('review-notes.json', new TextEncoder().encode(JSON.stringify(notes, null, 2)));
      }
      for (const input of form.querySelectorAll('input,select,button')) input.disabled = true;
      for (const [index, url] of urls.entries()) {
        status.textContent = 'กำลังเตรียมไฟล์ ' + (index + 1) + ' / ' + urls.length;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('ดาวน์โหลดไฟล์ไม่ได้ ' + url);
        const blob = await response.blob();
        archive.add(url.split('?')[0], new Uint8Array(await blob.arrayBuffer()), blob);
      }
      if (!archive.count) { status.textContent = 'ไม่พบคอมเมนต์ที่บันทึกไว้ในขอบเขตนี้'; return; }
      const url = URL.createObjectURL(archive.finish());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'createmap-' + label.replace(/[<>:"/\\|?*]/g, '-') + '.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = 'สร้าง ZIP แล้ว · ' + archive.count + ' ไฟล์';
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'สร้าง ZIP ไม่สำเร็จ · ' + error.message;
    } finally {
      controller = null;
      for (const input of form.querySelectorAll('input,select,button')) input.disabled = false;
      update();
    }
  };
  document.body.append(dialog);
  update();
  dialog.showModal();
}

function dashboardCsv(rows, original) {
  const fields = Object.keys(original[0] || {});
  const escape = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  return new TextEncoder().encode('\uFEFF' + [
    fields.map(escape).join(','),
    ...rows.map((row) => fields.map((field) => escape(row[field])).join(',')),
  ].join('\r\n') + '\r\n');
}

const dashboardCrcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ ((byte & 1) ? 0xedb88320 : 0);
  return byte;
});

// Store already compressed map files without recompressing them.
function createDashboardZip() {
  const files = [], central = [];
  const encoder = new TextEncoder();
  let offset = 0, centralSize = 0;
  return {
    get count() { return central.length; },
    add(path, bytes, payload = bytes) {
      const name = encoder.encode(path);
      if (offset + bytes.length + centralSize + 100 + name.length * 2 >= 0xffffffff || central.length >= 65535) {
        throw new Error('ชุดดาวน์โหลดใหญ่เกินไป กรุณาแบ่งตามจังหวัด');
      }
      let crc = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ dashboardCrcTable[(crc ^ bytes[i]) & 0xff];
      }
      crc ^= 0xffffffff;
      const local = new Uint8Array(30 + name.length);
      const entry = new Uint8Array(46 + name.length);
      const header = new DataView(local.buffer), directory = new DataView(entry.buffer);
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 0x800, true);
      header.setUint16(12, 0x21, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, bytes.length, true);
      header.setUint32(22, bytes.length, true);
      header.setUint16(26, name.length, true);
      local.set(name, 30);
      directory.setUint32(0, 0x02014b50, true);
      directory.setUint16(4, 20, true);
      entry.set(local.subarray(4, 28), 6);
      directory.setUint32(42, offset, true);
      entry.set(name, 46);
      files.push(local, payload);
      central.push(entry);
      offset += local.length + bytes.length;
      centralSize += entry.length;
    },
    finish() {
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, central.length, true);
      end.setUint16(10, central.length, true);
      end.setUint32(12, centralSize, true);
      end.setUint32(16, offset, true);
      return new Blob([...files, ...central, end.buffer], { type: 'application/zip' });
    },
  };
}
