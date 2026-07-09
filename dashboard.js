const $=(id)=>document.getElementById(id);
let page=1,total=0,limit=25,records=[];let currentRecord=null;
const fields=['search','dateFrom','dateTo','carrier','driver','equipment','direction','loadType','assignedTo','assignmentStatus'];
const EDITABLE={driver_name:'Driver Name',driver_phone:'Phone',driver_license:'License',driver_email:'Email',carrier_name:'Carrier',usdot:'USDOT / MC',vehicle_type:'Vehicle Type',license_plate:'Plate',equipment_type:'Equipment Type',equipment_no:'Trailer / Container',entry_task:'Entry Task',direction:'Direction',reference_no:'Reference #',load_no:'PO / RN / Load #',receipt_id:'Receipt ID',po_no:'PO #',load_id:'Load ID',wms_load_no:'WMS Load #',customer:'Customer',customer_id:'Customer ID',customer_code:'Customer Code',door_assignment:'Door Assignment',comments:'Comments'};
function getOwnerToken(){let token=localStorage.getItem('ownerChangeToken')||'';if(!token){token=prompt('Owner change password required')||'';if(token)localStorage.setItem('ownerChangeToken',token)}return token}
function clearOwnerToken(){localStorage.removeItem('ownerChangeToken')}
function ownerHeaders(extra={}){return {...extra,'X-Admin-Change-Token':getOwnerToken()}}
async function parseOwnerResponse(resp){const result=await resp.json().catch(()=>({}));if(resp.status===403||resp.status===503){clearOwnerToken();throw new Error(result.error||'Not authorized to make changes')}return result}
const LABELS={created_at:'Date',et_number:'ET #',driver_name:'Driver',driver_phone:'Phone',driver_license:'License',driver_email:'Email',carrier_name:'Carrier',usdot:'USDOT / MC',vehicle_type:'Vehicle Type',license_plate:'Plate',equipment_type:'Equipment Type',equipment_no:'Trailer / Container',entry_task:'Entry Task',load_type_group:'Load Type',direction:'Direction',reference_no:'Reference #',load_no:'PO / RN / Load #',receipt_id:'Receipt ID',po_no:'PO #',load_id:'Load ID',wms_load_no:'WMS Load #',customer:'Customer',customer_id:'Customer ID',customer_code:'Customer Code',door_assignment:'Door Assignment',comments:'Comments',assigned_to:'Assigned To',assignment_status:'Assignment Status',assignment_notes:'Assignment Notes',assigned_at:'Assigned At',photo_count:'Photos',identity_url:'Identity Link',basic_info_attached:'Basic Info Attached',trip_info_attached:'Trip Info Attached',email_notification_sent:'Email Sent',status:'Status',updated_at:'Last Updated',updated_by:'Updated By',update_notes:'Update Notes'};
function params(extra={}){const p=new URLSearchParams({page,limit,...extra});for(const f of fields){if($(f).value)p.set(f,$(f).value)}return p}
async function load(){const [sum,res]=await Promise.all([fetch('/api/checkins/summary').then(r=>r.json()),fetch('/api/checkins?'+params()).then(r=>r.json())]);$('total').textContent=sum.total||0;$('today').textContent=sum.today||0;$('inbound').textContent=sum.inbound||0;$('outbound').textContent=sum.outbound||0;records=res.data||[];total=res.total||0;render()}
function fmt(d){return d?new Date(d).toLocaleString():''}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function statusPill(status){const colors={Unassigned:'#3a3d50',Assigned:'#1e3a5f','In Progress':'#1e4a2e',Completed:'#1a3a1a','On Hold':'#4a3a1a'};return `<span class="pill" style="background:${colors[status]||'#202541'}">${esc(status||'Unassigned')}</span>`}
function render(){$('count').textContent=`${total} Valley View records`;$('pageInfo').textContent=`Page ${page} of ${Math.max(1,Math.ceil(total/limit))}`;$('rows').innerHTML=records.length?records.map((r,i)=>`<tr><td>${fmt(r.created_at)}</td><td>${esc(r.et_number)}</td><td>${esc(r.driver_name)}</td><td>${esc(r.carrier_name)}</td><td>${esc(r.equipment_no)}</td><td>${esc(r.load_type_group||r.entry_task)}</td><td><span class="pill">${esc(r.direction)}</span></td><td>${esc(r.load_no||r.receipt_id||r.po_no||r.reference_no)}</td><td>${esc(r.customer)}</td><td>${esc(r.door_assignment)}</td><td>${esc(r.assigned_to||'')}</td><td>${statusPill(r.assignment_status)}</td><td><button onclick="detail(${i})">Review</button></td></tr>`).join(''):`<tr><td colspan="13" class="empty">No Valley View check-ins found.</td></tr>`}
function fillAssignment(r){$('asgTo').value=r.assigned_to||'';$('asgStatus').value=r.assignment_status||'Unassigned';$('asgNotes').value=r.assignment_notes||'';$('asgMsg').textContent=''}
function showView(){if(!currentRecord)return;$('detailBody').hidden=false;$('editBody').hidden=true;$('editFooter').hidden=true;$('editBtn').hidden=false;$('detailTitle').textContent='Check-In Details';$('editStatus').hidden=true;const r=currentRecord;$('detailBody').innerHTML=Object.entries(LABELS).map(([k,l])=>{let val=k==='created_at'||k==='updated_at'||k==='assigned_at'?fmt(r[k]):esc(r[k]);if(k==='identity_url'&&r[k])val=`<a href="${esc(r[k])}" target="_blank" style="color:#9b7cff">Open</a>`;return `<div><b>${l}</b><span>${val||'—'}</span></div>`}).join('');fillAssignment(r)}
function showEdit(){if(!currentRecord)return;$('detailBody').hidden=true;$('editBody').hidden=false;$('editFooter').hidden=false;$('editBtn').hidden=true;$('detailTitle').textContent='Edit Check-In';$('editStatus').hidden=true;$('editNotes').value='';const r=currentRecord;$('editBody').innerHTML=Object.entries(EDITABLE).map(([k,label])=>{const val=esc(r[k]||'');if(k==='direction')return `<label><span>${label}</span><select data-field="${k}"><option value="outbound" ${val==='outbound'?'selected':''}>Outbound</option><option value="inbound" ${val==='inbound'?'selected':''}>Inbound</option></select></label>`;return `<label><span>${label}</span><input data-field="${k}" value="${val}"/></label>`}).join('')}
function detail(i){currentRecord=records[i];showView();$('detail').showModal()}
async function saveEdit(){const els=$('editBody').querySelectorAll('[data-field]');const fields={};for(const el of els){const key=el.dataset.field;if(el.value!==(currentRecord[key]||''))fields[key]=el.value}if(!Object.keys(fields).length){showStatus('No changes detected.','error');return}$('saveBtn').disabled=true;try{const resp=await fetch(`/api/checkins/${currentRecord.id}`,{method:'PATCH',headers:ownerHeaders({'Content-Type':'application/json'}),body:JSON.stringify({fields,updatedBy:'ops-dashboard',updateNotes:$('editNotes').value})});const result=await parseOwnerResponse(resp);if(!resp.ok){showStatus(result.error||'Save failed.','error');return}showStatus(result.localUpdated?(result.wiseUpdated?'Saved and WISE updated.':`Local record saved. ${result.message||'WISE update not confirmed.'}`):'Update failed.',result.localUpdated&&result.wiseUpdated?'success':(result.localUpdated?'partial':'error'));if(result.record)currentRecord=result.record;load()}catch(err){showStatus(err.message||'Network error. Please try again.','error')}finally{$('saveBtn').disabled=false}}
function showStatus(msg,type){const el=$('editStatus');el.hidden=false;el.className='editStatus '+type;el.textContent=msg}
$('saveAssignment').onclick=async()=>{if(!currentRecord)return;const body={assignedTo:$('asgTo').value.trim(),assignmentStatus:$('asgStatus').value,assignmentNotes:$('asgNotes').value.trim(),assignedBy:'dashboard'};$('saveAssignment').disabled=true;$('asgMsg').textContent='Saving...';try{const res=await fetch(`/api/checkins/${currentRecord.id}/assignment`,{method:'PATCH',headers:ownerHeaders({'Content-Type':'application/json'}),body:JSON.stringify(body)});const data=await parseOwnerResponse(res);if(data.updated){$('asgMsg').textContent='Assignment saved.';$('asgMsg').style.color='#4ade80';Object.assign(currentRecord,{assigned_to:body.assignedTo,assignment_status:body.assignmentStatus,assignment_notes:body.assignmentNotes});load()}else{$('asgMsg').textContent=data.error||'Update failed.';$('asgMsg').style.color='#f87171'}}catch(err){$('asgMsg').textContent=err.message||'Network error.';$('asgMsg').style.color='#f87171'}$('saveAssignment').disabled=false};
$('editBtn').onclick=()=>showEdit();$('cancelBtn').onclick=()=>showView();$('saveBtn').onclick=()=>saveEdit();$('apply').onclick=()=>{page=1;load()};$('clear').onclick=()=>{fields.forEach(f=>$(f).value='');page=1;load()};$('prev').onclick=()=>{if(page>1){page--;load()}};$('next').onclick=()=>{if(page<Math.ceil(total/limit)){page++;load()}};$('export').onclick=()=>{location.href='/api/checkins/export?'+params({page:1,limit:10000})};$('close').onclick=()=>{$('detail').close();showView()};

