const {chromium}=require('playwright');
(async()=>{
 const health=await (await fetch('http://127.0.0.1:3001/api/health')).json();if(!health.demo)throw Error('Browser smoke test requires isolated DEMO_MODE=true');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3001');await page.getByRole('textbox',{name:'Email',exact:true}).fill('admin@demo.local');await page.getByRole('textbox',{name:'Password',exact:true}).fill('demo-only');await page.getByRole('button',{name:'Sign in →',exact:true}).click();await page.getByText('Your monthly financial pulse').waitFor();
 await page.screenshot({path:'/tmp/swizton-overview.png',fullPage:true});
 for(const name of ['Profit & Loss','Revenue & bills','Expense ledger','Marketing wallet','Analytics','Budget planner','Masters','Month close','Audit trail']){
  await page.locator('nav').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(200);
  if(name==='Profit & Loss'){await page.getByRole('button',{name:'Yearly comparison',exact:true}).click();await page.getByText('Working outlook',{exact:true}).waitFor()}
  if(name==='Revenue & bills'){
   await page.getByRole('button',{name:'+ Add record',exact:true}).click();await page.getByRole('button',{name:'receipt',exact:true}).click();await page.getByRole('textbox',{name:'Patient / reference',exact:true}).fill('Browser synthetic reference');await page.getByLabel('Revenue recognition month (optional)',{exact:true}).fill('2026-07');await page.getByRole('spinbutton',{name:'Receipt · AED',exact:true}).fill('100');await page.getByRole('textbox',{name:'Reason / audit note',exact:true}).fill('Browser sample receipt validation');await page.getByRole('button',{name:'Save record',exact:true}).click();await page.getByRole('status').getByText('Saved successfully',{exact:true}).waitFor();await page.getByRole('combobox',{name:'Month',exact:true}).selectOption('6');await page.getByRole('cell',{name:'Browser synthetic reference',exact:true}).waitFor();await page.getByRole('combobox',{name:'Month',exact:true}).selectOption('5');
  }
  if(name==='Budget planner'){await page.getByRole('button',{name:'Calculate projection',exact:true}).click();await page.getByText('PROJECTED SWIZTON REVENUE',{exact:true}).waitFor()}
  if(name==='Masters'){await page.getByRole('button',{name:'procedures',exact:true}).click();await page.getByRole('cell',{name:'VenaSeal',exact:true}).waitFor()}
  console.log('PASS screen:',name);
 }
 await page.locator('nav').getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:/Swizton Revenue/}).last().click();await page.getByText('SOURCE TRANSACTIONS',{exact:true}).waitFor();await page.locator('.modal .close').click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/swizton-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw Error('Mobile viewport has horizontal overflow');
 if(errors.length)throw Error(errors.join('\n'));console.log('PASS login, receipt creation, source drilldown, budget calculation, mobile layout; no browser errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
