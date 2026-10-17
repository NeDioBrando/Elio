// SPDX-License-Identifier: GPL-3.0-or-later
use std::{collections::HashSet, path::PathBuf, sync::Mutex};
use serde::{Serialize,Deserialize};
use serde_json::{json,Value};
use rbx_dom_weak::{WeakDom,types::Variant};
pub const MAX_FILE:usize=512*1024*1024;
pub const CHUNK_SIZE:usize=2*1024*1024;
#[derive(Clone,Serialize,Deserialize)]
struct Script { script_id:String, path:String, class:String, source:String, terms:Vec<String>, path_terms:Vec<String> }
#[derive(Clone,Serialize,Deserialize)]
struct Template {id:String,name:String,description:String,extension:String,scripts:Vec<Script>,instances:usize}
#[derive(Default,Serialize,Deserialize)]
struct Catalog {templates:Vec<Template>}
pub struct Store {root:PathBuf,catalog:Mutex<Catalog>}
impl Store {
    fn new(root:PathBuf)->Self{let catalog=std::fs::read(root.join("catalog.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();Self{root,catalog:Mutex::new(catalog)}}
    fn save(&self,catalog:&Catalog)->anyhow::Result<()>{std::fs::create_dir_all(&self.root)?;let tmp=self.root.join("catalog.tmp");std::fs::write(&tmp,serde_json::to_vec(catalog)?)?;std::fs::rename(tmp,self.root.join("catalog.json"))?;Ok(())}
    fn original(&self,template:&Template)->PathBuf{self.root.join(&template.id).join(format!("template.{}",template.extension))}
    fn import(&self,name:&str,description:&str,bytes:&[u8])->anyhow::Result<Value>{
        anyhow::ensure!(!bytes.is_empty() && bytes.len()<=MAX_FILE,"Choose a Roblox file up to 512 MB.");
        let extension=name.rsplit('.').next().unwrap_or("").to_lowercase();anyhow::ensure!(matches!(extension.as_str(),"rbxl"|"rbxlx"|"rbxm"|"rbxmx"),"Choose .rbxl, .rbxlx, .rbxm or .rbxmx.");
        let dom=if matches!(extension.as_str(),"rbxl"|"rbxm"){rbx_binary::from_reader(bytes)?}else{rbx_xml::from_reader(bytes,Default::default())?};
        self.store_dom(name,description,extension,dom,|original|std::fs::write(original,bytes))
    }
    fn import_file(&self,name:&str,description:&str,input:&std::path::Path)->anyhow::Result<Value>{
        let size=std::fs::metadata(input)?.len();anyhow::ensure!(size>0 && size<=MAX_FILE as u64,"Choose a Roblox file up to 512 MB.");
        let extension=name.rsplit('.').next().unwrap_or("").to_lowercase();anyhow::ensure!(matches!(extension.as_str(),"rbxl"|"rbxlx"|"rbxm"|"rbxmx"),"Choose .rbxl, .rbxlx, .rbxm or .rbxmx.");
        let reader=std::io::BufReader::new(std::fs::File::open(input)?);
        let dom=if matches!(extension.as_str(),"rbxl"|"rbxm"){rbx_binary::from_reader(reader)?}else{rbx_xml::from_reader(reader,Default::default())?};
        self.store_dom(name,description,extension,dom,|original|std::fs::copy(input,original).map(|_|()))
    }
    fn store_dom<F:FnOnce(&std::path::Path)->std::io::Result<()>>(&self,name:&str,description:&str,extension:String,dom:WeakDom,write:F)->anyhow::Result<Value>{
        let (scripts,instances)=extract(&dom)?;anyhow::ensure!(!scripts.is_empty(),"No readable Script, LocalScript or ModuleScript sources were found. This file cannot be indexed as a code reference.");
        let template=Template{id:format!("{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()),name:name.chars().take(160).collect(),description:description.chars().take(1000).collect(),extension,scripts,instances};
        let mut catalog=self.catalog.lock().unwrap_or_else(|e|e.into_inner());anyhow::ensure!(catalog.templates.len()<20,"Template library is full (20 templates). Remove one first.");
        let source_bytes=catalog.templates.iter().flat_map(|t|&t.scripts).map(|s|s.source.len()).sum::<usize>()+template.scripts.iter().map(|s|s.source.len()).sum::<usize>();anyhow::ensure!(source_bytes<=128*1024*1024,"Template source index exceeds 128 MB. Remove an unused template first.");
        let original=self.original(&template);std::fs::create_dir_all(original.parent().unwrap())?;
        // The original file is retained separately from the read-only source index.
        write(&original)?;
        let id=template.id.clone();catalog.templates.push(template);
        if let Err(error)=self.save(&catalog){catalog.templates.pop();let _=std::fs::remove_dir_all(original.parent().unwrap());return Err(error);}
        Ok(json!({"ok":true,"id":id}))
    }
    pub fn request(&self,req:&Value)->anyhow::Result<Value>{
        let mut catalog=self.catalog.lock().unwrap_or_else(|e|e.into_inner());let id=req["id"].as_str().unwrap_or("");
        match req["action"].as_str().unwrap_or("list"){
            "list"=>Ok(json!({"ok":true,"templates":catalog.templates.iter().map(|t|json!({"id":t.id,"name":t.name,"description":t.description,"scripts":t.scripts.len(),"instances":t.instances})).collect::<Vec<_>>()})),
            "match"=>{let query=req["query"].as_str().unwrap_or("");anyhow::ensure!(query.len()<=400000,"Template query is too long.");Ok(json!({"ok":true,"matches":matching_with_limit(&catalog,query,req["limit"].as_u64().unwrap_or(6).clamp(1,8) as usize)}))},
            "read"=>{let template=catalog.templates.iter().find(|t|t.id==id).ok_or_else(||anyhow::anyhow!("Template not found."))?;
                if req["path"].as_str().unwrap_or("").is_empty() && req["script_id"].as_str().unwrap_or("").is_empty(){return Ok(json!({"ok":true,"name":template.name,"scripts":template.scripts.iter().map(|s|json!({"script_id":s.script_id,"path":s.path,"class":s.class,"chars":s.source.chars().count()})).collect::<Vec<_>>()}));}
                let script_id=req["script_id"].as_str().unwrap_or("");let path=req["path"].as_str().unwrap_or("");
                let selected=template.scripts.iter().filter(|s|if script_id.is_empty(){s.path==path}else{s.script_id==script_id}).collect::<Vec<_>>();anyhow::ensure!(selected.len()==1,"Script path is missing or ambiguous. List scripts and supply its script_id.");let script=selected[0];
                let offset=req["offset"].as_u64().unwrap_or(0) as usize;let limit=req["limit"].as_u64().unwrap_or(12000).clamp(1,24000) as usize;let count=script.source.chars().count();anyhow::ensure!(offset<=count,"Source offset is beyond this script.");
                let source=script.source.chars().skip(offset).take(limit).collect::<String>();Ok(json!({"ok":true,"name":template.name,"script_id":script.script_id,"path":script.path,"class":script.class,"source":source,"offset":offset,"total_chars":count,"next_offset":if offset+limit<count{Some(offset+limit)}else{None}}))},
            "remove"=>{let index=catalog.templates.iter().position(|t|t.id==id).ok_or_else(||anyhow::anyhow!("Template not found."))?;let template=catalog.templates.remove(index);
                if let Err(error)=self.save(&catalog){catalog.templates.insert(index,template);return Err(error);}let _=std::fs::remove_dir_all(self.original(&template).parent().unwrap());Ok(json!({"ok":true}))},
            "open"=>{let template=catalog.templates.iter().find(|t|t.id==id).ok_or_else(||anyhow::anyhow!("Template not found."))?;let original=self.original(template);anyhow::ensure!(original.is_file(),"Original template file is missing.");
                #[cfg(windows)] {use std::os::windows::process::CommandExt;std::process::Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(original).creation_flags(0x08000000).spawn()?;Ok(json!({"ok":true,"message":"Open requested through the Windows Roblox file association. Select the desired Studio session in synerixcode after it opens."}))}
                #[cfg(not(windows))] {anyhow::bail!("Opening a template in Studio requires Windows.")}
            },
            _=>anyhow::bail!("Unknown template action.")
        }
    }
}
fn terms(text:&str)->Vec<String>{
    let mut expanded=String::with_capacity(text.len());let mut previous=' ';
    for c in text.chars(){if c.is_uppercase() && previous.is_lowercase(){expanded.push(' ');}expanded.push(c);previous=c;}
    let stops=["the","and","for","local","function","return","then","end","with","from","this","that","have","want","make","game","system","script","server","client","player","players","should","please","using","create","could","like","into","else","true","false","self","nil","not","new","task","request","original","synerixcode","inspect","preserve","changes","work","same","your","you","can","will"];
    let mut set=HashSet::new();for raw in expanded.split(|c:char|!c.is_alphanumeric()) {let mut word=raw.to_lowercase();if word.len()<3||stops.contains(&word.as_str()){continue;}if word.ends_with('s') && !word.ends_with("ss") && !word.ends_with("us") && word.len()>4 {word.pop();}
        word=match word.as_str(){"backpack"|"inventorie"|"inventory"=>"inventory","fighting"|"fight"|"battle"|"combat"=>"combat","shop"|"store"|"purchase"|"buy"=>"shop","coin"|"money"|"currency"=>"currency","equip"|"loadout"|"hotbar"=>"loadout",_=>&word}.to_string();set.insert(word);}
    let mut result=set.into_iter().collect::<Vec<_>>();result.sort();result
}
fn extract(dom:&WeakDom)->anyhow::Result<(Vec<Script>,usize)>{
    let mut scripts=Vec::new();let mut stack=dom.root().children().iter().map(|r|(*r,"game".to_string())).collect::<Vec<_>>();let mut instances=0;let mut bytes=0;
    while let Some((referent,parent))=stack.pop(){instances+=1;anyhow::ensure!(instances<=1000000,"Template contains too many instances to index.");let instance=dom.get_by_ref(referent).ok_or_else(||anyhow::anyhow!("Invalid template hierarchy."))?;let path=format!("{parent}.{}",instance.name);anyhow::ensure!(path.len()<=8192 && path.matches('.').count()<512,"Template hierarchy exceeds indexing depth/path limits.");let class=instance.class.to_string();
        if matches!(class.as_str(),"Script"|"LocalScript"|"ModuleScript"){if let Some(Variant::String(source))=instance.properties.get(&"Source".into()) {if !source.trim().is_empty(){bytes+=source.len();anyhow::ensure!(scripts.len()<10000 && bytes<=64*1024*1024 && source.len()<=8*1024*1024,"Template source exceeds indexing limits (10,000 scripts, 64 MB total, 8 MB per script).");scripts.push(Script{script_id:format!("script-{}",scripts.len()),path:path.clone(),class,terms:terms(source),path_terms:terms(&path),source:source.clone()});}}}
        for child in instance.children(){stack.push((*child,path.clone()));}
    }Ok((scripts,instances))
}
#[cfg(test)]fn matching(catalog:&Catalog,query:&str)->Vec<Value>{matching_with_limit(catalog,query,3)}
fn matching_with_limit(catalog:&Catalog,query:&str,limit:usize)->Vec<Value>{
    let query=terms(query).into_iter().take(48).collect::<Vec<_>>();if query.is_empty(){return Vec::new();}let mut found=Vec::new();
    for template in &catalog.templates {let context=terms(&format!("{} {}",template.name,template.description));for script in &template.scripts{
        let path=query.iter().filter(|q|script.path_terms.binary_search(q).is_ok()).count();let code=query.iter().filter(|q|script.terms.binary_search(q).is_ok()).count();let meta=query.iter().filter(|q|context.binary_search(q).is_ok()).count();let score=path*5+code*2+meta;
        if (path>0||code>0) && score>=2{found.push((score,template,script));}
    }}
    found.sort_by(|a,b|b.0.cmp(&a.0).then_with(||a.2.path.cmp(&b.2.path)));let mut counts=std::collections::HashMap::new();let mut result=Vec::new();
    for (score,template,script) in found {let n=counts.entry(&template.id).or_insert(0);if *n>=limit{continue;}*n+=1;result.push(json!({"id":template.id,"name":template.name,"script_id":script.script_id,"path":script.path,"class":script.class,"score":score,"source":script.source.chars().take(24000/limit.max(1).min(8)).collect::<String>(),"preview_limited":script.source.chars().count()>24000/limit.max(1).min(8)}));if result.len()==limit{break;}}
    result
}
pub static STORE:once_cell::sync::Lazy<Store>=once_cell::sync::Lazy::new(||{let root=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));Store::new(root.join("synerixcode").join("templates"))});
pub async fn post(axum::Json(req):axum::Json<Value>)->axum::response::Response {reply(tokio::task::spawn_blocking(move||STORE.request(&req)).await.unwrap_or_else(|e|Err(anyhow::anyhow!("Template request failed: {e}"))))}
#[derive(Deserialize)]pub struct Import {name:String,#[serde(default)]description:String}
pub async fn import(axum::extract::Query(req):axum::extract::Query<Import>,bytes:axum::body::Bytes)->axum::response::Response {let permit=match INDEXING.clone().try_acquire_owned(){Ok(p)=>p,Err(_)=>return reply(Err(anyhow::anyhow!("Another template is being indexed. Try again when it finishes.")))};let result=tokio::task::spawn_blocking(move||{let _permit=permit;STORE.import(&req.name,&req.description,&bytes)}).await;reply(result.unwrap_or_else(|e|Err(anyhow::anyhow!("Template indexing failed: {e}"))))}
fn reply(result:anyhow::Result<Value>)->axum::response::Response{use axum::response::IntoResponse;match result{Ok(v)=>axum::Json(v).into_response(),Err(e)=>(axum::http::StatusCode::BAD_REQUEST,axum::Json(json!({"ok":false,"error":e.to_string()}))).into_response()}}
#[cfg(test)]mod tests{
    use super::*;use rbx_dom_weak::InstanceBuilder;
    #[test]fn described_systems_match_code_and_ignore_unrelated_metadata(){let script=Script{script_id:"script-0".into(),path:"game.ServerScriptService.Handler".into(),class:"ModuleScript".into(),source:"return {CooldownUnique=true}".into(),terms:terms("return {CooldownUnique=true}"),path_terms:terms("game.ServerScriptService.Handler")};let template=Template{id:"test".into(),name:"Combat template".into(),description:"Combat economy".into(),extension:"rbxmx".into(),scripts:vec![script],instances:1};let catalog=Catalog{templates:vec![template]};assert_eq!(matching_with_limit(&catalog,"cooldown",6).len(),1);assert!(matching_with_limit(&catalog,"combat economy",6).is_empty());}

    #[test]fn binary_and_xml_templates_persist_match_and_read_without_execution(){
        let root=std::env::temp_dir().join(format!("synerixcode-template-test-{}",std::process::id()));let _=std::fs::remove_dir_all(&root);let store=Store::new(root.clone());
        let source="local Inventory={}\nfunction Inventory:AddItem(Item) return Item.Name end\nreturn Inventory";
        let dom=WeakDom::new(InstanceBuilder::new("DataModel").with_child(InstanceBuilder::new("ServerScriptService").with_child(InstanceBuilder::new("ModuleScript").with_name("InventoryService").with_property("Source",source)).with_child(InstanceBuilder::new("ModuleScript").with_name("InventoryService").with_property("Source","return {Duplicate=true}"))));
        let refs=dom.root().children();let mut binary=Vec::new();rbx_binary::to_writer(&mut binary,&dom,refs).unwrap();let mut xml=Vec::new();rbx_xml::to_writer(&mut xml,&dom,refs,Default::default()).unwrap();
        let imported=store.import("Reference.rbxl","Inventory and item equip",&binary).unwrap();store.import("Reference.rbxlx","Inventory example",&xml).unwrap();let id=imported["id"].as_str().unwrap();
        assert_eq!(store.request(&json!({"action":"list"})).unwrap()["templates"].as_array().unwrap().len(),2);
        let matches=store.request(&json!({"action":"match","query":"Build an inventory for items"})).unwrap();assert!(!matches["matches"].as_array().unwrap().is_empty());assert!(matches["matches"].as_array().unwrap().iter().any(|m|m["source"].as_str().unwrap().contains("AddItem")));
        assert!(store.request(&json!({"action":"match","query":"purple roof scenery"})).unwrap()["matches"].as_array().unwrap().is_empty());
        let scripts=store.request(&json!({"action":"read","id":id})).unwrap();let entry=scripts["scripts"].as_array().unwrap().iter().find(|s|s["chars"].as_u64().unwrap() ==source.chars().count() as u64).unwrap();
        assert!(store.request(&json!({"action":"read","id":id,"path":entry["path"]})).is_err());
        let page=store.request(&json!({"action":"read","id":id,"script_id":entry["script_id"],"limit":10})).unwrap();assert_eq!(page["source"],&source[..10]);assert_eq!(page["next_offset"],10);
        let catalog=store.catalog.lock().unwrap();let original=store.original(&catalog.templates[0]);assert_eq!(std::fs::read(original).unwrap(),binary);drop(catalog);
        let reopened=Store::new(root.clone());assert_eq!(reopened.request(&json!({"action":"list"})).unwrap()["templates"].as_array().unwrap().len(),2);reopened.request(&json!({"action":"remove","id":id})).unwrap();assert_eq!(reopened.request(&json!({"action":"list"})).unwrap()["templates"].as_array().unwrap().len(),1);
        assert!(store.import("bad.exe","",b"bad").is_err());assert!(store.import("bad.rbxl","",b"bad").is_err());let empty=WeakDom::new(InstanceBuilder::new("DataModel").with_child(InstanceBuilder::new("Part")));let mut bytes=Vec::new();rbx_binary::to_writer(&mut bytes,&empty,empty.root().children()).unwrap();assert!(store.import("empty.rbxl","",&bytes).is_err());let _=std::fs::remove_dir_all(root);
    }
    #[test]fn desktop_accepts_large_places_with_small_script_indexes(){
        let root=std::env::temp_dir().join(format!("synerixcode-large-template-test-{}",std::process::id()));let _=std::fs::remove_dir_all(&root);let store=Store::new(root.clone());
        let mut xml=b"<roblox version=\"4\"><!--".to_vec();xml.resize(33*1024*1024,b' ');xml.extend_from_slice(b"--><Item class=\"ModuleScript\" referent=\"RBX1\"><Properties><string name=\"Name\">Inventory</string><ProtectedString name=\"Source\">return {Inventory=true}</ProtectedString></Properties></Item></roblox>");
        assert!(xml.len()>32*1024*1024);assert!(store.import("Large.rbxlx","Inventory",&xml).is_ok());assert_eq!(store.request(&json!({"action":"list"})).unwrap()["templates"][0]["scripts"],1);let _=std::fs::remove_dir_all(root);
    }
    #[test]fn camel_case_and_synonyms_improve_relevance(){assert!(terms("InventoryService").contains(&"inventory".into()));assert_eq!(terms("backpack"),terms("inventory"));assert_eq!(terms("fighting"),terms("combat"));}
}

