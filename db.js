const { Pool } = require('pg');

let pool;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

async function initDb() {
  const p = getPool();
  if (!p) { console.log('[DB] DATABASE_URL not configured; dashboard will show no stored records.'); return false; }
  await p.query(`CREATE TABLE IF NOT EXISTS checkins (
    id SERIAL PRIMARY KEY,
    et_number TEXT, driver_first_name TEXT, driver_last_name TEXT, driver_name TEXT,
    driver_phone TEXT, driver_license TEXT, driver_email TEXT,
    carrier_name TEXT, usdot TEXT, vehicle_type TEXT, license_plate TEXT,
    equipment_type TEXT, equipment_no TEXT, entry_task TEXT, load_type_group TEXT,
    reference_no TEXT, load_no TEXT, comments TEXT, customer TEXT, customer_id TEXT, customer_code TEXT,
    direction TEXT, receipt_id TEXT, po_no TEXT, load_id TEXT, wms_load_no TEXT,
    door_assignment TEXT, has_driver_photo BOOLEAN DEFAULT false, has_equipment_photo BOOLEAN DEFAULT false,
    has_load_photo BOOLEAN DEFAULT false, photo_count INTEGER DEFAULT 0, identity_url TEXT,
    basic_info_attached BOOLEAN DEFAULT false, trip_info_attached BOOLEAN DEFAULT false,
    email_notification_sent BOOLEAN DEFAULT false, status TEXT DEFAULT 'completed', raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await p.query('CREATE INDEX IF NOT EXISTS idx_checkins_created_at ON checkins(created_at DESC)');
  await p.query('CREATE INDEX IF NOT EXISTS idx_checkins_search ON checkins USING gin (to_tsvector(\'english\', coalesce(driver_name,\'\') || \' \' || coalesce(carrier_name,\'\') || \' \' || coalesce(equipment_no,\'\') || \' \' || coalesce(et_number,\'\') || \' \' || coalesce(load_no,\'\') || \' \' || coalesce(reference_no,\'\')))');
  // Audit columns for edit capability
  await p.query(`ALTER TABLE checkins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
  await p.query(`ALTER TABLE checkins ADD COLUMN IF NOT EXISTS updated_by TEXT`);
  await p.query(`ALTER TABLE checkins ADD COLUMN IF NOT EXISTS update_notes TEXT`);
  console.log('[DB] checkins table ready');
  return true;
}

function loadTypeGroup(entryTask='') {
  const t = entryTask.toLowerCase();
  if (t.includes('drop')) return 'drop';
  if (t.includes('preload') || t.includes('pickup empty')) return 'preload pickup';
  if (t.includes('live') || t.includes('pick up')) return 'live pickup';
  return '';
}

async function insertCheckin(r) {
  const p = getPool();
  if (!p) return null;
  const vals = [
    r.etNumber, r.driverFirstName, r.driverLastName, r.driverName, r.driverPhone, r.driverLicense, r.driverEmail,
    r.carrierName, r.usdot, r.vehicleType, r.licensePlate, r.equipmentType, r.equipmentNo, r.entryTask,
    r.loadTypeGroup || loadTypeGroup(r.entryTask), r.referenceNo, r.loadNo, r.comments, r.customer, r.customerId, r.customerCode,
    r.direction, r.receiptId, r.poNo, r.loadId, r.wmsLoadNo, r.doorAssignment, !!r.hasDriverPhoto, !!r.hasEquipmentPhoto,
    !!r.hasLoadPhoto, r.photoCount || 0, r.identityUrl, !!r.basicInfoAttached, !!r.tripInfoAttached, !!r.emailNotificationSent,
    r.status || 'completed', JSON.stringify(r.raw || r)
  ];
  const sql = `INSERT INTO checkins (et_number,driver_first_name,driver_last_name,driver_name,driver_phone,driver_license,driver_email,carrier_name,usdot,vehicle_type,license_plate,equipment_type,equipment_no,entry_task,load_type_group,reference_no,load_no,comments,customer,customer_id,customer_code,direction,receipt_id,po_no,load_id,wms_load_no,door_assignment,has_driver_photo,has_equipment_photo,has_load_photo,photo_count,identity_url,basic_info_attached,trip_info_attached,email_notification_sent,status,raw) VALUES (${vals.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`;
  const result = await p.query(sql, vals);
  return result.rows[0].id;
}

function buildWhere(q) {
  const c=[]; const v=[]; const add=(expr,val)=>{v.push(val); c.push(expr.replace('?', '$'+v.length));};
  if (q.search) add(`(et_number ILIKE ? OR driver_name ILIKE ? OR carrier_name ILIKE ? OR equipment_no ILIKE ? OR customer ILIKE ? OR reference_no ILIKE ? OR load_no ILIKE ? OR po_no ILIKE ? OR receipt_id ILIKE ?)`, `%${q.search}%`), v.push(...Array(8).fill(`%${q.search}%`)), c[c.length-1]=c[c.length-1].replace(/\?/g,()=>'$'+(v.length-8+arguments.callee.i++));
  return {c,v};
}

async function queryCheckins(q={}) {
  const p = getPool(); if (!p) return {data:[], total:0, page:1, limit:25};
  const page=Math.max(1, parseInt(q.page||'1',10)); const limit=Math.min(200, Math.max(1, parseInt(q.limit||'25',10)));
  const cond=[]; const params=[]; const add=(sql,val)=>{params.push(val); cond.push(sql.replace('?', '$'+params.length));};
  if(q.search){ const fields=['et_number','driver_name','carrier_name','equipment_no','customer','reference_no','load_no','po_no','receipt_id']; const parts=[]; for(const f of fields){params.push(`%${q.search}%`); parts.push(`${f} ILIKE $${params.length}`);} cond.push('('+parts.join(' OR ')+')'); }
  if(q.dateFrom) add('created_at >= ?', q.dateFrom);
  if(q.dateTo) add(`created_at < (?::date + interval '1 day')`, q.dateTo);
  if(q.carrier) add('carrier_name ILIKE ?', `%${q.carrier}%`);
  if(q.driver) add('driver_name ILIKE ?', `%${q.driver}%`);
  if(q.equipment) add('equipment_no ILIKE ?', `%${q.equipment}%`);
  if(q.direction) add('direction = ?', q.direction);
  if(q.loadType) add('load_type_group = ?', q.loadType);
  const where=cond.length?'WHERE '+cond.join(' AND '):'';
  const total=Number((await p.query(`SELECT COUNT(*) count FROM checkins ${where}`, params)).rows[0].count);
  params.push(limit, (page-1)*limit);
  const data=(await p.query(`SELECT * FROM checkins ${where} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params)).rows;
  return {data,total,page,limit};
}
async function getSummary(){ const p=getPool(); if(!p) return {total:0,today:0,inbound:0,outbound:0}; const r=(await p.query(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE created_at>=CURRENT_DATE) today, COUNT(*) FILTER (WHERE direction='inbound') inbound, COUNT(*) FILTER (WHERE direction='outbound') outbound FROM checkins`)).rows[0]; return Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Number(v)])); }

