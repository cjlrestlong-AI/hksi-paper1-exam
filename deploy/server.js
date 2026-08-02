const http=require('http');
const fs=require('fs');
const path=require('path');

const ROOT=__dirname;
const DATA=path.join(ROOT,'.data');
try{fs.mkdirSync(DATA,{recursive:true});}catch(e){}

const MIME={
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.ico':'image/x-icon',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.map':'application/json'
};

function safeUid(u){return typeof u==='string'&&/^[A-Za-z0-9_-]{3,40}$/.test(u)?u:null;}
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
function sendJSON(res,code,obj){cors(res);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
function readBody(req){
  return new Promise((resolve)=>{
    let b='',size=0;
    req.on('data',c=>{size+=c.length;if(size>5e6){req.destroy();return;}b+=c;});
    req.on('end',()=>resolve(b));
    req.on('error',()=>resolve(''));
  });
}

const server=http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://localhost');
  const p=u.pathname;

  if(p==='/api/health'){sendJSON(res,200,{ok:true,node:process.version,ts:Date.now()});return;}

  if(p==='/api/progress'){
    if(req.method==='OPTIONS'){cors(res);res.writeHead(204);res.end();return;}
    if(req.method==='GET'){
      const uid=safeUid(u.searchParams.get('uid'));
      if(!uid){sendJSON(res,400,{error:'bad uid'});return;}
      const f=path.join(DATA,uid+'.json');
      fs.readFile(f,(e,d)=>{
        if(e){sendJSON(res,404,{error:'not found'});return;}
        try{const j=JSON.parse(d);sendJSON(res,200,{data:j.data,updatedAt:j.updatedAt||0});}
        catch(err){sendJSON(res,500,{error:'bad data'});}
      });
      return;
    }
    if(req.method==='POST'){
      const body=await readBody(req);
      let obj;try{obj=JSON.parse(body);}catch(e){sendJSON(res,400,{error:'bad json'});return;}
      const uid=safeUid(obj&&obj.uid);
      if(!uid||!obj.data||typeof obj.data!=='object'){sendJSON(res,400,{error:'bad payload'});return;}
      const f=path.join(DATA,uid+'.json');
      const rec={data:obj.data,updatedAt:Date.now()};
      fs.writeFile(f,JSON.stringify(rec),(e)=>{
        if(e){sendJSON(res,500,{error:'write fail'});return;}
        sendJSON(res,200,{ok:true,updatedAt:rec.updatedAt});
      });
      return;
    }
    sendJSON(res,405,{error:'method not allowed'});return;
  }

  // ---- static files ----
  let rel=decodeURIComponent(p);
  if(rel==='/'||rel==='')rel='/index.html';
  const filePath=path.normalize(path.join(ROOT,rel));
  if(filePath!==ROOT && !filePath.startsWith(ROOT+path.sep)){res.writeHead(403);res.end('forbidden');return;}
  fs.readFile(filePath,(e,d)=>{
    if(e){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('404 Not Found');return;}
    const ext=path.extname(filePath).toLowerCase();
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});
    res.end(d);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('HKSI sync server listening on '+PORT));
