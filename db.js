const { Pool } = require('pg');

let pool;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

const NON_LINCOLN_DOOR_PATTERNS = ['165', '166', 'dock 2', 'docks 165', 'docks 166', 'dock 45', 'dock 144', 'dock 70'];
const NON_LINCOLN_CUSTOMER_PATTERNS = ['KARAKA', 'SIMPLE MODERN', 'GURUNANDA', 'NZXT', 'CMPC USA', 'WOODY FLAW', 'LENNOX', 'AMIEE LYNN', 'TPV USA', 'EUROMARKET', 'CRATE & BARREL', 'COME READY', 'HINT INC', 'SOURCE86', 'KACE TEA', 'ROAR BEVERAGES', 'WISMETTAC', 'ORGAIN', 'POMPEIAN', 'MAMMA CHIA', 'RISE BEVERAGES', 'ZEN BEVERAGE', 'RST', 'WATER PLUS', 'MUSE ORGANIC', 'NATURAL DECADENCE', 'MELOGRANO', 'SANS WINE', 'UPTIME ENERGY', 'PREFERRED BRANDS', 'RECOVERY SPORTS'];

function lincolnDashboardWhere(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `
    ${p}facility_id = 'LT_F22'
    AND coalesce(${p}door_assignment, '') NOT ILIKE '%Dock 45%'
    AND coalesce(${p}door_assignment, '') NOT ILIKE '%dock 144%'
    AND coalesce(${p}door_assignment, '') NOT ILIKE '%dock 70%'
    AND coalesce(${p}door_assignment, '') NOT ILIKE '%docks 165%'
    AND coalesce(${p}door_assignment, '') NOT ILIKE '%docks 166%'
    AND coalesce(${p}facility_name, '') NOT ILIKE '%Valley View%'
    AND coalesce(${p}customer, '') NOT ILIKE '%KARAKA%'
    AND coalesce(${p}customer, '') NOT ILIKE '%SIMPLE MODERN%'
    AND coalesce(${p}customer, '') NOT ILIKE '%GURUNANDA%'
    AND coalesce(${p}customer, '') NOT ILIKE '%NZXT%'
    AND coalesce(${p}customer, '') NOT ILIKE '%CMPC USA%'
    AND coalesce(${p}customer, '') NOT ILIKE '%WOODY FLAW%'
    AND coalesce(${p}customer, '') NOT ILIKE '%LENNOX%'
    AND coalesce(${p}customer, '') NOT ILIKE '%AMIEE LYNN%'
    AND coalesce(${p}customer, '') NOT ILIKE '%TPV USA%'
    AND coalesce(${p}customer, '') NOT ILIKE '%EUROMARKET%'
  `;
}

function classifyFacility(record) {
  const door = String(record.door_assignment || '').toLowerCase();
  const customer = String(record.customer || '').toUpperCase();
  for (const pat of NON_LINCOLN_DOOR_PATTERNS) {
    if (door.includes(pat)) return 'LEGACY_NON_LINCOLN';
  }
  for (const c of NON_LINCOLN_CUSTOMER_PATTERNS) {
    if (customer.includes(c)) return 'LEGACY_NON_LINCOLN';
  }
  if (!door && !customer) return 'LEGACY_UNVERIFIED';
  const lincolnDoors = ['docks 98', 'docks 97', 'docks 75', 'docks 74', 'docks 56', 'docks 55', 'dock 98'];
  for (const ld of lincolnDoors) {
    if (door.includes(ld)) return 'LT_F22';
  }
  return 'LEGACY_UNVERIFIED';
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
    facility_id TEXT DEFAULT 'LT_F22', facility_name TEXT DEFAULT 'Lincoln',
    assigned_to TEXT, assigned_by TEXT, assigned_at TIMESTAMPTZ,
    assignment_status TEXT DEFAULT 'Unassigned', assignment_notes TEXT,
    updated_at TIMESTAMPTZ, updated_by TEXT, update_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  const migrations = [
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS facility_id TEXT DEFAULT 'LT_F22'",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS facility_name TEXT DEFAULT 'Lincoln'",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS assigned_to TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS assigned_by TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS assignment_status TEXT DEFAULT 'Unassigned'",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS assignment_notes TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS updated_by TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS update_notes TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS wise_operator_id TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS wise_operator_name TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS load_task_id TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS load_task_status TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS load_task_error TEXT",
    "ALTER TABLE checkins ADD COLUMN IF NOT EXISTS dock_id TEXT"
  ];
  for (const sql of migrations) await p.query(sql);
  await p.query('CREATE INDEX IF NOT EXISTS idx_checkins_created_at ON checkins(created_at DESC)');
  await p.query('CREATE INDEX IF NOT EXISTS idx_checkins_facility ON checkins(facility_id)');
  await p.query('CREATE INDEX IF NOT EXISTS idx_checkins_assignment ON checkins(assignment_status)');
  await p.query('CREATE INDEX IF NOT EXISTS idx_checkins_search ON checkins USING gin (to_tsvector(\'english\', coalesce(driver_name,\'\') || \' \' || coalesce(carrier_name,\'\') || \' \' || coalesce(equipment_no,\'\') || \' \' || coalesce(et_number,\'\') || \' \' || coalesce(load_no,\'\') || \' \' || coalesce(reference_no,\'\')))');
  await migrateLegacyRecords(p);
  console.log('[DB] checkins table ready');
  return true;
}