// Large games arrive in small ordered chunks and are parsed from disk on a worker.
static INDEXING:once_cell::sync::Lazy<std::sync::Arc<tokio::sync::Semaphore>>=once_cell::sync::Lazy::new(||std::sync::Arc::new(tokio::sync::Semaphore::new(1)));
struct Upload {name:String,description:String,size:u64,offset:u64,path:PathBuf,updated:std::time::Instant}
static UPLOADS:once_cell::sync::Lazy<tokio::sync::Mutex<std::collections::HashMap<String,Upload>>>=once_cell::sync::Lazy::new(||tokio::sync::Mutex::new(Default::default()));
static UPLOAD_RESULTS:once_cell::sync::Lazy<tokio::sync::Mutex<std::collections::HashMap<String,Value>>>=once_cell::sync::Lazy::new(||tokio::sync::Mutex::new(Default::default()));
fn valid_upload(id:&str)->bool{id.len()==32 && id.bytes().all(|b|b.is_ascii_hexdigit())}
pub async fn upload(axum::Json(req):axum::Json<Value>)->axum::response::Response{reply(upload_request(req).await)}
async fn upload_request(req:Value)->anyhow::Result<Value>{
    let action=req["action"].as_str().unwrap_or("");let id=req["id"].as_str().unwrap_or("");
    if action=="upload-begin" {
        let name=req["name"].as_str().unwrap_or("");let description=req["description"].as_str().unwrap_or("");let size=req["size"].as_u64().unwrap_or(0);
        anyhow::ensure!(!name.is_empty() && name.len()<=1000 && description.len()<=4000 && size>0 && size<=MAX_FILE as u64,"Choose a Roblox place/model up to 512 MB and a short description.");
        let extension=name.rsplit('.').next().unwrap_or("").to_lowercase();anyhow::ensure!(matches!(extension.as_str(),"rbxl"|"rbxlx"|"rbxm"|"rbxmx"),"Choose .rbxl, .rbxlx, .rbxm or .rbxmx.");
        let mut uploads=UPLOADS.lock().await;let expired=uploads.iter().filter(|(_,u)|u.updated.elapsed()>std::time::Duration::from_secs(1800)).map(|(id,_)|id.clone()).collect::<Vec<_>>();
        for id in expired {if let Some(upload)=uploads.remove(&id){let _=tokio::fs::remove_file(upload.path).await;}}
        anyhow::ensure!(uploads.len()<2,"Two template uploads are already active. Finish or cancel one first.");
        let mut random=[0u8;16];getrandom::getrandom(&mut random).map_err(|e|anyhow::anyhow!("Upload identity failed: {e}"))?;let id=random.iter().map(|b|format!("{b:02x}")).collect::<String>();
        let dir=STORE.root.join(".uploads");tokio::fs::create_dir_all(&dir).await?;
        // Remove abandoned staging files after a bridge restart; active entries are excluded.
        let mut files=tokio::fs::read_dir(&dir).await?;while let Some(file)=files.next_entry().await?{let filename=file.file_name().to_string_lossy().into_owned();if valid_upload(&filename)&&!uploads.contains_key(&filename)&&file.metadata().await?.modified()?.elapsed().unwrap_or_default()>std::time::Duration::from_secs(1800){let _=tokio::fs::remove_file(file.path()).await;}}
        let path=dir.join(&id);tokio::fs::File::create(&path).await?;
        uploads.insert(id.clone(),Upload{name:name.into(),description:description.into(),size,offset:0,path,updated:std::time::Instant::now()});
        return Ok(json!({"ok":true,"id":id,"chunk_bytes":CHUNK_SIZE,"max_bytes":MAX_FILE}));
    }
    anyhow::ensure!(valid_upload(id),"Invalid upload identity.");
    if action=="upload-status" {return UPLOAD_RESULTS.lock().await.get(id).cloned().ok_or_else(||anyhow::anyhow!("Upload status expired."));}
    if action=="upload-finish" {if let Some(result)=UPLOAD_RESULTS.lock().await.get(id).cloned(){return Ok(result);}}
    if action=="upload-cancel" {if UPLOAD_RESULTS.lock().await.get(id).map_or(false,|v|v["state"]=="indexing"){anyhow::bail!("Indexing is already running. Wait for its result; no partial template is added.");}UPLOAD_RESULTS.lock().await.remove(id);if let Some(upload)=UPLOADS.lock().await.remove(id){let _=tokio::fs::remove_file(upload.path).await;}return Ok(json!({"ok":true}));}
    anyhow::ensure!(action=="upload-finish","Unknown upload action.");
    let permit=INDEXING.clone().try_acquire_owned().map_err(|_|anyhow::anyhow!("Another template is being indexed. Try again when it finishes."))?;
    let upload={let mut uploads=UPLOADS.lock().await;let u=uploads.get(id).ok_or_else(||anyhow::anyhow!("Upload expired or was cancelled."))?;anyhow::ensure!(u.offset==u.size,"The upload is incomplete.");uploads.remove(id).unwrap()};
    let accepted=json!({"ok":true,"state":"indexing","upload_id":id});
    {let mut results=UPLOAD_RESULTS.lock().await;if results.len()>=16 {let old=results.iter().filter(|(_,v)|v["state"]!="indexing").map(|(k,_)|k.clone()).next();if let Some(old)=old{results.remove(&old);}}results.insert(id.into(),accepted.clone());}
    let id=id.to_owned();
    tokio::spawn(async move {
        let result=tokio::task::spawn_blocking(move||{let _permit=permit;let result=STORE.import_file(&upload.name,&upload.description,&upload.path);let _=std::fs::remove_file(&upload.path);result}).await.unwrap_or_else(|e|Err(anyhow::anyhow!("Template indexing failed: {e}")));
        let result=match result{Ok(value)=>json!({"ok":true,"state":"complete","result":value}),Err(error)=>json!({"ok":true,"state":"failed","error":error.to_string()})};
        UPLOAD_RESULTS.lock().await.insert(id,result);
    });Ok(accepted)
}
#[derive(Deserialize)]pub struct Chunk {offset:u64}
pub async fn upload_chunk(axum::extract::Path(id):axum::extract::Path<String>,axum::extract::Query(req):axum::extract::Query<Chunk>,bytes:axum::body::Bytes)->axum::response::Response{
    let result=async {
        use tokio::io::AsyncWriteExt;
        anyhow::ensure!(valid_upload(&id)&&!bytes.is_empty()&&bytes.len()<=CHUNK_SIZE,"Invalid upload chunk.");
        let mut uploads=UPLOADS.lock().await;let upload=uploads.get_mut(&id).ok_or_else(||anyhow::anyhow!("Upload expired or was cancelled."))?;
        anyhow::ensure!(req.offset==upload.offset&&upload.offset+bytes.len() as u64<=upload.size,"Upload offset or size mismatch. No chunk was appended.");
        anyhow::ensure!(tokio::fs::metadata(&upload.path).await?.len()==upload.offset,"Staged file changed or a previous chunk failed; cancel and upload again.");
        let mut file=tokio::fs::OpenOptions::new().append(true).open(&upload.path).await?;file.write_all(&bytes).await?;file.flush().await?;
        upload.offset+=bytes.len() as u64;upload.updated=std::time::Instant::now();Ok(json!({"ok":true,"received":upload.offset,"total":upload.size}))
    }.await;reply(result)
}
