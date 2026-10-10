WITH objects AS (
SELECT 'relation:'||n.nspname||'.'||c.relname AS identity,
 jsonb_build_object('kind',c.relkind,'owner',CASE WHEN c.relowner=current_user::regrole THEN '$migrator' ELSE c.relowner::regrole::text END,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) x),
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(a.attacl) x),'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private') AND c.relkind IN ('r','p','v','m','f','S')
UNION ALL SELECT 'constraint:'||n.nspname||'.'||c.relname||'.'||x.conname,
 jsonb_build_object('definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated,'deferred',x.condeferred,'deferrable',x.condeferrable)
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private')
UNION ALL SELECT 'index:'||n.nspname||'.'||c.relname,
 jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'immediate',i.indimmediate)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private')
UNION ALL SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','structr_private')
UNION ALL SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x),'owner',CASE WHEN p.proowner=current_user::regrole THEN '$migrator' ELSE p.proowner::regrole::text END)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','structr_private')
UNION ALL SELECT 'policy:'||n.nspname||'.'||c.relname||'.'||p.polname,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN o=0 THEN 'PUBLIC' ELSE o::regrole::text END ORDER BY o::regrole::text) FROM unnest(p.polroles) o), 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private')
)
SELECT identity,definition,encode(sha256(convert_to(definition::text,'UTF8')),'hex') AS sha256 FROM objects ORDER BY identity
