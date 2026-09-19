-- Catalog metadata only; keep output private because function bodies/defaults are included.
-- Execute within an explicit READ ONLY transaction for an external environment.
-- This is a public-schema structural capture, not an ACL, role, Auth, Storage,
-- business-data or full-backup inventory. Extension members are excluded.
-- complete=true describes completion of this capture scope, not platform recovery.
-- If reconstruction omits objects/dependencies, the operator must set complete=false
-- and record omissions before comparison. No writes or automatic repair occur here.
WITH owned_relations AS (
 SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
), objects AS (
 SELECT 'table' kind, 'public.'||c.relname name,
 jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'replicaIdentity',c.relreplident,'persistence',c.relpersistence) definition
 FROM owned_relations c WHERE c.relkind IN ('r','p')
 UNION ALL
 SELECT 'column','public.'||c.relname||'.'||a.attname,
 jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END)
 FROM owned_relations c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint','public.'||c.relname||'.'||x.conname,
 jsonb_build_object('type',x.contype,'definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated,'deferrable',x.condeferrable,'initiallyDeferred',x.condeferred)
 FROM owned_relations c JOIN pg_constraint x ON x.conrelid=c.oid
 UNION ALL
 SELECT 'index','public.'||i.relname,
 jsonb_build_object('definition',pg_get_indexdef(i.oid),'valid',ix.indisvalid,'ready',ix.indisready,'unique',ix.indisunique,'primary',ix.indisprimary)
 FROM owned_relations c JOIN pg_index ix ON ix.indrelid=c.oid JOIN pg_class i ON i.oid=ix.indexrelid
 UNION ALL
 SELECT 'trigger','public.'||c.relname||'.'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
 FROM owned_relations c JOIN pg_trigger t ON t.tgrelid=c.oid WHERE NOT t.tgisinternal
 UNION ALL
 SELECT 'policy',p.schemaname||'.'||p.tablename||'.'||p.policyname,
 jsonb_build_object('permissive',p.permissive,'roles',p.roles,'command',p.cmd,'using',p.qual,'check',p.with_check)
 FROM pg_policies p WHERE p.schemaname='public'
 UNION ALL
 SELECT 'routine','public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid),'securityDefiner',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
 UNION ALL
 SELECT 'view','public.'||c.relname,jsonb_build_object('definition',pg_get_viewdef(c.oid,true),'options',c.reloptions)
 FROM owned_relations c WHERE c.relkind IN ('v','m')
 UNION ALL
 SELECT 'sequence','public.'||c.relname,jsonb_build_object('type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)
 FROM owned_relations c JOIN pg_sequence s ON s.seqrelid=c.oid
 UNION ALL
 SELECT 'extension',n.nspname||'.'||e.extname,jsonb_build_object('version',e.extversion,'relocatable',e.extrelocatable)
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname<>'plpgsql'
)
SELECT jsonb_build_object('version',1,'complete',true,'omissions','[]'::jsonb,'objects',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'definition',definition) ORDER BY kind,name),'[]'::jsonb)) FROM objects;