let wiseOperators=[];
async function loadOperators(){
  try{const res=await fetch('/api/wise-operators');const data=await res.json();wiseOperators=data.operators||[];const sel=$('wiseOperator');sel.innerHTML=wiseOperators.length?'<option value="">Select operator...</option>'+wiseOperators.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}${o.email?' ('+esc(o.email)+')':''}</option>`).join(''):'<option value="">No operators available</option>'}catch{$('wiseOperator').innerHTML='<option value="">Operator list unavailable</option>'}
}
function fillTaskPanel(r){
  $('taskDockId').value=r.dock_id||'';
  const sel=$('wiseOperator');
  if(r.wise_operator_id){const exists=[...sel.options].some(o=>o.value===r.wise_operator_id);if(!exists&&r.wise_operator_name){const opt=document.createElement('option');opt.value=r.wise_operator_id;opt.textContent=r.wise_operator_name;sel.appendChild(opt)}sel.value=r.wise_operator_id}else{sel.value=''}
  let info='';
  if(r.load_task_id)info+=`Task ID: ${r.load_task_id}. `;
  if(r.load_task_status)info+=`Status: ${r.load_task_status}. `;
  if(r.load_task_error)info+=r.load_task_error;
  if(r.direction==='inbound')info='Load tasks are for outbound loads only. Inbound receipts use the receiving workflow.';
  $('taskInfo').textContent=info;$('taskMsg').textContent='';
}

$('generateTask').onclick=async()=>{
  if(!currentRecord)return;
  const operatorId=$('wiseOperator').value;
  const operatorName=$('wiseOperator').selectedOptions[0]?.textContent||'';
  const dockId=$('taskDockId').value.trim();
  if(!operatorId){$('taskMsg').textContent='Please select an operator.';$('taskMsg').style.color='#f87171';return}
  $('generateTask').disabled=true;$('taskMsg').textContent='Creating load task...';$('taskMsg').style.color='#a7adbd';
  try{
    const res=await fetch(`/api/checkins/${currentRecord.id}/load-task`,{method:'POST',headers:ownerHeaders({'Content-Type':'application/json'}),body:JSON.stringify({operatorId,operatorName,dockId})});
    const data=await parseOwnerResponse(res);
    if(data.created){$('taskMsg').textContent=data.message||'Load task created.';$('taskMsg').style.color='#4ade80';currentRecord.load_task_id=data.taskId;currentRecord.load_task_status='created';currentRecord.wise_operator_id=operatorId;currentRecord.wise_operator_name=operatorName;load()}
    else{$('taskMsg').textContent=data.error||'Task creation failed.';$('taskMsg').style.color='#f87171';if(data.error)currentRecord.load_task_error=data.error}
    fillTaskPanel(currentRecord);
  }catch(err){$('taskMsg').textContent=err.message||'Network error.';$('taskMsg').style.color='#f87171'}
  $('generateTask').disabled=false;
};

const origShowView=showView;
showView=function(){origShowView();if(currentRecord)fillTaskPanel(currentRecord)};
loadOperators();load();
