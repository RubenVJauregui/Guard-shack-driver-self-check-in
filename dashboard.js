const $=(id)=>document.getElementById(id);
let page=1,total=0,limit=25,records=[];
let currentRecord=null,editMode=false;
const fields=['search','dateFrom','dateTo','carrier','driver','equipment','direction','loadType'];

const EDITABLE = {
  driver_name:'Driver Name',driver_phone:'Phone',driver_license:'License',driver_email:'Email',
  carrier_name:'Carrier',usdot:'USDOT / MC',vehicle_type:'Vehicle Type',license_plate:'Plate',
  equipment_type:'Equipment Type',equipment_no:'Trailer / Container',entry_task:'Entry Task',
  direction:'Direction',reference_no:'Reference #',load_no:'PO / RN / Load #',
  receipt_id:'Receipt ID',po_no:'PO #',load_id:'Load ID',wms_load_no:'WMS Load #',
  customer:'Customer',customer_id:'Customer ID',customer_code:'Customer Code',
  door_assignment:'Door Assignment',comments:'Comments'
};

const READONLY_LABELS = {
  created_at:'Date',et_number:'ET #',driver_name:'Driver',driver_first_name:'First Name',driver_last_name:'Last Name',
  driver_phone:'Phone',driver_license:'License',driver_email:'Email',carrier_name:'Carrier',usdot:'USDOT / MC',
  vehicle_type:'Vehicle Type',license_plate:'Plate',equipment_type:'Equipment Type',equipment_no:'Trailer / Container',
  entry_task:'Entry Task',load_type_group:'Load Type',direction:'Direction',reference_no:'Reference #',
  load_no:'PO / RN / Load #',receipt_id:'Receipt ID',po_no:'PO #',load_id:'Load ID',wms_load_no:'WMS Load #',
  customer:'Customer',customer_id:'Customer ID',customer_code:'Customer Code',door_assignment:'Door Assignment',
  comments:'Comments',photo_count:'Photos',identity_url:'Identity Link',basic_info_attached:'Basic Info Attached',
  trip_info_attached:'Trip Info Attached',email_notification_sent:'Email Sent',status:'Status',
  updated_at:'Last Updated',updated_by:'Updated By',update_notes:'Update Notes'
};

function params(extra={}){const p=new URLSearchParams({page,limit,...extra});for(const f of fields){if($(f).value)p.set(f,$(f).value)}return p}

async function load(){
  const [sum,res]=await Promise.all([fetch('/api/checkins/summary').then(r=>r.json()),fetch('/api/checkins?'+params()).then(r=>r.json())]);
  $('total').textContent=sum.total||0;$('today').textContent=sum.today||0;
  $('inbound').textContent=sum.inbound||0;$('outbound').textContent=sum.outbound||0;
  records=res.data||[];total=res.total||0;render();
}

function fmt(d){return d?new Date(d).toLocaleString():''}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

function render(){
  $('count').textContent=`${total} records`;
  $('pageInfo').textContent=`Page ${page} of ${Math.max(1,Math.ceil(total/limit))}`;
  $('rows').innerHTML=records.length?records.map((r,i)=>`<tr>
    <td>${fmt(r.created_at)}</td><td>${esc(r.et_number)}</td><td>${esc(r.driver_name)}</td>
    <td>${esc(r.carrier_name)}</td><td>${esc(r.equipment_no)}</td>
    <td>${esc(r.load_type_group||r.entry_task)}</td><td><span class="pill">${esc(r.direction)}</span></td>
    <td>${esc(r.load_no||r.receipt_id||r.po_no||r.reference_no)}</td><td>${esc(r.customer)}</td>
    <td>${esc(r.door_assignment)}</td><td><button onclick="detail(${i})">Review</button></td>
  </tr>`).join(''):`<tr><td colspan="11" class="empty">No check-ins found.</td></tr>`;
}

