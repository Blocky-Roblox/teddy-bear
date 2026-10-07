from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import math
import os

URL=os.environ.get('TEDDY_TEST_URL','http://127.0.0.1:4173/')
OUTPUT=Path(os.environ.get('TEDDY_TEST_OUTPUT','/tmp/teddy-browser-checks'))
OUTPUT.mkdir(parents=True,exist_ok=True)
HTML=Path(__file__).resolve().parents[1]/'index.html'
errors=[];passed=[]
def check(name,value=True):
 assert value,name
 passed.append(name);print('PASS',name,flush=True)
def point(page,id,offset=[0,0,.15]):
 page.locator('#world').scroll_into_view_if_needed()
 return page.locator('#world').evaluate('(el, p)=>el.projectPart(p.id,p.offset)',{'id':id,'offset':offset})
def state(page):return page.locator('#world').evaluate('(el)=>el.getPlushState()')
def details(page):return page.locator('#world').evaluate('(el)=>el.getPlushDetails()')
def pos(snapshot,id):return next(p['position'] for p in snapshot if p['id']==id)
def dist(a,b):return math.sqrt(sum((x-y)**2 for x,y in zip(a,b)))
def bind(page):
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 page.goto(URL,wait_until='load');expect(page.locator('#stage')).to_have_attribute('data-ready','true',timeout=30000)

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
 desktop=browser.new_context(viewport={'width':1440,'height':1100},device_scale_factor=.5)
 page=desktop.new_page();bind(page)
 info=details(page)
 check('3D plush loads with 12 independent bodies and 11 joints',info['bodyCount']==12 and info['jointCount']==11)
 check('real strand geometry is present at the adapter-appropriate density',info['fiberCount']>(5000 if info['renderQuality']=='software' else 40000))
 check('lifeless toy UI replaces speech and emotion actions',page.locator('#speech,#eyes-happy,[data-action="sleep"],[data-action="tickle"]').count()==0)
 for id,offset in [('head',[0,.1,.5]),('earL',[0,0,.15]),('handL',[0,-.1,.22]),('footR',[0,0,.30])]:
  page.locator('#reset-button').click();page.wait_for_timeout(250)
  before=state(page);hit=point(page,id,offset)
  page.mouse.move(hit['x'],hit['y']);page.mouse.down()
  expect(page.locator('#stage')).to_have_attribute('data-held',id)
  page.mouse.move(hit['x']+60,hit['y']-95,steps=6);page.wait_for_timeout(300)
  held=state(page)
  check(id+' can be grabbed from its actual visible surface',dist(pos(held,id),pos(before,id))>.12)
  check(id+' drag keeps every sewn joint connected',max(details(page)['jointErrors'])<.2)
  if id=='handL':page.screenshot(path=str(OUTPUT/'plush-hanging.png'),full_page=True)
  page.mouse.up();expect(page.locator('#stage')).to_have_attribute('data-held','')
  released=state(page);page.wait_for_timeout(250)
  check(id+' release resumes gravity',dist(pos(state(page),id),pos(released,id))>.03)
 page.locator('#reset-button').click();page.wait_for_timeout(300)
 page.locator('.mode-button[data-mode="press"]').click()
 before=state(page);hit=point(page,'head',[0,.1,.5]);page.mouse.move(hit['x'],hit['y']);page.mouse.down()
 expect(page.locator('#stage')).to_have_attribute('data-held','head');page.wait_for_timeout(700);page.mouse.up()
 check('press applies force to the articulated toy',dist(pos(state(page),'head'),pos(before,'head'))>.05)
 before=state(page);page.locator('[data-action="toss"]').click();page.wait_for_timeout(180)
 check('toss moves the weighted toy upward',pos(state(page),'torso')[1]>pos(before,'torso')[1]+.08)
 camera=details(page)['camera'];page.locator('[data-action="view"]').click()
 check('view button rotates camera without a scripted bear pose',dist(camera,details(page)['camera'])>1)
 page.locator('#softness').focus();page.keyboard.press('End')
 expect(page.locator('#softness-label')).to_have_text('鬆軟');check('softness responds to keyboard slider input')
 page.locator('#sound-button').click();expect(page.locator('#sound-button')).to_have_attribute('aria-pressed','true');check('physical collision sound can be enabled')
 page.locator('#help-button').click();expect(page.locator('#help-dialog')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#help-dialog')).not_to_be_visible();check('guide is keyboard accessible')
 page.keyboard.press('3');expect(page.locator('#stage')).to_have_attribute('data-mode','view')
 page.keyboard.press('r');expect(page.locator('#stage')).to_have_attribute('data-mode','grab');check('keyboard modes and reset work')
 page.wait_for_timeout(1200);page.screenshot(path=str(OUTPUT/'plush-desktop.png'),full_page=True)
 desktop.close()

 mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=.6,is_mobile=True,has_touch=True)
 phone=mobile.new_page();bind(phone)
 info=details(phone)
 check('mobile loads a suitably sized fur model',info['fiberCount']>(5000 if info['renderQuality']=='software' else 20000))
 check('mobile layout has no horizontal overflow',phone.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 hit=point(phone,'head',[0,.1,.5]);cdp=mobile.new_cdp_session(phone)
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':hit['x'],'y':hit['y'],'id':1}]})
 expect(phone.locator('#stage')).to_have_attribute('data-held','head')
 for i in range(1,7):
  cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':hit['x']+5*i,'y':hit['y']-10*i,'id':1}]});phone.wait_for_timeout(40)
 cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});expect(phone.locator('#stage')).to_have_attribute('data-held','');check('actual touchscreen grab, drag and release work')
 phone.locator('#reset-button').click();phone.wait_for_timeout(200)
 left=point(phone,'handL',[0,-.1,.22]);right=point(phone,'handR',[0,-.1,.22])
 touches=[{'x':left['x'],'y':left['y'],'id':1},{'x':right['x'],'y':right['y'],'id':2}]
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':touches})
 expect(phone.locator('#stage')).to_have_attribute('data-held','handL,handR')
 for i in range(1,5):
  moved=[{'x':left['x']-3*i,'y':left['y']-14*i,'id':1},{'x':right['x']+3*i,'y':right['y']-14*i,'id':2}]
  cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':moved});phone.wait_for_timeout(60)
 check('two fingers independently hold the two hands',max(details(phone)['jointErrors'])<.2)
 cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]});expect(phone.locator('#stage')).to_have_attribute('data-held','');check('touch cancellation releases both grabs')
 phone.locator('#reset-button').click();phone.wait_for_timeout(700);phone.screenshot(path=str(OUTPUT/'plush-mobile.png'),full_page=True)
 phone.set_viewport_size({'width':320,'height':700});phone.wait_for_timeout(100);check('small-phone resizing preserves the room layout',phone.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 mobile.close()
 offline=browser.new_context(offline=True,viewport={'width':1000,'height':900},device_scale_factor=.5)
 local=offline.new_page();local.on('pageerror',lambda e:errors.append(str(e)))
 local.set_content(HTML.read_text(),wait_until='load');expect(local.locator('#stage')).to_have_attribute('data-ready','true',timeout=30000)
 local.locator('[data-action="toss"]').click();check('built HTML initializes and interacts without a network connection')
 check('browser reports no JavaScript or shader errors',not errors)
 print('Completed',len(passed),'browser checks; errors:',errors,flush=True)
 browser.close()
