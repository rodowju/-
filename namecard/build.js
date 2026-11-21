// 사용: NODE_PATH=<qrcode,playwright 경로> node build.js  → out/ 에 PDF·PNG 생성
const fs = require('fs'), path = require('path');
const QR = require('qrcode'), { chromium } = require('playwright');

const C = {
  nameKo: '더에스의원', nameEn: 'THE S CLINIC', dept: '성형외과',
  person: '박성진', title: '의학박사',
  addr1: '울산광역시 남구 삼산로278번길 8, 7층', addr2: '(스타벅스 삼산로점 건물)',
  tel: '052-707-1000', mobile: '010-2875-8088',
  email: 'medicos51@gmail.com', web: 'www.sclinic.co.kr',
};

const font = (fam, w, file) => ['korean', 'latin']
  .map(s => `@font-face{font-family:'${fam}';font-weight:${w};src:url('fonts/${file}-${s}-${w}-normal.woff2')}`).join('');
const fonts = [300, 400, 700].map(w => font('NS', w, 'noto-sans-kr')).join('')
  + [400, 600].map(w => font('NF', w, 'noto-serif-kr')).join('');

// 재단 90x50mm + 사방 3mm 도련 = 96x56mm
const base = `${fonts}
@page{size:96mm 56mm;margin:0}*{box-sizing:border-box;margin:0;padding:0}
html,body{width:96mm}.p{width:96mm;height:56mm;position:relative;overflow:hidden;break-after:page;font-family:NS}
.t{position:absolute;left:3mm;top:3mm;width:90mm;height:50mm}`;

const icon = d => `<svg viewBox="0 0 24 24" width="2.6mm" height="2.6mm" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  pin: icon('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  tel: icon('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
  mob: icon('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  mail: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  web: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
};
const rows = () => `<div class="r">${I.pin}<span>${C.addr1}<br><small>${C.addr2}</small></span></div>
<div class="r">${I.tel}<span>T ${C.tel}</span></div><div class="r">${I.mob}<span>M ${C.mobile}</span></div>
<div class="r">${I.mail}<span>${C.email}</span></div><div class="r">${I.web}<span>${C.web}</span></div>`;

(async () => {
  const qr = (dark) => QR.toString('https://' + C.web, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark, light: '#0000' } });
  const designs = {
    A_navy: `<style>${base}
  .f{background:#0f2742;color:#fff}.f .t{display:flex;flex-direction:column;justify-content:space-between;padding:6mm 6.5mm}
  .f .top{font-size:2.3mm;letter-spacing:.5mm;font-weight:300;color:#c9a96a}
  .f h1{font-size:7.2mm;font-weight:700;letter-spacing:.6mm;line-height:1.1}.f h1+div{font-size:2.6mm;letter-spacing:1.3mm;font-weight:300;margin-top:1.2mm;color:#c9a96a}
  .f .bot{border-top:.2mm solid #c9a96a;padding-top:2.6mm}.f .bot b{font-size:4.2mm;font-weight:700;margin-right:2mm}.f .bot span{font-size:2.8mm;font-weight:300}
  .b{background:#fff;color:#0f2742}.b .t{padding:5.5mm 6.5mm;display:flex;justify-content:space-between;align-items:flex-end}
  .b .l{font-size:2.55mm;line-height:1.45}.b .r{display:flex;gap:1.8mm;align-items:flex-start;margin-bottom:1.5mm}.b .r svg{margin-top:.5mm;color:#a8864a;flex:none}.b small{font-size:2.2mm;color:#667}
  .b .q{width:15mm;text-align:center;font-size:1.8mm;color:#667}.b .q svg{width:15mm;height:15mm;display:block;margin-bottom:1mm}
  .b .hd{position:absolute;left:9.5mm;top:8mm;font-size:3mm;font-weight:700;letter-spacing:.4mm}.b .hd small{color:#a8864a;font-weight:300;margin-left:1.5mm;letter-spacing:.3mm;font-size:2.4mm}</style>
  <div class="p f"><div class="t"><div class="top">${C.nameEn}</div><div><h1>${C.nameKo}</h1><div>${C.dept.split('').join(' ')}</div></div>
  <div class="bot"><b>${C.person}</b><span>${C.title}</span></div></div></div>
  <div class="p b"><div class="hd">${C.nameKo}<small>${C.dept}</small></div><div class="t"><div class="l" style="margin-top:9mm">${rows()}</div><div class="q">${await qr('#0f2742')}QR · 홈페이지</div></div></div>`,

    B_ivory: `<style>${base}
  .f{background:#f7f3ec;color:#2b2b2b}.f .t{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  .f .t:before{content:'';position:absolute;inset:2.5mm;border:.2mm solid #b08d57}
  .f h1{font-family:NF;font-weight:600;font-size:7mm;letter-spacing:1mm;margin-bottom:1.2mm}.f .e{font-size:2.2mm;letter-spacing:1.6mm;color:#b08d57;font-weight:300}
  .f .d{font-size:2.8mm;letter-spacing:1.2mm;margin:3mm 0 5mm;font-weight:300}.f .n{font-family:NF;font-size:3.8mm;font-weight:600}.f .n small{font-family:NS;font-weight:300;font-size:2.6mm;margin-left:1.5mm}
  .b{background:#fff;color:#2b2b2b}.b .t{padding:6mm 7mm;display:flex;flex-direction:column;justify-content:space-between}
  .b .hd{font-family:NF;font-size:3.4mm;font-weight:600;letter-spacing:.5mm;border-bottom:.2mm solid #b08d57;padding-bottom:2mm;display:flex;justify-content:space-between}.b .hd small{font-family:NS;font-weight:300;font-size:2.2mm;color:#b08d57;letter-spacing:.8mm;align-self:flex-end}
  .b .g{display:flex;justify-content:space-between;align-items:flex-end}.b .l{font-size:2.55mm;line-height:1.45}.b .r{display:flex;gap:1.8mm;margin-bottom:1.4mm}.b .r svg{margin-top:.5mm;color:#b08d57;flex:none}.b small{font-size:2.2mm;color:#777}
  .b .q svg{width:14mm;height:14mm;display:block}</style>
  <div class="p f"><div class="t"><h1>${C.nameKo}</h1><div class="e">${C.nameEn}</div><div class="d">${C.dept}</div><div class="n">${C.person}<small>${C.title}</small></div></div></div>
  <div class="p b"><div class="t"><div class="hd"><span>${C.nameKo}</span><small>${C.dept}</small></div><div class="g"><div class="l">${rows()}</div><div class="q">${await qr('#2b2b2b')}</div></div></div></div>`,
  };

  fs.mkdirSync('out', { recursive: true });
  const br = await chromium.launch();
  for (const [k, h] of Object.entries(designs)) {
    fs.writeFileSync(`${k}.html`, `<!doctype html><meta charset=utf-8>${h}`);
    const pg = await br.newPage({ viewport: { width: 363, height: 212 }, deviceScaleFactor: 6 });
    await pg.goto('file://' + path.resolve(`${k}.html`));
    await pg.evaluate(() => document.fonts.ready);
    await pg.pdf({ path: `out/${k}_print_RGB.pdf`, width: '96mm', height: '56mm', printBackground: true });
    const els = await pg.$$('.p');
    for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `out/${k}_${i ? 'back' : 'front'}.png` });
  }
  await br.close();
})();
