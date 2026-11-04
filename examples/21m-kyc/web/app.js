const $=id=>document.getElementById(id);
const schemas=await fetch('/schemas.json').then(r=>r.json());
const config=await fetch('/config').then(r=>r.json());
$('status').textContent=config.ready?'Clave de staging cargada · Listo para probar':'Falta una clave nx_test_ en el .env. Reiniciá el servidor después de configurarla.';
const labels={fiscal_id:'CUIT / CUIL',first_name:'Nombre',last_name:'Apellido',email:'Email',country:'País',tin:'CUIT / CUIL (igual al alta)',issuing_country:'País emisor del documento',document_type:'Tipo de documento',document_number:'Número de documento',nationality:'Nacionalidad',date_of_birth:'Fecha de nacimiento',phone_country_code:'Código telefónico de país',phone_number:'Teléfono',address:'Domicilio',address_line_1:'Calle y número',address_line_2:'Piso / departamento',city:'Ciudad',state:'Provincia (ej. AR-C)',post_code:'Código postal',occupation_code:'Ocupación',account_purpose_code:'Finalidad de la cuenta',monthly_salary_ars:'Ingresos mensuales en ARS',expected_monthly_volume_ars:'Volumen mensual estimado en ARS',company_name:'Razón social',tax_id:'CUIT de la empresa',beneficial_owners:'Beneficiarios finales'};
function resolve(s){if(s.$ref)s={...schemas[s.$ref.split('/').pop()],...s};if(s.anyOf)s={...s,...s.anyOf.find(x=>x.type!=='null')};return s;}
function fields(parent,s,prefix=''){
 s=resolve(s);for(const [name,raw] of Object.entries(s.properties||{})){
  if(name==='verification_type')continue;
  const prop=resolve(raw),path=prefix+name,required=(s.required||[]).includes(name);
  if(prop.type==='object'){const box=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=labels[name]||name;box.append(legend);const grid=document.createElement('div');grid.className='grid';box.append(grid);parent.append(box);fields(grid,prop,path+'.');continue;}
  const label=document.createElement('label');label.textContent=(labels[name]||name.replaceAll('_',' '))+(required?' *':'');
  let el=document.createElement(prop.enum||prop.type==='boolean'?'select':prop.type==='array'?'textarea':'input');
  if(el.tagName==='SELECT'){el.add(new Option('Seleccionar…',''));for(const v of prop.enum||[true,false])el.add(new Option(String(v),String(v)));}
  else if(prop.type==='array'){el.placeholder=JSON.stringify(prop.items?.enum?[prop.items.enum[0]]:[{}]);}
  else {el.type=prop.format==='date'?'date':name.includes('email')?'email':prop.type==='integer'||prop.type==='number'?'number':'text';if(el.type==='number')el.step='any';}
  el.name=path;el.required=required;el.dataset.kind=prop.type||'string';if(prop.default!==undefined)el.value=String(prop.default);if(prop.minLength)el.minLength=prop.minLength;if(prop.maxLength)el.maxLength=prop.maxLength;
  label.append(el);if(prop.description){const small=document.createElement('small');small.textContent=prop.description;label.append(small);}parent.append(label);
 }
}
function render(){for(const id of ['customerFields','kycFields'])$(id).replaceChildren();fields($('customerFields'),schemas.PartnerEndUserCreate);fields($('kycFields'),schemas[$('type').value==='individual'?'PartnerIndividualKYCSubmit':'PartnerCompanyKYBSubmit']);}
function read(form){const out={};for(const el of form.elements){if(!el.name||el.value==='')continue;let v=el.value;if(el.dataset.kind==='array')v=JSON.parse(v);if(el.dataset.kind==='boolean')v=v==='true';if(['number','integer'].includes(el.dataset.kind))v=Number(v);let node=out;const parts=el.name.split('.');for(const p of parts.slice(0,-1))node=node[p]??={};node[parts.at(-1)]=v;}return out;}
function display(data){$('result').textContent=JSON.stringify(data,null,2);}
async function call(action,body){
 document.querySelectorAll('button').forEach(b=>b.disabled=true);$('message').textContent='Procesando…';
 try{const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-local-token':config.token},body:JSON.stringify({action,body,customerId:$('customerId').value.trim(),fiscalId:read($('customer')).fiscal_id})});const data=await response.json();display(data);if(!response.ok)throw new Error(`Error ${response.status}. Revisá el detalle debajo.`);$('message').textContent='Pedido completado.';if(action==='create'&&data.customer_id)$('customerId').value=data.customer_id;
 if(action==='status'||action==='session'){const link=data.onboarding?.identity?.url||data.url;$('identity').replaceChildren();if(link&&new URL(link).protocol==='https:'){const a=document.createElement('a');a.href=link;a.target='_blank';a.rel='noreferrer';a.textContent='Abrir verificación de identidad';$('identity').append(a);} $('rails').textContent=JSON.stringify({onboarding:data.onboarding,rails:data.rails},null,2);}
 }catch(e){$('message').textContent=e.message;}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
$('type').onchange=render;
$('customer').onsubmit=e=>{e.preventDefault();call('create',{...read($('customer')),verification_type:$('type').value});};
$('kyc').onsubmit=e=>{e.preventDefault();try{call($('type').value,read($('kyc')));}catch(err){$('message').textContent=err.message;}};
$('preview').onclick=()=>{try{display({customer:{...read($('customer')),verification_type:$('type').value},kyc:read($('kyc'))});$('message').textContent='Vista previa local. No se enviaron datos.';}catch(e){$('message').textContent='Revisá el JSON de los campos de listas: '+e.message;}};
$('find').onclick=()=>call('find');$('check').onclick=()=>call('status');$('session').onclick=()=>call('session');render();
