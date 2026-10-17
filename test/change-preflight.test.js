import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';

const script=resolve('.agents/skills/midatopay-dev-release/scripts/preflight.mjs');
async function fixture(t){
 const artifacts=resolve('.netlify');await mkdir(artifacts,{recursive:true});
 const dir=await mkdtemp(resolve(artifacts,'preflight-test-'));
 t.after(async()=>{
  const parent=await realpath(artifacts),target=await realpath(dir);
  if(!target.startsWith(parent+sep) || !target.slice(parent.length+1).startsWith('preflight-test-'))throw new Error('Unexpected fixture cleanup path');
  await rm(target,{recursive:true,force:true});
 });
 const git=args=>{
  const result=spawnSync('git',['-c',`safe.directory=${dir.replaceAll('\\','/')}`,'-c','user.name=Preflight Fixture',
   '-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c',`core.hooksPath=${resolve(dir,'.git/no-hooks')}`,'-C',dir,...args],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);return result.stdout;
 };
 git(['init','--initial-branch=main']);
 await writeFile(resolve(dir,'package.json'),JSON.stringify({name:'fixture',type:'module',scripts:{test:'node --test'},dependencies:{}})+'\n');
 git(['add','package.json']);git(['commit','-m','fixture baseline']);
 return {dir,git,run:()=>spawnSync(process.execPath,[script,'--repo',dir,'--json'],{encoding:'utf8',windowsHide:true})};
}

test('preflight preserves Git state and avoids build recommendations for script-only metadata',async t=>{
 const {dir,git,run}=await fixture(t);
 await writeFile(resolve(dir,'package.json'),JSON.stringify({name:'fixture',type:'module',scripts:{test:'node --test',preflight:'node helper.mjs'},dependencies:{}})+'\n');
 await writeFile(resolve(dir,'guide with spaces.md'),'A documentation change.\n');git(['add','package.json','guide with spaces.md']);
 const before={head:git(['rev-parse','HEAD']),index:git(['write-tree']),status:git(['status','--porcelain=v1','-z'])};
 const result=run();assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.equal(report.readOnly,true);assert.ok(report.staged.includes('guide with spaces.md'));
 assert.ok(!report.suggested.includes('npm run build'));
 assert.deepEqual({head:git(['rev-parse','HEAD']),index:git(['write-tree']),status:git(['status','--porcelain=v1','-z'])},before);
});

test('preflight blocks staged production environment files without exposing their contents or altering the index',async t=>{
 const {dir,git,run}=await fixture(t);
 const marker='fixture-private-value-not-a-real-credential';
 await writeFile(resolve(dir,'.env.production'),`PRIVATE_VALUE=${marker}\n`);
 await writeFile(resolve(dir,'.env.production.example'),'PRIVATE_VALUE=\n');
 git(['add','.env.production','.env.production.example']);const before=git(['write-tree']);
 const result=run();assert.equal(result.status,1,result.stderr);
 assert.ok(!result.stdout.includes(marker));assert.ok(!result.stderr.includes(marker));
 const report=JSON.parse(result.stdout);
 assert.deepEqual(report.blockers.find(item=>item.code==='sensitive_staged_paths').paths,['.env.production']);
 assert.equal(git(['write-tree']),before);
});
