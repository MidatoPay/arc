// Read-only local checks. No fetch, install, cleanup, staging, commit or push.
import {spawnSync} from 'node:child_process';
import {realpathSync,statfsSync,readFileSync} from 'node:fs';
import {dirname,resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{repo:{type:'string'},json:{type:'boolean',default:false}}});
const repo=realpathSync(values.repo || resolve(dirname(fileURLToPath(import.meta.url)),'../../../..'));
const git=args=>spawnSync('git',['--no-optional-locks','-c',`safe.directory=${repo.replaceAll('\\','/')}`,'-C',repo,...args],
 {encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const required=args=>{
 const result=git(args);
 if(result.status!==0)throw new Error(`No se pudo ejecutar git ${args[0]} (exit ${result.status ?? 'unavailable'}).`);
 return result.stdout;
};

try {
 const top=realpathSync(required(['rev-parse','--show-toplevel']).trim());
 if(top!==repo)throw new Error('La ruta indicada debe ser la raíz del repositorio Git.');
 const branch=required(['branch','--show-current']).trim() || '(detached HEAD)';
 const records=required(['status','--porcelain=v1','-z','--untracked-files=normal']).split('\0');
 const changes=[];
 for(let i=0;i<records.length;i++){
  if(!records[i])continue;
  const code=records[i].slice(0,2),path=records[i].slice(3);
  changes.push({code,path});
  if(/[RC]/.test(code))i++; // Porcelain -z adds the original path for renames/copies.
 }
 const staged=required(['diff','--cached','--name-only','--diff-filter=ACMR','-z']).split('\0').filter(Boolean);
 const blockers=[],warnings=[];
 const sensitive=staged.filter(path=>{
  const normalized=path.replaceAll('\\','/'),name=posix.basename(normalized).toLowerCase();
  return (name.startsWith('.env') && !name.endsWith('.example')) ||
   /(?:^|\/)(?:\.netlify|\.aws)(?:\/|$)/i.test(normalized) ||
   /\.(?:key|p12|pfx)$/i.test(name) || /^(?:id_rsa|id_ed25519|treasury-devnet\.json)$/i.test(name);
 });
 if(sensitive.length)blockers.push({code:'sensitive_staged_paths',paths:sensitive});
 const whitespace=git(['diff','--cached','--check']);
 if(whitespace.status!==0)blockers.push({code:'staged_diff_check_failed',details:whitespace.stdout.trim() || 'git diff --cached --check no pudo completarse'});
 const unstagedWhitespace=git(['diff','--check']);
 if(unstagedWhitespace.status!==0)warnings.push('Hay whitespace pendiente fuera del diff preparado; revisar sólo las rutas del trabajo actual.');
 let freeMiB=null;
 try{const fs=statfsSync(repo);freeMiB=Math.floor(fs.bavail*fs.bsize/1024/1024);}catch{warnings.push('No se pudo consultar el espacio libre.');}
 if(freeMiB!==null && freeMiB<512)warnings.push('Menos de 512 MiB libres: revisar espacio antes de build/Functions. Este umbral es una advertencia, no un requisito de Solana.');
 const remote=git(['rev-list','--left-right','--count','HEAD...origin/main']);
 let remoteMain=null;
 if(remote.status===0){
  const [ahead,behind]=remote.stdout.trim().split(/\s+/).map(Number);remoteMain={ahead,behind,fetched:false};
  if(behind)warnings.push(`HEAD está ${behind} commits detrás del origin/main local; integrar y volver a verificar antes de publicar.`);
 }else warnings.push('No hay comparación con origin/main disponible.');
 const paths=changes.map(change=>change.path);
 const code=paths.some(path=>/^(?:src|netlify|db)\//.test(path));
 const startup=paths.some(path=>/^src\/(?:App\.jsx|merchantProfile\.js|primaryWallet\.js|main\.jsx|TreasuryWalletExport\.jsx)$/.test(path));
 const backend=paths.some(path=>/^netlify\//.test(path));
 let manifestRuntimeChanged=false;
 if(paths.includes('package.json')){
  try{
   const baseline=JSON.parse(required(['show','HEAD:package.json']));
   const indexResult=git(['show',':package.json']);
   const manifests=[JSON.parse(readFileSync(resolve(repo,'package.json'),'utf8'))];
   if(indexResult.status===0)manifests.push(JSON.parse(indexResult.stdout));
   const keys=['dependencies','devDependencies','optionalDependencies','peerDependencies','overrides','engines','type','exports'];
   manifestRuntimeChanged=manifests.some(manifest=>keys.some(key=>JSON.stringify(manifest[key])!==JSON.stringify(baseline[key])));
  }catch{manifestRuntimeChanged=true;warnings.push('Revisar package.json: no se pudo comparar su configuración con HEAD.');}
 }
 const dependencies=manifestRuntimeChanged || paths.some(path=>/^(?:package-lock\.json|vite\.config\.js|netlify\.toml)$/.test(path));
 const suggested=[];
 if(startup)suggested.push('node --test test/app-startup.test.js');
 if(code)suggested.push('Elegir tests del comportamiento cambiado; suite en ambas redes si afecta dinero/red.');
 if(code||dependencies)suggested.push('npm run build');
 if(backend||dependencies)suggested.push('npm run functions:check si cambia backend/bundling; ejecutar secuencialmente.');
 if(!code&&!dependencies)suggested.push('Validar documentación/skill/helpers afectados; no se requiere una suite de pagos sólo por Markdown.');
 const report={readOnly:true,repo,branch,node:process.versions.node,changes,staged,freeMiB,remoteMain,blockers,warnings,suggested};
 if(values.json)console.log(JSON.stringify(report,null,2));
 else {
  console.log(`Preflight de sólo lectura: ${branch}; Node ${report.node}; libre ${freeMiB ?? '?'} MiB.`);
  console.log(`${changes.length} rutas cambiadas; ${staged.length} preparadas. No se consultó la red.`);
  for(const path of staged)console.log(`  preparado: ${path}`);
  for(const item of blockers)console.log(`BLOQUEO ${item.code}: ${item.paths?.join(', ') || item.details}`);
  for(const warning of warnings)console.log(`AVISO: ${warning}`);
  for(const check of suggested)console.log(`VERIFICAR: ${check}`);
 }
 process.exitCode=blockers.length?1:0;
}catch(error){console.error(error.message);process.exitCode=1;}
