// ===== ship-models.js: mô hình tàu chiến dựng bằng code three.js (r128), không cần file model =====
// Quy ước: mũi tàu hướng -Z (giống game), đuôi +Z, đáy tàu ở y=0.
// Cách dùng:  const g = SHIPS.destroyer.build(); scene.add(g);   rồi mỗi frame gọi  animateShip(g, thoiGianGiay);
// g.userData có: tur (tháp pháo), rad (radar), fl (lửa động cơ), lt (đèn hành trình), core (lõi năng lượng, nếu có).
// Muốn chỉnh tàu: sửa thông số trong SHIPS (L=dài, W=rộng, H=cao thân, tur=tháp pháo, br=tháp chỉ huy, eng=số động cơ...).
const GC={},MC={},BC={};
const G=(k,f)=>GC[k]||(GC[k]=f());                       // cache geometry dùng chung để game không giật
const mat=(c,e=.12)=>MC[c+'_'+e]||(MC[c+'_'+e]=new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:e,metalness:.7,roughness:.4}));
const glow=c=>BC[c]||(BC[c]=new THREE.MeshBasicMaterial({color:c}));
const DK=mat(0x1b2030,.02);

function _box(g,w,h,d,x,y,z,m){const o=new THREE.Mesh(G('b'+w+','+h+','+d,()=>new THREE.BoxGeometry(w,h,d)),m);o.position.set(x,y,z);g.add(o);return o}
function _cyl(g,r,h,x,y,z,m,alongZ){const o=new THREE.Mesh(G('c'+r+','+h,()=>new THREE.CylinderGeometry(r,r*1.1,h,12)),m);o.position.set(x,y,z);if(alongZ)o.rotation.x=Math.PI/2;g.add(o);return o}

// Thân tàu: đa giác nhìn từ trên xuống (mũi nhọn, mạn vát) rồi đùn lên theo chiều cao H
function _hull(L,W,H){return G('h'+L+','+W+','+H,()=>{const s=new THREE.Shape(),a=W/2;
 s.moveTo(-a*.85,-L/2);s.lineTo(a*.85,-L/2);s.lineTo(a,-L*.1);s.lineTo(a*.55,L*.32);s.lineTo(0,L/2);s.lineTo(-a*.55,L*.32);s.lineTo(-a,-L*.1);s.closePath();
 const g=new THREE.ExtrudeGeometry(s,{depth:H,bevelEnabled:false});g.rotateX(-Math.PI/2);return g})}

// Tháp pháo: đế tròn + thân hộp + nòng pháo (nb nòng). Xoay quanh trục Y để ngắm mục tiêu.
function _turret(g,x,y,z,s,nb,col){const t=new THREE.Group();t.position.set(x,y,z);
 _cyl(t,.6*s,.3*s,0,.15*s,0,mat(col,.1));_box(t,.9*s,.4*s,1*s,0,.5*s,0,mat(col,.15));
 for(let i=0;i<nb;i++)_cyl(t,.07*s,1.7*s,(i-(nb-1)/2)*.38*s,.55*s,-1.2*s,DK,true);
 g.add(t);g.userData.tur.push(t)}

// Động cơ: ống phụt + lửa (nón) nhấp nháy
function _eng(g,L,H,W,n,es){for(let i=0;i<n;i++){const x=n===1?0:(i/(n-1)-.5)*W*.6;
 _cyl(g,.32*es,.8*es,x,H*.55,L/2+.1,DK,true);
 const f=new THREE.Mesh(G('f'+es,()=>new THREE.ConeGeometry(.28*es,1.8*es,10)),glow(0x66ccff));f.rotation.x=Math.PI/2;f.position.set(x,H*.55,L/2+.5+.9*es);g.add(f);g.userData.fl.push(f)}}