async function migrateLegacyRecords(p) {
  // Quarantine obvious legacy/non-Lincoln records even if a default facility was added later.
  await p.query(`UPDATE checkins SET facility_id='LEGACY_NON_LINCOLN', facility_name='Legacy (non-Lincoln)'
    WHERE facility_id = 'LT_F22' AND (
       door_assignment ILIKE '%165%'
       OR door_assignment ILIKE '%166%'
       OR door_assignment ILIKE '%dock 2%'
       OR door_assignment ILIKE '%dock 45%'
       OR door_assignment ILIKE '%dock 144%'
       OR door_assignment ILIKE '%dock 70%'
       OR facility_name ILIKE '%Valley View%'
       OR customer ILIKE '%KARAKA%'
       OR customer ILIKE '%SIMPLE MODERN%'
       OR customer ILIKE '%GURUNANDA%'
       OR customer ILIKE '%NZXT%'
       OR customer ILIKE '%CMPC USA%'
       OR customer ILIKE '%WOODY FLAW%'
       OR customer ILIKE '%LENNOX%'
       OR customer ILIKE '%AMIEE LYNN%'
       OR customer ILIKE '%TPV USA%'
       OR customer ILIKE '%EUROMARKET%'
       OR customer ILIKE '%CRATE & BARREL%'
    )`);

  // Quarantine specific known non-Lincoln records confirmed as Lincoln LT_F22
  const knownNonLincolnETs = ['ET-1119142', 'ET-1119115', 'ET-1119113', 'ET-1119111'];
  await p.query(`UPDATE checkins SET facility_id='NON_LINCOLN_QUARANTINED', facility_name='Non-Lincoln (quarantined)'
    WHERE et_number = ANY($1) AND facility_id = 'LT_F22'`, [knownNonLincolnETs]);

  const unclassified = await p.query("SELECT id, door_assignment FROM checkins WHERE facility_id IS NULL OR facility_id = ''");
  for (const row of unclassified.rows) {
    const facility = classifyFacility(row);
    const name = facility === 'LT_F22' ? 'Lincoln' : (facility === 'LEGACY_NON_LINCOLN' ? 'Legacy (non-Lincoln)' : 'Legacy (unverified)');
    await p.query('UPDATE checkins SET facility_id=$1, facility_name=$2 WHERE id=$3', [facility, name, row.id]);
  }
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
    r.status || 'completed', JSON.stringify(r.raw || r), 'LT_F22', 'Lincoln'
  ];
  const sql = `INSERT INTO checkins (et_number,driver_first_name,driver_last_name,driver_name,driver_phone,driver_license,driver_email,carrier_name,usdot,vehicle_type,license_plate,equipment_type,equipment_no,entry_task,load_type_group,reference_no,load_no,comments,customer,customer_id,customer_code,direction,receipt_id,po_no,load_id,wms_load_no,door_assignment,has_driver_photo,has_equipment_photo,has_load_photo,photo_count,identity_url,basic_info_attached,trip_info_attached,email_notification_sent,status,raw,facility_id,facility_name) VALUES (${vals.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`;
  const result = await p.query(sql, vals);
  return result.rows[0].id;
}