async function getCheckinById(id) {
  const p = getPool(); if (!p) return null;
  const result = await p.query('SELECT * FROM checkins WHERE id = $1', [id]);
  return result.rows[0] || null;
}

const EDITABLE_FIELDS = [
  'driver_first_name','driver_last_name','driver_name','driver_phone','driver_license','driver_email',
  'carrier_name','usdot','vehicle_type','license_plate','equipment_type','equipment_no',
  'entry_task','load_type_group','reference_no','load_no','comments','customer','customer_id','customer_code',
  'direction','receipt_id','po_no','load_id','wms_load_no','door_assignment'
];

async function updateCheckin(id, fields, updatedBy, updateNotes) {
  const p = getPool(); if (!p) return null;
  const sets = []; const vals = []; let idx = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (!EDITABLE_FIELDS.includes(key)) continue;
    sets.push(`${key} = $${idx}`); vals.push(value); idx++;
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);
  if (updatedBy) { sets.push(`updated_by = $${idx}`); vals.push(updatedBy); idx++; }
  if (updateNotes) { sets.push(`update_notes = $${idx}`); vals.push(updateNotes); idx++; }
  vals.push(id);
  const sql = `UPDATE checkins SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
  const result = await p.query(sql, vals);
  return result.rows[0] || null;
}

module.exports={initDb,insertCheckin,queryCheckins,getSummary,getCheckinById,updateCheckin,loadTypeGroup,EDITABLE_FIELDS};