// Hàm dựng tàu chung. f trong các mảng là vị trí dọc thân: +0.5 = mũi, -0.5 = đuôi.
function makeShip(o){const g=new THREE.Group();g.userData={tur:[],rad:[],fl:[],lt:[]};
 const {L,W,H,col,acc}=o,m=mat(col,.1),T=o.tiers||0,top=H+T*H*.7;
 g.add(new THREE.Mesh(_hull(L,W,H),m));
 const tk=[[.55,.6],[.32,.38]];                              // các tầng boong chồng lên (dài, rộng theo tỉ lệ)
 for(let i=0;i<T;i++){const t=new THREE.Mesh(_hull(L*tk[i][0],W*tk[i][1],H*.7),mat(col,.12));t.position.set(0,H+i*H*.7,L*.1);g.add(t)}
 [-1,1].forEach(s=>_box(g,.06,.1,L*.55,s*W*.47,H*.5,L*.02,glow(acc)));   // vạch sáng nhận dạng hai bên mạn
 (o.tur||[]).forEach(a=>_turret(g,a[3]||0,a[4]||H,-a[0]*L,a[1],a[2],col)); // [f, cỡ, số nòng, x, y]
 let bt=top;                                                  // tháp chỉ huy + dãy cửa sổ phát sáng
 if(o.br){const [f,h,w,d]=o.br,z=-f*L;_box(g,w,h,d,0,top+h/2,z,mat(col,.1));_box(g,w*.9,h*.18,.05,0,top+h*.62,z-d/2-.02,glow(0xffe9a0));_box(g,w*.7,h*.35,d*.7,0,top+h*1.17,z,mat(col,.1));bt=top+h*1.35}
 (o.rad||[]).forEach(a=>{const s=a[1],z=-a[0]*L;_cyl(g,.05*s,1.2*s,0,bt+.6*s,z,DK);g.userData.rad.push(_box(g,1.1*s,.08*s,.5*s,0,bt+1.25*s,z,mat(0xbbc4d0,.05)))}); // radar xoay
 (o.cells||[]).forEach(a=>{const z=-a[0]*L,sp=a[2]||.12;for(let r=0;r<a[1];r++)[-1,1].forEach(s=>_box(g,W*.14,.06,.35,s*W*sp,H+.03,z+r*.5,mat(0x394057,.05)))}); // bệ tên lửa
 if(o.core){const c=new THREE.Mesh(G('core',()=>new THREE.SphereGeometry(1,16,12)),glow(0xffb347));c.position.set(0,H*.6,L/2+.1);c.scale.setScalar(o.core);g.add(c);g.userData.core=c;g.userData.cs=o.core}
 _eng(g,L,H,W,o.eng||2,o.es||1);
 [[-1,0xff3b3b],[1,0x3bff6b]].forEach(([s,c])=>{const l=new THREE.Mesh(G('lt',()=>new THREE.SphereGeometry(.12,8,6)),glow(c));l.position.set(s*W*.48,H+.12,L*.15);g.add(l);g.userData.lt.push(l)}); // đèn đỏ trái, xanh phải
 return g}

// Gọi mỗi frame: tháp pháo đảo ngắm, radar xoay, lửa nhấp nháy, đèn chớp, lõi năng lượng đập nhịp
function animateShip(g,t){const u=g.userData;
 u.tur.forEach((x,i)=>x.rotation.y=Math.sin(t*.6+i)*.5);u.rad.forEach(r=>r.rotation.y=t*2);
 u.fl.forEach(f=>f.scale.set(1,.7+Math.random()*.6,1));u.lt.forEach((l,i)=>l.visible=Math.floor(t*2+i)%2===0);
 if(u.core)u.core.scale.setScalar(u.cs*(1+Math.sin(t*3)*.12))}

// ===== 5 loại tàu theo tàu thật =====
const SHIPS={
 destroyer:{short:'Khu trục',name:'Khu trục hạm (Destroyer)',role:'Tàu người chơi',note:'Cân đối, 2 tháp pháo, radar, bệ tên lửa phía đuôi.',
  build:()=>makeShip({L:14,W:3.2,H:1.1,col:0x6fb8ff,acc:0x00e5ff,tur:[[.22,1,2],[-.25,.9,1]],br:[-.02,1.1,1.5,2],rad:[[-.02,.9]],cells:[[-.38,3]],eng:2})},
 corvette:{short:'Hộ tống',name:'Tàu hộ tống (Corvette)',role:'Địch trinh sát',note:'Nhỏ, ngắn, nhanh, 1 tháp pháo. Dễ nhận ra nhờ kích thước.',
  build:()=>makeShip({L:8,W:2.2,H:.9,col:0xff9a3d,acc:0xffe27a,tur:[[.2,.8,1]],br:[-.12,.8,1.1,1.4],rad:[[-.12,.7]],eng:2,es:.8})},
 frigate:{short:'Frigate',name:'Tàu frigate',role:'Địch chiến đấu',note:'Dài vừa, 2 tháp pháo đôi, radar lớn, bệ tên lửa.',
  build:()=>makeShip({L:12,W:3,H:1,col:0xb085ff,acc:0xe3d0ff,tur:[[.25,1,2],[-.32,.9,2]],br:[0,1,1.4,1.8],rad:[[0,1.1]],cells:[[-.16,2]],eng:3})},
 cruiser:{short:'Tuần dương',name:'Tuần dương hạm (Cruiser)',role:'Địch bom',note:'To, chậm, 3 tháp pháo đôi, 1 tầng boong cao.',
  build:()=>makeShip({L:18,W:4.6,H:1.3,col:0xffd23f,acc:0xfff1a0,tiers:1,tur:[[.36,1.1,2],[.24,1.1,2],[-.44,1.1,2]],br:[-.12,1.3,1.8,2.2],rad:[[-.12,1.1]],eng:3,es:1.1})},
 dreadnought:{short:'Thiết giáp',name:'Thiết giáp hạm (Dreadnought)',role:'Boss',note:'Rất lớn, 2 tầng boong, 3 tháp pháo ba nòng, pháo phụ, lõi năng lượng ở đuôi.',
  build:()=>makeShip({L:30,W:8,H:2.2,col:0xff4d6d,acc:0xffaa66,tiers:2,tur:[[.36,1.6,3],[.24,1.5,3],[-.44,1.5,3],[.05,.8,1,2,3.74],[.05,.8,1,-2,3.74]],br:[-.1,1.8,2.2,3],rad:[[-.1,1.2]],cells:[[-.06,6,.38]],core:1.3,eng:4,es:1.6})}
};
