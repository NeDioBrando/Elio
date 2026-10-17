// SPDX-License-Identifier: GPL-3.0-or-later
const synerixcodeMedia = (() => {
  const types = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',svg:'image/svg+xml',avif:'image/avif',heic:'image/heic',heif:'image/heif',tif:'image/tiff',tiff:'image/tiff',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',mpeg:'video/mpeg',mpg:'video/mpeg',ogv:'video/ogg',wmv:'video/x-ms-wmv',flv:'video/x-flv', '3gp':'video/3gpp'};
  const MAX_BYTES = 12 * 1024 * 1024, MAX_FILES = 8;
  function mime(file) { return file.type && file.type !== 'application/octet-stream' ? file.type : types[String(file.name || '').split('.').pop().toLowerCase()] || ''; }
  function fileFrom(payload, index = 0) {
    const type = payload.mimeType || 'image/jpeg', bin = atob(payload.data), bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const ext = Object.keys(types).find(key => types[key] === type) || 'bin';
    return new File([bytes], payload.name || `synerixcode_${Date.now()}_${index}.${ext}`, {type});
  }
  async function encode(file) {
    return new Promise((resolve,reject) => { const reader = new FileReader();reader.onload=()=>resolve({name:file.name,mimeType:mime(file),data:String(reader.result).split(',')[1] || ''});reader.onerror=()=>reject(Error('Could not read '+file.name));reader.readAsDataURL(file); });
  }
  function event(target, name, action, timeout = 15000) {
    return new Promise((resolve,reject) => {
      const timer=setTimeout(()=>finish(Error('Media decoding timed out. This codec may not be supported by your browser.')),timeout);
      const success=()=>finish(), failure=()=>finish(Error('This media codec cannot be decoded on this device. Convert it to PNG/JPEG or MP4/WebM and try again.'));
      function finish(error) { clearTimeout(timer);target.removeEventListener(name,success);target.removeEventListener('error',failure);error?reject(error):resolve(); }
      target.addEventListener(name,success,{once:true});target.addEventListener('error',failure,{once:true});
      try { action(); } catch(error) { finish(error); }
    });
  }
  async function pixels(file, video, progress = () => {}, quality = {}) {
    const element=document.createElement(video?'video':'img'), url=URL.createObjectURL(file), output=[];
    try {
      if(video){element.muted=true;element.playsInline=true;element.preload='auto';}
      await event(element,video?'loadeddata':'load',()=>{element.src=url;});
      const width=video?element.videoWidth:element.naturalWidth,height=video?element.videoHeight:element.naturalHeight;
      if(!width || !height)throw Error('Media has no readable image dimensions.');
      const ratio=Math.min(1,(quality.maxw || 1600)/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image conversion is unavailable.');
      const duration=element.duration,count=video?Math.min(8,Math.max(1,Math.ceil(duration))):1;
      if(video && (!Number.isFinite(duration)||duration<=0))throw Error('Video duration could not be read.');
      for(let i=0;i<count;i++){
        const time=count===1?0:(duration-.05)*i/(count-1);
        if(video && Math.abs(element.currentTime-time)>.01)await event(element,'seeked',()=>{element.currentTime=time;});
        ctx.drawImage(element,0,0,canvas.width,canvas.height);
        const data=canvas.toDataURL(video?'image/jpeg':'image/png',quality.q || .86).split(',')[1];
        output.push({name:video?`${file.name} - frame ${i+1} at ${time.toFixed(2)}s.jpg`:`${file.name}.png`,mimeType:video?'image/jpeg':'image/png',data});
        progress(`Preparing ${file.name}: ${i+1}/${count}${video?' frames':''}`);
      }
      return output;
    } finally { if(video){element.pause();element.removeAttribute('src');element.load();}URL.revokeObjectURL(url); }
  }
  function validate(payloads) {
    if(!Array.isArray(payloads)||!payloads.length||payloads.length>MAX_FILES)throw Error('Send 1–8 attachments at a time.');
    let bytes=0;
    for(const p of payloads){
      if(!p || typeof p.name!=='string'||p.name.length>512||!/^((image|video)\/[a-z0-9.+-]+)$/.test(p.mimeType)||typeof p.data!=='string'||!p.data.length||p.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.data))throw Error('Invalid media attachment.');
      bytes+=p.data.length*3/4;
    }
    if(bytes>MAX_BYTES)throw Error('Attachments exceed the 12 MB transfer limit. Use fewer files or video frames.');
    return payloads;
  }
  async function prepare(files,{nativeVideo=false,frames=false,progress=()=>{},convert,quality}={}) {
    const result=[], notices=[];
    async function decode(file,video){try{return await pixels(file,video,progress,quality);}catch(error){if(!convert)throw error;progress('Trying the local decoder for '+file.name+'…');const converted=await convert(file,video);if(!converted || !converted.ok)throw Error(converted && converted.error || 'Local conversion failed.');return converted.files;}}
    for(const file of Array.from(files)){
      const type=mime(file);progress('Preparing '+file.name+'…');
      if(!type.startsWith('image/')&&!type.startsWith('video/'))throw Error('Choose an image or video file: '+file.name);
      const video=type.startsWith('video/');
      if(video && (!nativeVideo || frames || file.size>MAX_BYTES)){
        result.push(...await decode(file,true));notices.push(`${file.name}: sampled frames only; audio and motion between frames are not included.`);
      }else if(!video && !['image/png','image/jpeg','image/webp'].includes(type)){
        result.push(...await decode(file,false));notices.push(`${file.name}: converted to PNG (still image).`);
      }else{if(file.size>MAX_BYTES)throw Error(file.name+' exceeds the 12 MB transfer limit.');const payload=await encode(file);payload.mimeType=type;result.push(payload);}
      validate(result);
    }
    validate(result);return {files:result,notice:notices.join(' ')};
  }
  return {mime,fileFrom,prepare,pixels,encode,validate,MAX_BYTES,MAX_FILES};
})();
if(typeof module!=='undefined' && module.exports)module.exports=synerixcodeMedia;
