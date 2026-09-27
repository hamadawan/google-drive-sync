const { test } = require('node:test');
const assert = require('node:assert/strict');
const { device, MemoryDrive } = require('./helpers.cjs');
const { SyncStore, parseBatch, createDatabaseLock, GoogleDrive, ReconnectRequired, SyncClient } = require('../dist');
const schema = {
  notes: { columns: ['title', 'body'], refs: {} },
  comments: { columns: ['note_id', 'body'], refs: { note_id: 'notes' } },
  settings: { columns: ['key', 'value'], refs: {}, primaryKey: { column: 'key', type: 'text' }, identity: row => `setting:${row.key}` },
};
const sql = 'CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL REFERENCES notes(id), body TEXT NOT NULL); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA foreign_keys=ON;';
async function pair(t) {
  const a = device(schema, sql), b = device(schema, sql), drive = new MemoryDrive(schema);
  t.after(() => { a.sqlite.close(); b.sqlite.close(); });
  await a.store.initialize(); await b.store.initialize();
  return { a, b, drive, ea: a.engine(drive), eb: b.engine(drive) };
}
test('offline inserts with colliding local IDs preserve parent references and merge text settings', async t => {
  const { a, b, ea, eb } = await pair(t);
  a.sqlite.exec("INSERT INTO notes(title,body) VALUES ('A','one'); INSERT INTO comments(note_id,body) VALUES(1,'A-child'); INSERT INTO settings VALUES('001','A');");
  b.sqlite.exec("INSERT INTO notes(title,body) VALUES ('B','two'); INSERT INTO comments(note_id,body) VALUES(1,'B-child'); INSERT INTO settings VALUES('theme','dark');");
  await ea.sync(); await eb.sync(); await ea.sync();
  for (const d of [a,b]) {
    assert.equal(d.rows('notes').length,2); assert.equal(d.rows('settings').length,2);
    assert.equal(d.rows('settings').find(r => r.key === '001').value, 'A');
    assert.equal(d.sqlite.prepare('SELECT notes.title FROM comments JOIN notes ON notes.id=comments.note_id WHERE comments.body=?').get('A-child').title,'A');
  }
  const before = (await a.store.pending()).length;
  await ea.sync(); assert.equal((await a.store.pending()).length, before);
});
test('concurrent fields merge, same-field edits converge, and delete wins over offline edits', async t => {
  const { a,b,ea,eb } = await pair(t);
  a.sqlite.exec("INSERT INTO notes(title,body) VALUES('original','body')");
  await ea.sync(); await eb.sync();
  a.sqlite.exec("UPDATE notes SET title='changed'"); b.sqlite.exec("UPDATE notes SET body='edited'");
  await ea.sync(); await eb.sync(); await ea.sync();
  assert.deepEqual(a.rows('notes'),b.rows('notes')); assert.equal(a.rows('notes')[0].body,'edited');
  a.sqlite.exec("UPDATE notes SET title='A'"); b.sqlite.exec("UPDATE notes SET title='B'");
  await ea.sync(); await eb.sync(); await ea.sync(); assert.deepEqual(a.rows('notes'),b.rows('notes'));
  a.sqlite.exec('DELETE FROM notes'); b.sqlite.exec("UPDATE notes SET body='offline'; INSERT INTO comments(note_id,body) VALUES(1,'offline child');");
  await ea.sync(); await eb.sync(); await ea.sync();
  assert.deepEqual(b.rows('notes'),[]); assert.deepEqual(b.rows('comments'),[]);
});
test('lost upload responses retry durably after restart without another file', async t => {
  const { a,drive,ea } = await pair(t);
  a.sqlite.exec("INSERT INTO notes(title,body) VALUES('A','B')"); drive.loseResponse=true;
  await assert.rejects(ea.sync(),/Lost/); assert.equal((await a.store.pending()).length,1);
  const restarted = new SyncStore(a.db,schema); await restarted.initialize();
  const { SyncEngine } = require('../dist'); await new SyncEngine(restarted,drive,a.lock,undefined,'test-sync-v1-').sync();
  assert.equal((await restarted.pending()).length,0); assert.equal(drive.files.size,1);
});
test('SQL failure rolls back records and seen-file acknowledgment', async t => {
  const { a } = await pair(t);
  await assert.rejects(a.store.apply([{ id:'bad', batch:{ format:1,id:'bad',records:[{table:'notes',id:'n',deleted:false,fields:{title:{value:null,clock:1,device:'d'},body:{value:'b',clock:1,device:'d'}}}]}}]));
  assert.equal(await a.store.seen('bad'),false); assert.equal((await a.store.all()).length,0);
});
test('app schemas reject foreign records, invalid fields, and unsafe SQL identifiers', () => {
  assert.throws(() => parseBatch(JSON.stringify({format:1,id:'b',records:[{table:'other',id:'n',deleted:false,fields:{}}]}),schema),/Unsupported/);
  assert.throws(() => new SyncStore({}, {'notes; DROP TABLE settings': {columns:['title'],refs:{}}}),/identifier/);
  assert.throws(() => new SyncStore({}, {comments:schema.comments,notes:schema.notes}),/referenced/);
});
test('wrong Google account is rejected before another account can use the store', async t => {
  const { a } = await pair(t); await a.store.bindAccount('one','one@example.com');
  await assert.rejects(a.store.bindAccount('two','two@example.com'),/one@example.com/);
  assert.equal(await a.store.meta('owner'),'one');
});
test('the database lock releases after an exception and prevents interleaving', async () => {
  const lock=createDatabaseLock(), events=[];
  const first=lock(async()=>{events.push(1); await Promise.resolve(); events.push(2); throw Error('failed');});
  const second=lock(async()=>events.push(3)); await assert.rejects(first); await second; assert.deepEqual(events,[1,2,3]);
});
test('Drive listing follows pages and separates application namespaces', async t => {
  const original=global.fetch; t.after(()=>global.fetch=original); let calls=0;
  global.fetch=async url=>{ calls++; if(calls===1) return Response.json({files:[{id:'other',name:'other-sync-v1-x.json'}],nextPageToken:'next'}); assert.match(url,/pageToken=next/); return Response.json({files:[{id:'mine',name:'test-sync-v1-x.json'}]}); };
  const drive=new GoogleDrive(async()=>'token','test-sync-v1-',text=>parseBatch(text,schema)); assert.deepEqual(await drive.list(),[{id:'mine',name:'test-sync-v1-x.json'}]);
});
test('invalid upload locations never receive credentials; 401 requires reconnect', async t => {
  const original=global.fetch; t.after(()=>global.fetch=original); let calls=0;
  global.fetch=async()=>{calls++; return new Response(null,{headers:{Location:'https://bad.invalid/upload'}});};
  const drive=new GoogleDrive(async()=>'token','test-sync-v1-',text=>parseBatch(text,schema));
  await assert.rejects(drive.upload('batch','{}'),/valid upload session/); assert.equal(calls,1);
  global.fetch=async()=>new Response(null,{status:401}); await assert.rejects(drive.list(),ReconnectRequired);
});
test('client reconnect errors preserve the local queue and disconnect preserves account binding', async t => {
  const { a }=await pair(t), original=global.fetch; t.after(()=>global.fetch=original);
  global.fetch=async()=>new Response(null,{status:401}); let invalidations=0;
  const auth={configured:true,connect:async()=>({id:'one',email:'one@example.com'}),restore:async()=>null,accessToken:async()=>'token',disconnect:async()=>{},invalidate:async()=>{invalidations++;}};
  const client=new SyncClient(a.store,auth,a.lock,'test-sync-v1-'); await client.initialize();
  a.sqlite.exec("INSERT INTO notes(title,body) VALUES('A','B')"); await client.connect();
  assert.equal(invalidations,1); assert.equal(client.getSnapshot().connected,false); assert.equal((await a.store.pending()).length,1);
  await client.disconnect(); assert.equal(await a.store.meta('owner'),'one'); assert.equal(await a.store.meta('enabled'),'false');
});
test('invalid local values never enter the outbox or advance snapshots',async t=>{
  const localSchema={notes:{columns:['title','body'],refs:{},validate:(_record,row)=>row.title.length>0}};
  const d=device(localSchema,sql);t.after(()=>d.sqlite.close());await d.store.initialize();
  d.sqlite.exec("INSERT INTO notes(title,body) VALUES('','body')");
  await assert.rejects(d.store.capture(),/Unsupported/);assert.equal((await d.store.pending()).length,0);assert.equal((await d.store.all()).length,0);
  d.sqlite.exec("UPDATE notes SET title='fixed'");await d.store.capture();assert.equal((await d.store.pending()).length,1);
});
