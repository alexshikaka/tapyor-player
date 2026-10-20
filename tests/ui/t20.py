import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# Плейлисты: музыка с компьютера, импорт (ссылка/файл/текст), проверка с клавиатуры, перенос, синхронизация, свои плейлисты Яндекса
import asyncio, subprocess
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8777','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
MOCK = r"""
(function(){
  var a = window.app, P = function(x){ return new Promise(function(r){ setTimeout(function(){ r(x); }, 15); }); }, L = window.__log;
  function LT(id, t, ar, al, n){ return { src: 'lc', id: id, title: t, author: ar, album: al, trackNo: n, duration: '3:00', seconds: 180, thumb: '', path: 'C:\\Music\\' + ar + '\\' + t + '.mp3', folder: 'C:\\Music\\' + ar }; }
  var LIBT = [LT('l1','Группа крови','Кино','Группа крови',1), LT('l2','Кукушка','Кино','Чёрный альбом',2), LT('l3','Осень','ДДТ','Актриса весна',3), LT('l4','Улица роз','Ария','Игра с огнём',1)];
  a.libStatus = function(){ return P({ folders: [{ path: 'C:\\Music', count: 4 }], count: 4, extras: 0, scanning: null }); };
  a.libAll = function(){ return P(LIBT.slice()); };
  a.libSearch = function(q){ return P(/кино/i.test(q) ? [LIBT[0], LIBT[1]] : []); };
  a.libStream = function(id){ L.push('libStream ' + id); return P({ audioUrl: '/loud.wav' }); };
  a.libRescan = function(){ return a.libStatus(); };
  a.onLibChanged = function(){}; a.onLibProgress = function(){};
  a.libReveal = function(id){ L.push('reveal ' + id); return P(true); };
  a.matchRemember = function(line, only, t){ L.push('remember ' + line + ' → ' + t.id); return P(true); };
  a.importUrl = function(u){ L.push('importUrl ' + u); if (/youtu/.test(u)) return P({ title: 'Рок-микс 2 часа', source: 'youtube-chapters', items: [{ line: 'Кино - Звезда', seconds: 230 }, { line: 'The Beatles - Help', seconds: 140 }, { line: 'Rekevin - Answer', seconds: 200 }, { line: 'Ария - Беспечный ангел', seconds: 260 }] });
    if (/spotify/.test(u)) return P({ title: 'Spotify', source: 'spotify', items: [{ line: 'Nirvana — Lithium' }] });
    return P({ error: 'с этого сайта пока не умею' }); };
  a.importFile = function(){ return P({ title: 'Чат музыки', source: 'telegram', items: [{ line: 'Кино — Кукушка' }, { url: 'https://open.spotify.com/playlist/xx', line: '' }] }); };
  a.ymPlCreate = function(t, tr){ L.push('ymCreate ' + t + ' ' + tr.length); return P({ ok: true, uid: '1', kind: '77', count: tr.length }); };
  a.ymPlAdd = function(k, tr){ L.push('ymAdd ' + k + ' ' + tr.length); return P({ ok: true, count: tr.length }); };
  a.ymPlRemove = function(k, ids){ L.push('ymRemove ' + k + ' ' + ids.join(',')); return P({ ok: true, count: ids.length }); };
  a.ymPlRename = function(k, t){ L.push('ymRename ' + k + ' ' + t); return P({ ok: true }); };
  a.ymPlDelete = function(k){ L.push('ymDelete ' + k); return P({ ok: true }); };
  a.ytPlCreate = function(t, ids){ L.push('ytCreate ' + t + ' ' + ids.length); return P({ ok: true, listId: 'PLnew', count: ids.length }); };
  a.ytPlAdd = function(id, ids){ L.push('ytAdd ' + ids.length); return P({ ok: true, count: ids.length }); };
  a.plRemote = function(t, link){ L.push('remote ' + t + ' ' + JSON.stringify(link)); return P({ ok: true, ids: [] }); };
  a.m3uExport = function(t, tr){ L.push('m3u ' + t + ' ' + tr.length); return P({ ok: true, file: t + '.m3u8' }); };
  a.ytAuthStatus = function(){ return P({ cookies: null, oauth: { configured: true, account: { name: 'shikaka' }, canWrite: true }, useCookies: false }); };
  var mL = a.matchLine;
  a.matchLine = function(line, o){ L.push('match ' + line + ' only=' + ((o && o.only) || '') + ' sec=' + ((o && o.seconds) || 0)); return mL(line).then(function (r){ if (o && o.only === 'yt' && r.track) { r.track.src = 'yt'; r.track.id = 'v' + r.track.id; } return r; }); };
})();
"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(script=MOCK)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('con:'+m.text) if m.type=='error' and 'Failed to load' not in m.text else None)
        await pg.goto('http://127.0.0.1:8777/app2/index.html'); await pg.wait_for_timeout(800)
        E=pg.evaluate
        print('чип «Мои файлы» виден:', await E("!document.getElementById('chipLc').hidden"))
        # поиск: свои файлы в выдаче
        await pg.fill('#search','кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(900)
        print('в поиске свои файлы:', await E("document.querySelectorAll('#results .row[data-src=lc]').length"))
        await E("document.querySelector('#results .row[data-src=lc]').click()"); await pg.wait_for_timeout(500)
        print('играет файл:', [x for x in await E("window.__log") if x.startswith('libStream')][:1])
        # вкладка Плейлисты → На компьютере
        await pg.click('#tabs [data-tab=my]'); await pg.wait_for_timeout(600)
        grp = await E("Array.from(document.querySelectorAll('#mySide .myt')).map(x=>x.textContent)")
        print('вкладки:', grp)
        await pg.screenshot(path='l_top.png')
        await E("document.querySelector('#mySide [data-mytab=lc]').click()"); await pg.wait_for_timeout(200)
        await E("Array.from(document.querySelectorAll('#mySide .mit')).find(x=>/компьютера/.test(x.textContent)).click()"); await pg.wait_for_timeout(500)
        print('песен:', await E("document.querySelectorAll('#myPl .lib-body .row').length"), '| вкладки:', await E("Array.from(document.querySelectorAll('#myPl .ar-tabs button')).map(x=>x.textContent).join(' | ')"))
        await pg.screenshot(path='l_lib.png')
        await E("document.querySelector('#myPl [data-lt=artists]').click()"); await pg.wait_for_timeout(300)
        await E("Array.from(document.querySelectorAll('#myPl .alc')).find(x=>/Кино/.test(x.textContent)).click()"); await pg.wait_for_timeout(300)
        print('исполнитель Кино →', await E("document.querySelectorAll('#myPl .lib-body .row').length"), 'песен | фильтр:', await E("(document.querySelector('.lib-chip')||{}).textContent"))
        await pg.fill('#libQ', 'осень'); await pg.wait_for_timeout(500)
        await E("document.querySelector('.lib-chip').click()"); await pg.wait_for_timeout(300)
        print('поиск «осень»:', await E("Array.from(document.querySelectorAll('#myPl .lib-body .row .t')).map(x=>x.textContent)"))
        # импорт по ссылке
        await E("document.querySelector('#mySide [data-import]').click()"); await pg.wait_for_timeout(300)
        await E("document.querySelector('#myPl [data-it=url]').click()"); await pg.wait_for_timeout(200)
        await pg.fill('#impUrl', 'https://www.youtube.com/watch?v=mix123'); await pg.click('#impUrlGo'); await pg.wait_for_timeout(400)
        print('ссылка:', await E("document.querySelector('.imp-note').textContent"), '| название:', await E("document.getElementById('impName').value"))
        await pg.screenshot(path='l_imp_url.png')
        await pg.click('#impGo'); await pg.wait_for_timeout(1200)
        print('чипы:', await E("document.querySelector('.imp-chips').textContent"))
        print('длительность передана:', [x for x in await E("window.__log") if x.startswith('match Кино - Звезда')])
        await pg.screenshot(path='l_imp_res.png')
        # с клавиатуры: первая строка — «Похоже» → Enter
        await E("document.querySelector('.imp-list').focus()")
        cur0 = await E("document.querySelector('.imp-r.kcur .o').textContent")
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        print('Enter на «' + cur0.strip() + '» →', await E("document.querySelector('.imp-chips').textContent"))
        print('запомнено:', [x for x in await E("window.__log") if x.startswith('remember')])
        await pg.keyboard.press('ArrowDown'); await pg.wait_for_timeout(150)
        await pg.keyboard.press('Delete'); await pg.wait_for_timeout(200)
        print('после Delete:', await E("document.querySelector('.imp-chips').textContent"))
        await pg.click('#impSave'); await pg.wait_for_timeout(1200)
        print('сохранено:', [x for x in await E("window.__log") if x.startswith('ymCreate')], '|', await E("document.querySelector('#myPl .plnote').textContent"))
        btns = await E("Array.from(document.querySelectorAll('#myPl .plbtns button')).map(x=>x.textContent)")
        print('кнопки плейлиста:', btns)
        await pg.screenshot(path='l_pl.png')
        # синхронизация с Яндексом
        await E("document.querySelector('#myPl [data-a=\"sync-ym\"]').click()"); await pg.wait_for_timeout(500)
        print('окно синхронизации:', await E("(document.querySelector('.ask p')||{}).textContent"))
        await E("document.querySelector('.ask [data-x=\"1\"]').click()"); await pg.wait_for_timeout(800)
        print('синхронизация:', [x for x in await E("window.__log") if x.startswith('remote') or x.startswith('ymAdd')])
        # перенос на YouTube
        await E("document.querySelector('#myPl [data-a=xfer]').click()"); await pg.wait_for_timeout(200)
        print('меню переноса:', await E("Array.from(document.querySelectorAll('.ctx button')).map(x=>x.textContent)"))
        await E("Array.from(document.querySelectorAll('.ctx button')).find(x=>/YouTube/.test(x.textContent)).click()"); await pg.wait_for_timeout(1200)
        print('перенос:', await E("document.querySelector('.imp-h').textContent"), '|', await E("document.querySelector('.imp-chips').textContent"))
        print('искал только YouTube:', all('only=yt' in x for x in await E("window.__log") if x.startswith('match') and 'only=yt' in x) and len([x for x in await E("window.__log") if 'only=yt' in x])>0)
        await pg.click('#impSave'); await pg.wait_for_timeout(1000)
        print('на YouTube:', [x for x in await E("window.__log") if x.startswith('ytCreate')], '| кнопки:', await E("Array.from(document.querySelectorAll('#myPl .plbtns button')).map(x=>x.textContent).filter(t=>/Синхр/.test(t))"))
        # M3U
        await E("document.querySelector('#myPl [data-a=xfer]').click()"); await pg.wait_for_timeout(200)
        await E("Array.from(document.querySelectorAll('.ctx button')).find(x=>/M3U/.test(x.textContent)).click()"); await pg.wait_for_timeout(300)
        print('m3u:', [x for x in await E("window.__log") if x.startswith('m3u')])
        # импорт файла (Telegram) со ссылкой внутри
        await E("document.querySelector('#mySide [data-import]').click()"); await pg.wait_for_timeout(200)
        await E("document.querySelector('#myPl [data-it=file]').click()"); await pg.wait_for_timeout(200)
        await pg.click('#impFileGo'); await pg.wait_for_timeout(300)
        print('файл:', await E("document.querySelector('.imp-note').textContent"))
        await pg.click('#impGo'); await pg.wait_for_timeout(1200)
        print('файл → строк:', await E("document.getElementById('impCount').textContent"), '| ссылка открыта:', [x for x in await E("window.__log") if 'spotify' in x])
        await E("document.getElementById('impBack').click()"); await pg.wait_for_timeout(200)
        # свой плейлист Яндекса: переименовать, убрать песню
        await E("document.querySelector('#mySide [data-mytab=ym]').click()"); await pg.wait_for_timeout(200)
        await E("Array.from(document.querySelectorAll('#mySide .mit')).find(x=>/Мой плейлист/.test(x.textContent)).click()"); await pg.wait_for_timeout(500)
        print('свой плейлист Яндекса, кнопки:', await E("Array.from(document.querySelectorAll('#myPl .plbtns button')).map(x=>x.textContent).filter(t=>/Переимен|Удалить/.test(t))"), '| убрать в меню у песен:', await E("document.querySelectorAll('#myPl .plrows .row').length && Array.from(document.querySelectorAll('#myPl .plrows .row')).every(r=>r._rm)"))
        await E("document.querySelector('#myPl [data-a=pren]').click()"); await pg.wait_for_timeout(200)
        await pg.fill('.ask input[type=text]', 'Для стрима'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(400)
        await E("document.querySelector('#myPl .plrows .row .more').click()"); await pg.wait_for_timeout(200)
        await E("Array.from(document.querySelectorAll('.ctx button')).find(x=>/Убрать из плейлиста/.test(x.textContent)).click()"); await pg.wait_for_timeout(400)
        print('Яндекс:', [x for x in await E("window.__log") if x.startswith('ymRename') or x.startswith('ymRemove')])
        # В плейлист… → свои плейлисты площадок
        await pg.click('#tabs [data-tab=search]'); await pg.wait_for_timeout(200)
        await E("var r=document.querySelector('#results .row[data-src=ym]'); r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}))"); await pg.wait_for_timeout(200)
        await E("Array.from(document.querySelectorAll('.ctx button')).find(x=>/В плейлист/.test(x.textContent)).click()"); await pg.wait_for_timeout(200)
        print('В плейлист…:', await E("Array.from(document.querySelectorAll('.ctx button')).map(x=>x.textContent).filter(t=>/Яндекс:|YouTube:/.test(t))"))
        await E("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
        # настройки: меню слева на месте, раздел про свои файлы; кнопка очистки очереди
        await pg.click('#tabs [data-tab=settings]'); await pg.wait_for_timeout(300)
        print('меню настроек sticky:', await E("getComputedStyle(document.querySelector('.set-side')).position"), '| раздел:', await E("!!document.getElementById('sLocal')"))
        await E("document.getElementById('viewSettings').scrollTop = 2500"); await pg.wait_for_timeout(200)
        print('меню на месте после прокрутки:', await E("Math.round(document.querySelector('.set-side').getBoundingClientRect().top)"))
        await pg.screenshot(path='l_set.png')
        await pg.click('#tabs [data-tab=search]'); await pg.wait_for_timeout(200)
        print('кнопка очистки, высота:', await E("document.getElementById('clearq').offsetHeight"))
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
