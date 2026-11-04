import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createPushService } from './push-service.mjs';
import { buildReadQuery } from './query-catalog.js';
const token = process.env.KYC_LOCAL_TOKEN || randomBytes(24).toString('hex');
const root = new URL('./', import.meta.url);
export function createServer({ key = process.env.TWENTYONE_API_KEY, upstream = fetch, pushService } = {}) {
 return http.createServer(async (req,res) => {
  const send = (status, data, type='application/json') => {res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(type==='application/json'?JSON.stringify(data):data);};
  try {
   if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host||'')) return send(403,{error:'Host inválido'});
   const url = new URL(req.url,'http://'+req.headers.host);
   if (req.method==='GET' && url.pathname==='/config') return send(200,{token,ready:!!key?.startsWith('nx_test_'),environment:'staging',pushPublicKey:pushService?.publicKey||null});
   if (req.method==='GET' && ['/', '/app.js','/schemas.json','/push.js','/sw.js','/queries.js','/query-catalog.js'].includes(url.pathname)) {
    const file = url.pathname==='/'?'index.html':url.pathname.slice(1);
    return send(200,await readFile(new URL(file,root),'utf8'),file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/plain; charset=utf-8');
   }
   if(req.method!=='POST'||url.pathname!=='/api') return send(404,{error:'No encontrado'});
   if(req.headers['x-local-token']!==token || req.headers.origin!=='http://'+req.headers.host) return send(403,{error:'Origen inválido'});
   let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>150000)return send(413,{error:'Formulario demasiado grande'});}
   const {action,customerId,body,fiscalId,queryName,orderId,filters}=JSON.parse(raw);
   if(action?.startsWith('push-')) {
    if(!pushService)return send(503,{error:'El servidor de notificaciones no está iniciado.'});
    if(action==='push-subscribe')return send(200,await pushService.subscribe(customerId,body?.subscription));
    if(action==='push-unsubscribe')return send(200,await pushService.unsubscribe(body?.endpoint||''));
    if(action==='push-status')return send(200,await pushService.status(customerId,body?.endpoint));
    if(action==='push-test')return send(200,await pushService.test(customerId,body?.endpoint));
    return send(400,{error:'Operación push inválida.'});
   }
   let route;
   if(action==='query') {
    const query=buildReadQuery({queryName,customerId,orderId,filters});
    route=[query.method,query.path];
   } else {
   const id=encodeURIComponent(customerId||'');
   const routes={create:['POST','/customers'],individual:['POST',`/customers/${id}/kyc/individual`],company:['POST',`/customers/${id}/kyc/company`],status:['GET',`/customers/${id}/kyc`],session:['POST',`/customers/${id}/kyc/identity-session`],find:['GET',`/customers?fiscal_id=${encodeURIComponent(fiscalId||'')}`]};
   if(!Object.hasOwn(routes,action)||(!['create','find'].includes(action)&&!customerId))return send(400,{error:'Operación o cliente inválido'});
   route=routes[action];
   }
   if(!key?.startsWith('nx_test_'))return send(400,{error:'Configurá TWENTYONE_API_KEY nx_test_ en el .env de la prueba'});
   const [method,path]=route;
   const response=await upstream('https://api.staging.21millions.com/v1/partner'+path,{method,headers:{'x-api-key':key,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body||{})}:{}),signal:AbortSignal.timeout(30000)});
   const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={error:'Respuesta no JSON de 21Millions'};}
   send(response.status,data);
  }catch(error){send(error.status||502,{error:error.status?error.message:error.cause?.code==='EACCES'?'El servidor local no tiene permiso de red. Inicialo con abrir-web.cmd fuera del sandbox.':error.name==='TimeoutError'?'Tiempo de espera agotado. Si estabas creando un cliente, buscalo por CUIT antes de repetir el alta.':'No se pudo completar el pedido. Revisá la conexión y los datos.'});}
 });
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
 const pushService=await createPushService({directory:process.env.KYC_LAB_DATA_DIR||fileURLToPath(new URL('../.data/',root)),key:process.env.TWENTYONE_API_KEY});
 const server=createServer({pushService});
 server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'El puerto del laboratorio está ocupado. Cerrá la ventana anterior del servidor y volvé a abrir abrir-web.cmd.':error.message);void pushService.stop().finally(()=>process.exit(1));});
 server.listen(Number(process.env.KYC_LAB_PORT||3210),'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${server.address().port}`;
  pushService.start();console.log(`Laboratorio 21Millions: ${url}`);process.send?.({type:'ready',url});
 });
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await pushService.stop();server.close(()=>process.exit(0));});
}
