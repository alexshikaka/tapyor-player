(function(){
  var a = window.app; var P = function(x){ return Promise.resolve(x); };
  function T(src, id, title, author, sec){ return { src: src, id: String(id), albumId: src==='ym'?'9':undefined, title: title, author: author, duration: '4:46', seconds: sec||286, thumb: '' }; }
  a.ymSearch = function(q){ return P({ tracks: [T('ym',1,'Группа крови','Кино'), T('ym',2,'Группа крови (Live)','Кино'), T('ym',3,'Звезда по имени Солнце','Кино'), T('ym',4,'Группа крови','Би-2, Кино')], playlists: [], artists: /кино/i.test(q) ? [{ id:'77', name:'Кино', thumb:'' }] : [] }); };
  a.ytSearch = function(q){ return P({ videos: [{ id:'y1', title:'Кино - Группа крови (кавер на гитаре)', author:'Vasya', duration:'3:20', seconds:200, thumb:'' }, { id:'y2', title:'Группа крови', author:'Кино - Topic', duration:'4:46', seconds:286, thumb:'' }, { id:'y3', title:'КИНО — Группа крови (Official Video)', author:'KINO', duration:'4:50', seconds:290, thumb:'' }], playlists: [] }); };
  a.scSearch = function(){ return new Promise(function(r){ setTimeout(function(){ r([T('sc','https://soundcloud.com/x/gk','Группа крови','Кино фан', 280), T('sc','https://soundcloud.com/x/rmx','Группа крови (remix)','dj', 200)]); }, 300); }); };
  a.auSearch = function(){ return new Promise(function(r){ setTimeout(function(){ r([T('au','a1','Группа крови','Indie', 250)]); }, 400); }); };
  a.ymArtist = function(){ return P({ tracks: [T('ym',1,'Группа крови','Кино')] }); };
})();
(function(){
  var a = window.app; var P = function(x){ return Promise.resolve(x); };
  function T(src, id, title, author, sec){ return { src: src, id: String(id), albumId: src==='ym'?'9':undefined, title: title, author: author, duration: '4:00', seconds: sec||240, thumb: '' }; }
  a.artistPage = function(name, id){ return new Promise(function(r){ setTimeout(function(){ r({ name: name, errors: [],
    ym: { id: '77', name: 'Кино', photo: '', about: 'Советская рок-группа, основанная в 1981 году. Лидер — Виктор Цой. Одна из самых популярных групп в истории русского рока.', popular: [T('ym',1,'Группа крови','Кино'), T('ym',3,'Звезда по имени Солнце','Кино')],
      albums: [{src:'ym',id:'a1',title:'Группа крови',year:1988,type:'album',thumb:'',count:11},{src:'ym',id:'a2',title:'Звезда по имени Солнце',year:1989,type:'album',thumb:'',count:10},{src:'ym',id:'s1',title:'Кукушка',year:1990,type:'single',thumb:'',count:1}],
      also: [{src:'ym',id:'c1',title:'Легенды русского рока',year:1997,type:'compilation',thumb:'',count:15}],
      similar: [{id:'5',name:'Наутилус Помпилиус',thumb:''},{id:'6',name:'Алиса',thumb:''}] },
    lf: { name:'Кино', url:'https://www.last.fm/music/Кино', bio:'', tags:['russian rock','post-punk','new wave'], listeners: 980000, similar:[] },
    dz: { id:'1', name:'Кино', photo:'', fans: 412000, albums: [{src:'dz',id:'d1',title:'Группа крови',year:1988,type:'album',thumb:'',count:11},{src:'dz',id:'d2',title:'45',year:1982,type:'album',thumb:'',count:13}], top: [], similar: [] } }); }, 200); }); };
  a.dzAlbum = function(id){ return P({ src:'dz', id:id, title:'45', author:'Кино', year:1982, thumb:'', tracks:[{src:'dz',id:'t1',title:'Время есть, а денег нет',author:'Кино',duration:'2:30',seconds:150},{src:'dz',id:'t2',title:'Солнечные дни',author:'Кино',duration:'3:10',seconds:190},{src:'dz',id:'t3',title:'Несуществующая песня xyz',author:'Кино',duration:'1:00',seconds:60}] }); };
  a.ymAlbum = function(id){ return P({ src:'ym', type:'album', title:'Группа крови', author:'Кино', count:2, tracks:[T('ym',1,'Группа крови','Кино'), T('ym',8,'Закрой за мной дверь','Кино')] }); };
  a.matchLine = function(line){ return new Promise(function(r){ setTimeout(function(){ if (/xyz/.test(line)) r({status:'none',alts:[]}); else { var t=line.split(' — '); r({status: /Солнечные/.test(line)?'close':'exact', query: line, track: T('ym', 'm'+Math.random().toString(36).slice(2,6), t[1], t[0]), alts: []}); } }, 150); }); };
})();