async function queryCheckins(q={}) {
  const p = getPool(); if (!p) return {data:[], total:0, page:1, limit:25};
  const page=Math.max(1, parseInt(q.page||'1',10)); const limit=Math.min(200, Math.max(1, parseInt(q.limit||'25',10)));
  const cond=[]; const params=[];
  const add=(sql,val)=>{params.push(val); cond.push(sql.replace('?', '$'+params.length));};
  if (q.includeLegacy !== 'true') cond.push(`(${lincolnDashboardWhere()})`);
  else add('facility_id = ?', 'LT_F22');
  if(q.search){ const fields=['et_number','driver_name','carrier_name','equipment_no','customer','reference_no','load_no','po_no','receipt_id']; const parts=[]; for(const f of fields){params.push(`%${q.search}%`); parts.push(`${f} ILIKE $${params.length}`);} cond.push('('+parts.join(' OR ')+')'); }
  if(q.dateFrom) add('created_at >= ?', q.dateFrom);
  if(q.dateTo) add(`created_at < (?::date + interval '1 day')`, q.dateTo);
  if(q.carrier) add('carrier_name ILIKE ?', `%${q.carrier}%`);
  if(q.driver) add('driver_name ILIKE ?', `%${q.driver}%`);
  if(q.equipment) add('equipment_no ILIKE ?', `%${q.equipment}%`);
  if(q.direction) add('direction = ?', q.direction);
  if(q.loadType) add('load_type_group = ?', q.loadType);
  if(q.assignedTo) add('assigned_to ILIKE ?', `%${q.assignedTo}%`);
  if(q.assignmentStatus) add('assignment_status = ?', q.assignmentStatus);
  const where=cond.length?'WHERE '+cond.join(' AND '):'';
  const total=Number((await p.query(`SELECT COUNT(*) count FROM checkins ${where}`, params)).rows[0].count);
  params.push(limit, (page-1)*limit);
  const data=(await p.query(`SELECT * FROM checkins ${where} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params)).rows;
  return {data,total,page,limit};
}

async function getSummary(){ const p=getPool(); if(!p) return {total:0,today:0,inbound:0,outbound:0}; const r=(await p.query(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE created_at>=CURRENT_DATE) today, COUNT(*) FILTER (WHERE direction='inbound') inbound, COUNT(*) FILTER (WHERE direction='outbound') outbound FROM checkins WHERE ${lincolnDashboardWhere()}`)).rows[0]; return Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Number(v)])); }

async function getCheckinById(id) {
  const p = getPool(); if (!p) return null;
  const result = await p.query(`SELECT * FROM checkins WHERE id = $1 AND ${lincolnDashboardWhere()}`, [id]);
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
  sets.push('updated_at = NOW()');
  if (updatedBy) { sets.push(`updated_by = $${idx}`); vals.push(updatedBy); idx++; }
  if (updateNotes) { sets.push(`update_notes = $${idx}`); vals.push(updateNotes); idx++; }
  vals.push(id);
  const sql = `UPDATE checkins SET ${sets.join(', ')} WHERE id = $${idx} AND facility_id='LT_F22' RETURNING *`;
  const result = await p.query(sql, vals);
  return result.rows[0] || null;
}

async function updateAssignment(id, data) {
  const p = getPool(); if (!p) return null;
  const sets = []; const params = [];
  if (data.assignedTo !== undefined) { params.push(data.assignedTo || null); sets.push(`assigned_to=$${params.length}`); }
  if (data.assignedBy !== undefined) { params.push(data.assignedBy || null); sets.push(`assigned_by=$${params.length}`); }
  if (data.assignmentStatus !== undefined) { params.push(data.assignmentStatus || 'Unassigned'); sets.push(`assignment_status=$${params.length}`); }
  if (data.assignmentNotes !== undefined) { params.push(data.assignmentNotes || null); sets.push(`assignment_notes=$${params.length}`); }
  if (data.assignedTo || data.assignmentStatus) { params.push(new Date().toISOString()); sets.push(`assigned_at=$${params.length}`); }
  if (!sets.length) return null;
  params.push(id);
  const sql = `UPDATE checkins SET ${sets.join(', ')} WHERE id=$${params.length} AND facility_id='LT_F22' RETURNING id, assigned_to, assigned_by, assigned_at, assignment_status, assignment_notes`;
  const result = await p.query(sql, params);
  return result.rows[0] || null;
}

async function updateLoadTask(id, data) {
  const p = getPool(); if (!p) return null;
  const sets = []; const params = [];
  if (data.wiseOperatorId !== undefined) { params.push(data.wiseOperatorId || null); sets.push(`wise_operator_id=$${params.length}`); }
  if (data.wiseOperatorName !== undefined) { params.push(data.wiseOperatorName || null); sets.push(`wise_operator_name=$${params.length}`); }
  if (data.loadTaskId !== undefined) { params.push(data.loadTaskId || null); sets.push(`load_task_id=$${params.length}`); }
  if (data.loadTaskStatus !== undefined) { params.push(data.loadTaskStatus || null); sets.push(`load_task_status=$${params.length}`); }
  if (data.loadTaskError !== undefined) { params.push(data.loadTaskError || null); sets.push(`load_task_error=$${params.length}`); }
  if (data.dockId !== undefined) { params.push(data.dockId || null); sets.push(`dock_id=$${params.length}`); }
  if (!sets.length) return null;
  sets.push('updated_at=NOW()');
  params.push(id);
  const sql = `UPDATE checkins SET ${sets.join(', ')} WHERE id=$${params.length} AND facility_id='LT_F22' RETURNING *`;
  const result = await p.query(sql, params);
  return result.rows[0] || null;
}

module.exports={initDb,insertCheckin,queryCheckins,getSummary,getCheckinById,updateCheckin,loadTypeGroup,EDITABLE_FIELDS,updateAssignment,updateLoadTask};
