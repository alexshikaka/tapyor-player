import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess, json
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8781','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
LONG='Очень длинное название альбома которое никак не помещается в одну строку плитки (Deluxe Edition Remastered 2024)'
# Проверка плиток: текст не вылезает за свою плитку и плитки не накладываются друг на друга
CHECK = """(sel) => { const out=[]; const tiles=Array.from(document.querySelectorAll(sel)).filter(e=>e.offsetParent);
  tiles.forEach((t,i)=>{ const r=t.getBoundingClientRect();
    t.querySelectorAll('*').forEach(c=>{ if(!c.offsetParent && c.tagName!=='svg') return; const q=c.getBoundingClientRect(); if(q.width===0) return;
      if (q.right>r.right+1 || q.left<r.left-1) out.push(sel+' #'+i+': '+c.tagName+'.'+c.className+' вылезает ('+Math.round(q.right-r.right)+'px)'); });
    tiles.slice(i+1).forEach((u,j)=>{ const s=u.getBoundingClientRect(); if (r.left<s.right-1 && s.left<r.right-1 && r.top<s.bottom-1 && s.top<r.bottom-1) out.push(sel+' #'+i+' накладывается на #'+(i+j+1)); }); });
  return [tiles.length, out.slice(0,6)]; }"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        for W in (1440, 1000):
            pg=await b.new_page(viewport={'width':W,'height':900}); await pg.add_init_script(path='mock5.js'); await pg.add_init_script(path='ov8.js')
            errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://127.0.0.1:8781/app2/index.html'); await pg.wait_for_timeout(800)
            E=pg.evaluate
            L=json.dumps(LONG)
            await E("(L)=>{ var o=A.artistPage; A.artistPage=function(n,i){ return o(n,i).then(function(r){ r.ym.albums.forEach(function(a){a.title=L}); r.ym.similar=[{id:'9',name:L},{id:'8',name:'Ещё один исполнитель с очень длинным именем группы'}]; r.ym.name='Исполнитель с очень длинным именем, которое не помещается никуда вообще'; r.lf.tags=['очень длинный жанровый тег номер один','post-punk','new wave','russian rock','soviet','80s']; return r; }); };"
                    "var s=A.ymSearch; A.ymSearch=function(q){ return s(q).then(function(r){ r.playlists=[{src:'ym',type:'playlist',uid:'1',kind:'2',title:L,author:L,count:12,thumb:''},{src:'ym',type:'playlist',uid:'1',kind:'3',title:L,author:'x',count:3,thumb:''}]; r.artists=[{id:'77',name:'Кино '+L,thumb:''}]; return r; }); };"
                    "stations=[{id:'genre:x',name:L,type:'genre'},{id:'genre:y',name:'Кино Кино Кино Кино Кино Кино Кино Кино Кино',type:'genre'}]; }", LONG)
            await pg.fill('#search','Кино'); await pg.press('#search','Enter'); await pg.wait_for_timeout(700)
            for sel in ['.plc', '.wpill', '.art', '.row']:
                print(W, sel, await E(CHECK, sel))
            await pg.screenshot(path=f'g_search_{W}.png')
            await E("openArtistPage('Кино','77')"); await pg.wait_for_timeout(700)
            print(W, '.arh', await E(CHECK, '.arh'), await E(CHECK, '.ar-tags span'))
            await pg.click('.ar-tabs [data-apt=album]'); await pg.wait_for_timeout(200)
            print(W, '.alc', await E(CHECK, '.alc'))
            await E("$('searchPl').scrollTop=99999"); await pg.wait_for_timeout(100)
            await pg.screenshot(path=f'g_albums_{W}.png')
            print(W, 'alc boxes', await E("Array.from(document.querySelectorAll('.alc')).map(a=>{var r=a.getBoundingClientRect(), b=a.querySelector('b').getBoundingClientRect(); return [Math.round(r.left),Math.round(r.width),Math.round(r.height),Math.round(b.width), a.querySelector('b').scrollWidth]})"))
            await pg.click('.ar-tabs [data-apt=similar]'); await pg.wait_for_timeout(200)
            print(W, '.ar-simc', await E(CHECK, '.ar-simc'))
            await E("localCreate("+L+",[])"); await E("setTab('my')"); await pg.wait_for_timeout(400)
            print(W, '.mit', await E(CHECK, '.mit'))
            print(W, 'ошибки:', errs)
            await pg.close()
        await b.close()
asyncio.run(main()); srv.terminate()
