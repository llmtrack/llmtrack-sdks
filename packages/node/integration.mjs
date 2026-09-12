import { randomUUID } from 'node:crypto';
import { LLMtrack } from './dist/index.js';

const apiKey = process.env.LLMTRACK_API_KEY;
if (!apiKey) {
  console.error('FAIL setup: LLMTRACK_API_KEY is required');
  process.exit(1);
}

let failures = 0;
async function check(name, operation) {
  try { await operation(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error?.message ?? error}`); }
}
const event = {provider:'openai', model:'gpt-4o-mini', promptTokens:2, completionTokens:1, reasoningTokens:1, feature:'sdk-integration'};
const client = new LLMtrack({apiKey});

await check('happy path with reasoning tokens', async()=>{ const result=await client.trackSync(event); if(!result) throw Error('empty response'); });
await check('invalid key is reported and track never throws', async()=>{
  const error = new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(Error('onError timeout')),7000); new LLMtrack({apiKey:'invalid-integration-key',maxRetries:1,onError:e=>{clearTimeout(timer);resolve(e);}}).track(event); });
  const result=await error; if(result.code!=='INVALID_API_KEY') throw Error(`unexpected ${result.code}`);
});
await check('free-plan visibility warning', async()=>{
  const warnings=[]; const c=new LLMtrack({apiKey,environment:`sdk-mismatch-${randomUUID()}`,onWarning:w=>warnings.push(w)});
  await c.trackSync(event); if(!warnings.some(w=>w.code==='NOT_DASHBOARD_VISIBLE')) throw Error('API did not return dashboard_visible=false; use a free-plan test key bound to another environment');
});
await check('unknown-model pricing warning', async()=>{
  const warnings=[]; const c=new LLMtrack({apiKey,onWarning:w=>warnings.push(w)});
  await c.trackSync({...event,model:`unknown-integration-${randomUUID()}`}); if(!warnings.some(w=>w.code==='UNKNOWN_MODEL')) throw Error('missing UNKNOWN_MODEL warning');
});
await check('oversized metadata is rejected client-side', async()=>{ try{await client.trackSync({...event,metadata:{value:'x'.repeat(8193)}});}catch(e){if(e.code==='INVALID_PAYLOAD')return;}throw Error('expected INVALID_PAYLOAD'); });
await check('negative tokens are rejected client-side', async()=>{ try{await client.trackSync({...event,promptTokens:-1});}catch(e){if(e.code==='INVALID_PAYLOAD')return;}throw Error('expected INVALID_PAYLOAD'); });
await check('same idempotency key is a successful duplicate', async()=>{const key=randomUUID();await client.trackSync({...event,idempotencyKey:key});const second=await client.trackSync({...event,idempotencyKey:key});if(second.duplicate!==true)throw Error('second response was not duplicate');});
await check('unreachable network failure is reported without throwing', async()=>{
  const error=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('onError timeout')),3000);new LLMtrack({apiKey,baseUrl:'http://127.0.0.1:1',timeoutMs:250,maxRetries:1,onError:e=>{clearTimeout(timer);resolve(e);}}).track(event);});
  const result=await error;if(result.code!=='NETWORK_ERROR')throw Error(`unexpected ${result.code}`);
});
process.exitCode = failures ? 1 : 0;
