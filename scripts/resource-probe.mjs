const origin=process.env.APP_URL||'http://app:8080';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const controllers=[new AbortController(),new AbortController()];
await Promise.all(controllers.map(async c=>{const response=await fetch(origin+'/api/events',{signal:c.signal});if(!response.ok)throw new Error('SSE unavailable');const reader=response.body.getReader();void(async()=>{try{for(;;){const next=await reader.read();if(next.done)break}}catch{/* probe closes stream */}})()}));
console.log('two SSE clients attached');await pause(12000);
let state=await fetch(origin+'/api/state').then(r=>r.json());const itemId=crypto.randomUUID();
async function apply(values){const op={id:crypto.randomUUID(),tripId:state.tripId,...values};const path=op.kind==='item_add'?'/api/items':'/api/operations';const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});const body=await response.json();if(!response.ok)throw new Error(JSON.stringify(body));state=body.state}
await apply({kind:'item_add',itemId,name:'Resource observation',reusable:true,counter:true});
for(let count=1;count<=20;count++){await apply({kind:'trip_set',itemId,field:'count',base:count-1,value:count});if(count%5===0)await fetch(origin+'/api/state');await pause(100)}
console.log('20 edits and reconnect state fetches completed');await pause(8000);controllers.forEach(c=>c.abort());
