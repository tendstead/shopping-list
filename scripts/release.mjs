import {readFileSync, appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function releaseLabel(labels){const found=labels.filter(l=>['patch','minor','major'].includes(l));if(found.length>1)throw new Error('Choose exactly one release label: patch, minor, or major');return found[0]||null}
function versionParts(v){if(!/^\d+\.\d+\.\d+$/.test(v))throw new Error(`Invalid version: ${v}`);const p=v.split('.').map(Number);if(p.some(n=>!Number.isSafeInteger(n)))throw new Error('Version exceeds safe integer range');return p}
export function nextVersion(v,bump){let [major,minor,patch]=versionParts(v);if(bump==='patch')patch++;else if(bump==='minor'){minor++;patch=0}else if(bump==='major'){major++;minor=0;patch=0}else throw new Error('Invalid release bump');return `${major}.${minor}.${patch}`}
function compare(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]-y[i]};return 0}
export async function allocateVersion(repository,pr){
 for(let attempt=0;attempt<20;attempt++){
  const records=await repository.list();const existing=records.find(r=>r.pr===pr.number);if(existing){if(existing.sha!==pr.sha)throw new Error('Allocated PR commit changed');return existing}
  const bump=releaseLabel(pr.labels);if(!bump)return null;const baseline=records.reduce((v,r)=>compare(r.version,v)>0?r.version:v,'0.0.0');const record={pr:pr.number,sha:pr.sha,bump,version:nextVersion(baseline,bump)};
  if(await repository.create(record))return record;
 };throw new Error('Concurrent release allocation did not settle. Retry the workflow')
}
export async function publishRelease(record,publisher){if(!record)return;await publisher.image(record);await publisher.release(record)}
async function main(){
 const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));const repo=process.env.GITHUB_REPOSITORY;const token=process.env.GITHUB_TOKEN;
 if(process.argv.includes('--validate')){releaseLabel((event.pull_request?.labels||[]).map(l=>l.name));return}

 if(!repo||!token)throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
 const api=async(path,method='GET',body)=>{const response=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(response.status===404)return null;if(!response.ok){const err=new Error(`GitHub API ${method} ${path}: ${response.status}`);err.status=response.status;throw err};return response.status===204?null:response.json()};
 const number=event.pull_request?.number||Number(process.env.PR_NUMBER);if(!Number.isInteger(number)||number<1)throw new Error('A merged PR number is required');const pr=await api(`/pulls/${number}`);const meta=await api('');if(!pr?.merged||pr.base.ref!==meta.default_branch)throw new Error('Only merged PRs targeting the default branch can release');
 if(process.argv.includes('--target')){const labels=pr.labels.map(l=>l.name);releaseLabel(labels);const refs=await api('/git/matching-refs/tags/v')||[];let allocated=false;for(const ref of refs){if(ref.object.type!=='tag')continue;const tag=await api(`/git/tags/${ref.object.sha}`);if(tag.message.includes(`\"pr\":${number},`)){allocated=true;break}};appendFileSync(process.env.GITHUB_OUTPUT,`sha=${pr.merge_commit_sha}\nrelease=${Boolean(releaseLabel(labels)||allocated)}\n`);return}
 const repository={async list(){const refs=await api('/git/matching-refs/tags/v')||[];const records=[];for(const ref of refs){const version=ref.ref.replace('refs/tags/v','');if(!/^\d+\.\d+\.\d+$/.test(version))continue;if(ref.object.type==='tag'){const tag=await api(`/git/tags/${ref.object.sha}`);const line=tag.message.split('\n').find(line=>line.startsWith('{'));if(line){const record=JSON.parse(line);if(record.version===version&&record.sha===tag.object.sha){records.push(record);continue}}};records.push({version,sha:ref.object.sha,pr:null})};return records},async create(record){const tag=await api('/git/tags','POST',{tag:`v${record.version}`,message:`Shopping list release allocation\n${JSON.stringify(record)}`,object:record.sha,type:'commit'});try{await api('/git/refs','POST',{ref:`refs/tags/v${record.version}`,sha:tag.sha});return true}catch(err){if(err.status===422)return false;throw err}}};
 const record=await allocateVersion(repository,{number,sha:pr.merge_commit_sha,labels:pr.labels.map(l=>l.name)});if(!record){console.log('No release label; no release created');return}
 const image=process.env.DOCKERHUB_IMAGE;if(!image||!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(image))throw new Error('Set DOCKERHUB_IMAGE to namespace/image');
 // Explicitly build the merged commit, even on a workflow rerun after later merges.
 execFileSync('git',['fetch','origin',record.sha],{stdio:'inherit'});execFileSync('git',['checkout','--detach',record.sha],{stdio:'inherit'});
 await publishRelease(record,{async image(r){execFileSync('docker',['buildx','build','--platform','linux/amd64','--label',`org.opencontainers.image.revision=${r.sha}`,'--label',`org.opencontainers.image.version=${r.version}`,'--tag',`${image}:${r.version}`,'--push','.'],{stdio:'inherit'})},async release(r){const existing=await api(`/releases/tags/v${r.version}`);if(existing)return;const notes=await api('/releases/generate-notes','POST',{tag_name:`v${r.version}`,target_commitish:r.sha});await api('/releases','POST',{tag_name:`v${r.version}`,target_commitish:r.sha,name:`v${r.version}`,body:`${notes.body}\n\nDocker image: \`${image}:${r.version}\`\nMerged commit: \`${r.sha}\``,draft:false,prerelease:false})}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1});
