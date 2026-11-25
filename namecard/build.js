// 사용: NODE_PATH=<qrcode,playwright 경로> node build.js  → out/ 에 PDF·PNG 생성 (A 시안)
const fs = require('fs'), path = require('path');
const QR = require('qrcode'), { chromium } = require('playwright');

const C = {
  nameKo: '더에스의원', nameEn: 'THE S CLINIC', dept: '성형외과',
  person: '박성진', personEn: 'James PARK', title: '대표원장 / 의학박사 &nbsp;·&nbsp; M.D., Ph.D.',
  addr1: '울산광역시 남구 삼산로278번길 8, 7층', addr2: '(스타벅스 삼산로점 건물)',
  tel: '052-707-1000', mobile: '010-2875-8088',
  email: 'medicos51@gmail.com', web: 'www.sclinic.co.kr',
  treat: ['성형외과', '피부과', '줄기세포치료', '항노화'],
  mapUrl: 'https://map.naver.com/p/search/' + encodeURIComponent('울산광역시 남구 삼산로278번길 8'),
};

const font = (fam, w, file) => ['korean', 'latin']
  .map(s => `@font-face{font-family:'${fam}';font-weight:${w};src:url('fonts/${file}-${s}-${w}-normal.woff2')}`).join('');
const fonts = [300, 400, 700].map(w => font('NS', w, 'noto-sans-kr')).join('');

// 재단 90x50mm + 사방 3mm 도련 = 96x56mm
const base = `${fonts}
@page{size:96mm 56mm;margin:0}*{box-sizing:border-box;margin:0;padding:0}
html,body{width:96mm}.p{width:96mm;height:56mm;position:relative;overflow:hidden;break-after:page;font-family:NS}`;

