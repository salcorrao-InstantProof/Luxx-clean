export function audioUnsupported(err){
  const s=String(err?.message||err||'');
  return /unknown codec|apac|pcm_s16le|codec not currently supported in container|Could not find tag for codec|Could not find codec parameters for stream|does not contain any stream/i.test(s);
}

export async function renderWithLadder(run,ffmpeg,out,head){
  const attempts=[
    [...head,'-map','0:v:0','-map','0:a?','-c','copy',out],
    [...head,'-map','0:v:0','-map','0:a?','-c:v','copy','-c:a','aac','-b:a','128k',out],
    [...head,'-map','0:v:0','-an','-c:v','copy',out],
    [...head,'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','5M','-bufsize','10M','-c:a','aac','-b:a','128k',out],
    [...head,'-map','0:v:0','-an','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','5M','-bufsize','10M',out]
  ];
  let last;
  for(const args of attempts){
    try{await run(ffmpeg,args);return;}catch(e){last=e;}
  }
  throw last;
}