function showView(){
  editMode=false;
  $('detailBody').hidden=false;$('editBody').hidden=true;$('editFooter').hidden=true;
  $('editBtn').hidden=false;$('editBtn').textContent='Edit';
  $('detailTitle').textContent='Check-In Details';
  $('editStatus').hidden=true;
  const r=currentRecord;
  $('detailBody').innerHTML=Object.entries(READONLY_LABELS).map(([k,l])=>{
    let val=k==='created_at'||k==='updated_at'?fmt(r[k]):esc(r[k]);
    if(k==='identity_url'&&r[k])val=`<a href="${esc(r[k])}" target="_blank" style="color:#9b7cff">Open</a>`;
    return `<div><b>${l}</b><span>${val||'—'}</span></div>`;
  }).join('');
}

function showEdit(){
  editMode=true;
  $('detailBody').hidden=true;$('editBody').hidden=false;$('editFooter').hidden=false;
  $('editBtn').hidden=true;
  $('detailTitle').textContent='Edit Check-In';
  $('editStatus').hidden=true;$('editNotes').value='';
  const r=currentRecord;
  $('editBody').innerHTML=Object.entries(EDITABLE).map(([k,label])=>{
    const val=esc(r[k]||'');
    if(k==='direction') return `<label><span>${label}</span><select data-field="${k}"><option value="outbound" ${val==='outbound'?'selected':''}>Outbound</option><option value="inbound" ${val==='inbound'?'selected':''}>Inbound</option></select></label>`;
    if(k==='vehicle_type') return `<label><span>${label}</span><select data-field="${k}"><option value="Tractor" ${val==='Tractor'?'selected':''}>Tractor</option><option value="Box Truck" ${val==='Box Truck'?'selected':''}>Box Truck</option><option value="Car" ${val==='Car'?'selected':''}>Car</option></select></label>`;
    if(k==='equipment_type') return `<label><span>${label}</span><select data-field="${k}"><option value="Trailer" ${val==='Trailer'?'selected':''}>Trailer</option><option value="Container" ${val==='Container'?'selected':''}>Container</option><option value="Chassis" ${val==='Chassis'?'selected':''}>Chassis</option><option value="Flatbed" ${val==='Flatbed'?'selected':''}>Flatbed</option></select></label>`;
    return `<label><span>${label}</span><input data-field="${k}" value="${val}"/></label>`;
  }).join('');
}

function detail(i){
  currentRecord=records[i];
  showView();
  $('detail').showModal();
}

async function saveEdit(){
  const els=$('editBody').querySelectorAll('[data-field]');
  const fields={};
  for(const el of els){
    const key=el.dataset.field;
    const newVal=el.value;
    if(newVal!==(currentRecord[key]||''))fields[key]=newVal;
  }
  if(Object.keys(fields).length===0){
    showStatus('No changes detected.','error');return;
  }
  $('saveBtn').disabled=true;$('saveBtn').textContent='Saving...';
  try{
    const resp=await fetch(`/api/checkins/${currentRecord.id}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fields,updatedBy:'ops-dashboard',updateNotes:$('editNotes').value})
    });
    const result=await resp.json();
    if(!resp.ok){showStatus(result.error||'Save failed.','error');return;}
    if(result.localUpdated&&result.wiseUpdated){
      showStatus(`Saved. ${result.message}`,'success');
    } else if(result.localUpdated&&!result.wiseUpdated){
      showStatus(`Local record saved. ${result.message}`,'partial');
    } else {
      showStatus(result.message||'Update failed.','error');
    }
    if(result.record)currentRecord=result.record;
    load();
  }catch(err){
    showStatus('Network error. Please try again.','error');
  }finally{
    $('saveBtn').disabled=false;$('saveBtn').textContent='Save Changes';
  }
}

function showStatus(msg,type){
  const el=$('editStatus');el.hidden=false;el.className='editStatus '+type;el.textContent=msg;
}

$('editBtn').onclick=()=>showEdit();
$('cancelBtn').onclick=()=>showView();
$('saveBtn').onclick=()=>saveEdit();
$('apply').onclick=()=>{page=1;load()};
$('clear').onclick=()=>{fields.forEach(f=>$(f).value='');page=1;load()};
$('prev').onclick=()=>{if(page>1){page--;load()}};
$('next').onclick=()=>{if(page<Math.ceil(total/limit)){page++;load()}};
$('export').onclick=()=>{location.href='/api/checkins/export?'+params({page:1,limit:10000})};
$('close').onclick=()=>{$('detail').close();showView()};
load();