const icon = d => `<svg viewBox="0 0 24 24" width="2.5mm" height="2.5mm" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  pin: icon('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  tel: icon('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
  mail: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  web: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
};

(async () => {
  const qr = await QR.toString(C.mapUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0f2742', light: '#0000' } });
  const b64 = f => 'data:image/png;base64,' + fs.readFileSync(path.join('assets', f)).toString('base64');

  const html = `<style>${base}
  /* ---- 앞면 ---- */
  .f{background:#fff;color:#fff}
  .f .navy{position:absolute;left:0;top:0;width:61mm;height:56mm;background:#0f2742;padding:6mm 3mm 6mm 9.5mm;display:flex;flex-direction:column;justify-content:space-between}
  .f .en{font-size:2.2mm;letter-spacing:.5mm;font-weight:300;color:#c9a96a}
  .f h1{font-size:6.2mm;font-weight:700;letter-spacing:.3mm;line-height:1.1}
  .f .dept{font-size:5.4mm;font-weight:700;letter-spacing:.9mm;color:#c9a96a;margin-top:1.4mm}
  .f .who{border-top:.2mm solid #c9a96a;padding-top:2mm}
  .f .who .t{font-size:2.5mm;font-weight:300;margin-bottom:.8mm}
  .f .who b{font-size:4.4mm;font-weight:700;margin-right:1.6mm;letter-spacing:.4mm}.f .who span{font-size:2.6mm;font-weight:300}
  .f .logo{position:absolute;left:67mm;top:7mm;width:15mm}
  .f .cari{position:absolute;left:62.5mm;bottom:0;width:33.5mm}
  /* ---- 뒷면 ---- */
  .b{background:#fff;color:#0f2742}
  .b .in{position:absolute;left:3mm;top:3mm;width:90mm;height:50mm;padding:5mm 6mm 5mm 6.5mm}
  .b .hd{font-size:3.4mm;font-weight:700;letter-spacing:.4mm;display:flex;align-items:baseline;gap:1.6mm}
  .b .hd small{color:#a8864a;font-size:3mm;font-weight:700;letter-spacing:.3mm}
  .b .l{position:absolute;left:6.5mm;top:13mm;width:51mm;font-size:2.45mm;line-height:1.35}
  .b .r{display:flex;gap:1.6mm;align-items:flex-start;margin-bottom:1.3mm}.b .r svg{margin-top:.3mm;color:#a8864a;flex:none}
  .b small.s{font-size:2.1mm;color:#667}
  .b .tr{margin-top:2.2mm;padding-top:1.8mm;border-top:.2mm solid #c9a96a;font-size:2.4mm;line-height:1.5;font-weight:700}
  .b .tr i{font-style:normal;color:#a8864a;font-weight:400;margin:0 .8mm}
  .b .map{position:absolute;right:6mm;top:8.5mm;width:21mm;border:.2mm solid #c9a96a;padding:2mm 1.6mm 1.6mm;text-align:center}
  .b .map svg{width:15mm;height:15mm;display:block;margin:0 auto 1.4mm}
  .b .map b{display:block;font-size:2.4mm}.b .map span{display:block;font-size:1.9mm;color:#667;line-height:1.35;margin-top:.4mm}
  </style>
  <div class="p f">
    <div class="navy">
      <div class="en">${C.nameEn}</div>
      <div><h1>${C.nameKo}</h1><div class="dept">${C.dept}</div></div>
      <div class="who"><div class="t">${C.title}</div><b>${C.person}</b><span>${C.personEn}</span></div>
    </div>
    <img class="logo" src="${b64('logo_theS.png')}">
    <img class="cari" src="${b64('caricature.png')}">
  </div>
  <div class="p b"><div class="in">
    <div class="hd">${C.nameKo}<small>${C.dept}</small></div>
    <div class="l">
      <div class="r">${I.pin}<span>${C.addr1}<br><small class="s">${C.addr2}</small></span></div>
      <div class="r">${I.tel}<span>T ${C.tel} &nbsp; M ${C.mobile}</span></div>
      <div class="r">${I.mail}<span>${C.email}</span></div>
      <div class="r">${I.web}<span>${C.web}</span></div>
      <div class="tr">${C.treat.slice(0, 2).join('<i>·</i>')}<br>${C.treat.slice(2).join('<i>·</i>')}</div>
    </div>
    <div class="map">${qr}<b>약도</b><span>QR 스캔 시 지도<br>스타벅스 삼산로점<br>건물 7층</span></div>
  </div></div>`;

  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('A_navy.html', `<!doctype html><meta charset=utf-8>${html}`);
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 363, height: 212 }, deviceScaleFactor: 6 });
  await pg.goto('file://' + path.resolve('A_navy.html'));
  await pg.evaluate(() => document.fonts.ready);
  await pg.pdf({ path: 'out/A_navy_print_RGB.pdf', width: '96mm', height: '56mm', printBackground: true });
  const els = await pg.$$('.p');
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `out/A_navy_${i ? 'back' : 'front'}.png` });
  // ---- 재단선(트림마크) 버전: 106x66mm 용지, 재단 영역은 (8,8)~(98,58)mm ----
  const T = 8, R = 98, B = 58, L = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const marks = `<svg viewBox="0 0 106 66" width="106mm" height="66mm" stroke="#000" stroke-width=".1" fill="none">`
    + [T, R].map(x => L(x, 1, x, 4) + L(x, 62, x, 65)).join('')
    + [T, B].map(y => L(1, y, 4, y) + L(102, y, 105, y)).join('') + '</svg>';
  await pg.addStyleTag({ content: '@page{size:106mm 66mm;margin:0}html,body{width:106mm}.sheet{width:106mm;height:66mm;position:relative;overflow:hidden;break-after:page;background:#fff}.sheet .p{position:absolute;left:5mm;top:5mm;break-after:auto}.sheet>svg{position:absolute;left:0;top:0}' });
  await pg.evaluate(m => document.querySelectorAll('.p').forEach(p => {
    const s = document.createElement('div'); s.className = 'sheet'; p.replaceWith(s); s.appendChild(p); s.insertAdjacentHTML('beforeend', m);
  }), marks);
  await pg.pdf({ path: 'out/A_navy_print_RGB_marks.pdf', width: '106mm', height: '66mm', printBackground: true });
  await br.close();
})();
