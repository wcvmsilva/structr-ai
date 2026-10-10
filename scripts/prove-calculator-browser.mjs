/** Run only against calculator-browser-lab's owned loopback listener.
 * Playwright is an operator/test runtime dependency, not shipped with the product.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const origin = process.argv[2];
const parsed = new URL(origin);
assert.equal(parsed.protocol, 'http:'); assert.equal(parsed.hostname, '127.0.0.1');
assert.equal(parsed.origin, origin); assert(parsed.port); assert.equal(parsed.username + parsed.password + parsed.search + parsed.hash, '');
const require = createRequire(process.env.CALCULATOR_BROWSER_PLAYWRIGHT_MODULE || import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pair = { projectId: 'c3000000-0000-4000-8000-000000000004', intakeFormId: 'c3000000-0000-4000-8000-000000000005' };
const url = `${origin}/calculator?${new URLSearchParams(pair)}`;
const cases = [];
const readEvidence = async () => { const response = await fetch(`${origin}/_lab/evidence`); assert(response.ok); return response.json(); };
async function control(path) { const response = await fetch(`${origin}/_lab/${path}`, { method: 'POST' }); assert(response.ok); }
async function open() {
 const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
 const page = await context.newPage();
 await page.goto(url); await page.getByRole('checkbox', { name: 'A', exact: true }).waitFor();
 return { page, context };
}
async function simulation(page, name = 'A') {
 await page.getByRole('checkbox', { name, exact: true }).check();
 await page.getByRole('button', { name: 'Calculate', exact: true }).click();
 await page.locator('#calculator-confirm').waitFor();
}
const creates = evidence => evidence.commands.filter(command => command.operation === 'calculator.create');
async function sameCounts(before) { assert.deepEqual((await readEvidence()).counts, before.counts); }
try {
 for (const [name, cost, price, warn] of [['A','$40.00','$100.00',false],['B','$60.00','$90.00',true],['C','$0.01','$0.01',true]]) {
  const {page,context} = await open();
  try {
   const before = await readEvidence(); await simulation(page, name);
   const totals = page.locator('[aria-label="Calculation result"] dl dd');
   assert.equal(await totals.nth(0).innerText(), cost); assert.equal(await totals.nth(1).innerText(), price);
   assert.equal(await page.getByRole('alert').count(), Number(warn));
   assert.equal(await page.getByRole('button', {name:'Save draft',exact:true}).isEnabled(), false);
   await page.locator('#calculator-confirm').check();
   // Two synchronous real DOM click events must produce one immutable request.
   await page.getByRole('button', {name:'Save draft',exact:true}).evaluate(button => {button.click();button.click();});
   await page.locator('#calculator-draft-id').waitFor();
   const requestId = await page.locator('#calculator-request-id').innerText();
   const after = await readEvidence();
   assert.deepEqual(after.counts,{drafts:before.counts.drafts+1,requests:before.counts.requests+1,audits:before.counts.audits+1});
   assert.equal(creates(after).filter(command=>command.requestId===requestId).length,1);
   if (name==='C') await page.screenshot({path:'/private/tmp/calculator-browser-c-confirmed.png',fullPage:true});
   cases.push({case:`${name}: exact displayed cents, explicit confirmation and double-click single audit`,status:'passed'});
  } finally {await context.close();}
 }
 {
  const {page,context}=await open();
  try {
   await simulation(page); await page.locator('#calculator-confirm').check();
   const before=await readEvidence(); await control('lose-next-create');
   await page.getByRole('button',{name:'Save draft',exact:true}).click();
   await page.getByText('Save outcome is not confirmed.',{exact:false}).waitFor();
   const requestId=await page.locator('#calculator-request-id').innerText();
   const afterLoss=await readEvidence();
   assert.deepEqual(afterLoss.counts,{drafts:before.counts.drafts+1,requests:before.counts.requests+1,audits:before.counts.audits+1});
   await page.reload(); await page.locator('#calculator-request-id').waitFor();
   assert.equal(await page.locator('#calculator-request-id').innerText(),requestId);
   await page.waitForLoadState('networkidle');
   assert.equal(creates(await readEvidence()).length,creates(afterLoss).length);
   await page.getByRole('button',{name:'Check saved result',exact:true}).click();
   await page.locator('#calculator-draft-id').waitFor();
   const draftId=await page.locator('#calculator-draft-id').innerText();
   await sameCounts(afterLoss);
   await page.screenshot({path:'/private/tmp/calculator-browser-recovered.png',fullPage:true});
   cases.push({case:'Committed response lost: reload preserves request, explicit recovery, no repeat create',status:'passed'});
   // Expiry is local retention only. Manual lookup never repeats the writer.
   await page.evaluate(()=>{const key='structr-calculator-intent-v1';const value=JSON.parse(sessionStorage.getItem(key));value.createdAt=Date.now()-86400001;value.expiresAt=value.createdAt+86400000;sessionStorage.setItem(key,JSON.stringify(value));});
   await page.reload(); await page.locator('#calculator-recovery-request').waitFor();
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('structr-calculator-intent-v1')),null);
   await page.locator('#calculator-recovery-request').fill(requestId);
   await page.getByRole('button',{name:'Check saved result',exact:true}).click();
   await page.locator('#calculator-draft-id').waitFor();
   assert.equal(await page.locator('#calculator-draft-id').innerText(),draftId);
   await sameCounts(afterLoss);
   cases.push({case:'Expired local intent removed; manual recorded request lookup returns original draft',status:'passed'});
  } finally {await context.close();}
 }
 {
  const {page,context}=await open();
  try {
   await simulation(page); await page.locator('#calculator-confirm').check();
   const before=await readEvidence(); await control('price/101');
   await page.getByRole('button',{name:'Save draft',exact:true}).click();
   await page.getByText('Sources changed.',{exact:false}).waitFor();
   assert.equal(await page.locator('#calculator-confirm').count(),0);
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('structr-calculator-intent-v1')),null);
   await sameCounts(before);
   await page.getByRole('button',{name:'Calculate',exact:true}).click();await page.locator('#calculator-confirm').waitFor();
   assert.equal(await page.locator('[aria-label="Calculation result"] dl dd').nth(1).innerText(),'$101.00');
   assert.equal(await page.locator('#calculator-confirm').isChecked(),false);
   assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isEnabled(),false);
   cases.push({case:'Changed physical price refuses save with no writes; recalculation requires a fresh confirmation',status:'passed'});
  } finally {await control('price/100');await context.close();}
 }
 {
  const {page,context}=await open();
  try {
   const before=await readEvidence(), requested=[];
   page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/trpc/'))requested.push(...path.slice('/api/trpc/'.length).split(','));});
   await page.goto(`${origin}/calculator`);
   await page.getByText('Open a project and intake link',{exact:false}).waitFor();
   await page.waitForLoadState('networkidle');
   assert.deepEqual((await readEvidence()).commands,before.commands);await sameCounts(before);
   assert(requested.every(path=>path==='auth.session'||path==='auth.me'),JSON.stringify(requested));
   cases.push({case:'Missing pair mounts no global project/catalog requests',status:'passed'});
  } finally{await context.close();}
 }
 {
  const context=await browser.newContext();
  const pages=[await context.newPage(),await context.newPage()];
  try {
   await Promise.all(pages.map(async page=>{await page.goto(url);await page.getByRole('checkbox',{name:'A',exact:true}).waitFor();await simulation(page);await page.locator('#calculator-confirm').check();}));
   const before=await readEvidence();await control('lose-next-create');
   await Promise.all(pages.map(page=>page.getByRole('button',{name:'Save draft',exact:true}).click()));
   await Promise.all(pages.map(async page=>{
    // A request ID appears before COMMIT. Await a settled response before inspecting counts.
    await page.locator('#calculator-draft-id').or(page.getByText('Save outcome is not confirmed.',{exact:false})).waitFor();
    await page.locator('#calculator-request-id').waitFor();
   }));
   const ids=await Promise.all(pages.map(page=>page.locator('#calculator-request-id').innerText()));
   assert.notEqual(ids[0],ids[1]);
   const after=await readEvidence();
   assert.deepEqual(after.counts,{drafts:before.counts.drafts+2,requests:before.counts.requests+2,audits:before.counts.audits+2});
   for(let index=0;index<2;index++){
    await pages[index].reload();await pages[index].locator('#calculator-request-id').waitFor();
    assert.equal(await pages[index].locator('#calculator-request-id').innerText(),ids[index]);
    await pages[index].getByRole('button',{name:'Check saved result',exact:true}).click();await pages[index].locator('#calculator-draft-id').waitFor();
   }
   assert.notEqual(await pages[0].locator('#calculator-draft-id').innerText(),await pages[1].locator('#calculator-draft-id').innerText());
   await pages[1].goto(`${origin}/calculator`);await pages[1].getByText('Open a project and intake link',{exact:false}).waitFor();
   await pages[0].reload();await pages[0].locator('#calculator-request-id').waitFor();
   assert.equal(await pages[0].locator('#calculator-request-id').innerText(),ids[0]);
   await sameCounts(after);
   cases.push({case:'Two explicit tab saves keep separate immutable requests through response loss/reload; other tab pair cleanup cannot erase recovery',status:'passed'});
  } finally{await context.close();}
 }
 {
  const {page,context}=await open(); let release,blocked,delivered;
  const responseReady=new Promise(resolve=>{blocked=resolve}); const continueResponse=new Promise(resolve=>{release=resolve});
  const responseDelivered=new Promise(resolve=>{delivered=resolve});
  try {
   const before=await readEvidence();
   await page.route('**/api/trpc/assembly.calculateBatch**',async route=>{const response=await route.fetch();blocked();await continueResponse;try{await route.fulfill({response});delivered(true);}catch{delivered(false);}});
   const requestFinished=page.waitForEvent('requestfinished',{predicate:request=>new URL(request.url()).pathname.includes('/api/trpc/assembly.calculateBatch'),timeout:15000});
   await page.getByRole('checkbox',{name:'A',exact:true}).check();
   await page.getByRole('button',{name:'Calculate',exact:true}).click();await responseReady;
   await page.evaluate(()=>window.__calculatorLabSignOut());
   release();assert.equal(await responseDelivered,true);await requestFinished;
   // Observe React after the held response actually finished in the browser.
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.getByRole('heading',{name:'Calculator',exact:true}).waitFor();
   assert.equal(await page.locator('#calculator-confirm').count(),0);
   assert.equal(await page.locator('#calculator-draft-id').count(),0);
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('structr-calculator-intent-v1')),null);
   await sameCounts(before);
   cases.push({case:'Logout while real calculation response is held clears UI and ignores late response',status:'passed'});
  } finally{release?.();await context.close();}
 }
 const result={browser:browser.version(),cases,caseCount:cases.length,evidence:await readEvidence(),limitations:['Synthetic SDK and web bootstrap; executor fetch wire in memory','No hosted Auth/PostgREST bootstrap, network TLS or socket loss during COMMIT proved']};
 const output=JSON.stringify(result,null,2);console.log(output);
 if(process.env.CALCULATOR_BROWSER_EVIDENCE_PATH)await writeFile(process.env.CALCULATOR_BROWSER_EVIDENCE_PATH,output+'\n');
} finally {await browser.close();}
