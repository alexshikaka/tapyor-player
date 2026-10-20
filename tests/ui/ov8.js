(function(){
  var a = window.app; var P = function(x){ return Promise.resolve(x); };
  function T(src, id, title, author, sec){ return { src: src, id: String(id), albumId: src==='ym'?'9':undefined, title: title, author: author, duration: '4:46', seconds: sec||286, thumb: '' }; }
  a.ymSearch = function(q){ return P({ tracks: [T('ym',1,'Группа крови','Кино'), T('ym',2,'Группа крови (Live)','Кино'), T('ym',3,'Звезда по имени Солнце','Кино'), T('ym',4,'Группа крови','Би-2, Кино')], playlists: [], artists: /кино/i.test(q) ? [{ id:'77', name:'Кино', thumb:'' }] : [] }); };
  a.ytSearch = function(q){ return P({ videos: [{ id:'y1', title:'Кино - Группа крови (кавер на гитаре)', author:'Vasya', duration:'3:20', seconds:200, thumb:'' }, { id:'y2', title:'Группа крови', author:'Кино - Topic', duration:'4:46', seconds:286, thumb:'' }, { id:'y3', title:'КИНО — Группа крови (Official Video)', author:'KINO', duration:'4:50', seconds:290, thumb:'' }], playlists: [] }); };
  a.scSearch = function(){ return new Promise(function(r){ setTimeout(function(){ r([T('sc','https://soundcloud.com/x/gk','Группа крови','Кино фан', 280), T('sc','https://soundcloud.com/x/rmx','Группа крови (remix)','dj', 200)]); }, 300); }); };
  a.auSearch = function(){ return new Promise(function(r){ setTimeout(function(){ r([T('au','a1','Группа крови','Indie', 250)]); }, 400); }); };
  a.ymArtist = function(){ return P({ tracks: [T('ym',1,'Группа крови','Кино')] }); };
})();
