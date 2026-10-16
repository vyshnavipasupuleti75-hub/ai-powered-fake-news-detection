const router=require('express').Router();
const rateLimit=require('express-rate-limit');
const Verification=require('../models/Verification');
const asyncHandler=require('../utils/async');
const audit=require('../utils/audit');
const {analyze}=require('../services/analyzer');
const {retrieveArticle}=require('../services/urlSafety');
const {gatherEvidence}=require('../services/evidence');
const {extract}=require('../services/aiClient');
const {uploader,requireValidFile}=require('../services/mediaUpload');
const {reconcile,summarize,nextSteps}=require('../services/reportBuilder');
const jobs=require('../services/jobs');
const {mediaTimeoutMs}=require('../config/env');
const MIN_TEXT=20,MAX_TEXT=10000;
const uploadLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,message:{message:'Too many uploads. Please wait a few minutes and try again.'}});
const noop=()=>{};

function capabilityList({inputType,classified,evidence,media}){
  const list=[{name:'Text classification',status:classified?'used':'skipped',note:classified?'Trained TF-IDF + Logistic Regression model.':'Too little text to classify.'}];
  if(inputType==='image'||inputType==='video')list.push({name:'OCR text extraction',status:media?.ocrLineCount>0?'used':'no text found',note:'RapidOCR, local.'});
  if(inputType==='video')list.push({name:'Speech transcription',status:media?.transcript?.status==='completed'?'used':'unavailable',note:media?.transcript?.reason||'faster-whisper, local.'});
  if(inputType==='image'||inputType==='video')list.push({name:'Manipulation / deepfake detection',status:'unavailable',note:'Not implemented. No claim about authenticity of the visuals is made.'});
  list.push({name:'External fact-check lookup',status:evidence?.factChecked?'used':'unavailable',note:evidence?.factChecked?'Google Fact Check Tools API.':'No fact-check API key configured (EVIDENCE_API_KEY).'});
  return list;
}

// Runs classification + evidence for the text and stores the full report. onStage(i) reports progress.
async function buildAndSave(req,{inputType,headline='',text='',url='',media,extraLimitations=[],noTextMessage,stageBase=0,onStage=noop}){
  const started=Date.now();
  if(text.length>MAX_TEXT)throw Object.assign(new Error('Text must be '+MAX_TEXT.toLocaleString('en-US')+' characters or fewer.'),{status:400,expose:true});
  const classified=text.length>=MIN_TEXT;
  if(!classified&&!media)throw Object.assign(new Error('Please provide at least '+MIN_TEXT+' characters of claim or article text.'),{status:400,expose:true});
  let classification,evidence;
  if(classified){
    onStage(stageBase);classification=await analyze(text);
    onStage(stageBase+1);evidence=await gatherEvidence(text);
  }else{
    classification={prediction:'INCONCLUSIVE',confidence:null,modelVersion:'not-run',explanation:noTextMessage,supportingEvidence:[],contradictoryEvidence:[],processingStatus:'completed',limitations:['No classification was run because there was too little readable text.']};
    evidence={supportingEvidence:[],contradictoryEvidence:[],relatedSources:[],evidenceAssessment:{status:'INCONCLUSIVE',note:'No text was available to search for evidence.',retrievedAt:new Date()},limitations:[]};
  }
  onStage(stageBase+2);
  const verdict=reconcile(classification,evidence);
  const supportingEvidence=[...(classification.supportingEvidence||[]),...evidence.supportingEvidence];
  const contradictoryEvidence=[...(classification.contradictoryEvidence||[]),...evidence.contradictoryEvidence];
  const doc={
    userId:req.user._id,inputType,headline:headline.slice(0,180),submittedText:text.slice(0,12000),submittedUrl:url,media,
    prediction:verdict.prediction,modelPrediction:verdict.modelPrediction,disagreement:verdict.disagreement,reviewNeeded:verdict.reviewNeeded,
    confidence:classification.confidence,modelVersion:classification.modelVersion,explanation:classification.explanation,processingStatus:classification.processingStatus,
    supportingEvidence,contradictoryEvidence,relatedSources:evidence.relatedSources,evidenceAssessment:evidence.evidenceAssessment,
    limitations:[...extraLimitations,...(classification.limitations||[]),...evidence.limitations],
    capabilities:capabilityList({inputType,classified,evidence,media})
  };
  doc.summary=summarize({...doc,text,confidence:classification.confidence});
  doc.nextSteps=nextSteps(doc);
  doc.processingMs=Date.now()-started;
  const verification=await Verification.create(doc);
  await audit(req.user._id,'verification.created','Verification',verification._id,{inputType,prediction:verification.prediction});
  return verification;
}

router.post('/text',asyncHandler(async(req,res)=>{const v=await buildAndSave(req,{inputType:'text',headline:String(req.body.headline||'').trim(),text:String(req.body.text||'').trim()});res.status(201).json({verification:v});}));
router.post('/url',asyncHandler(async(req,res)=>{const url=String(req.body.url||'').trim();if(!url)return res.status(400).json({message:'Article URL is required.'});const article=await retrieveArticle(url);const v=await buildAndSave(req,{inputType:'url',headline:article.title,text:article.text,url});res.status(201).json({verification:v});}));

// Image and video run as background jobs: the request returns 202 immediately and the client polls /jobs/:id.
function startJob(req,res,kind,work){
  const job=jobs.create(req.user._id,kind);
  res.status(202).json(jobs.view(job));
  setImmediate(async()=>{
    try{const v=await work(job);jobs.complete(job,v._id);}
    catch(err){if(!err.expose)console.error(`Analysis job failed (${err.code||err.name||'error'}).`);jobs.fail(job,err.expose?err.message:'The analysis failed unexpectedly. Please try again.');}
  });
}

router.post('/image',uploadLimiter,uploader('image'),requireValidFile('image'),(req,res,next)=>{
  try{startJob(req,res,'image',async job=>{
    jobs.setStage(job,1);
    const out=await extract('image',req.file,mediaTimeoutMs);
    const text=String(out.text||'').trim().slice(0,MAX_TEXT);
    return buildAndSave(req,{inputType:'image',headline:'Image upload',text,stageBase:2,onStage:i=>jobs.setStage(job,i),
      media:{kind:'image',mimeType:req.file.mimetype,sizeBytes:req.file.size,ocrEngine:out.engine,ocrLineCount:(out.lines||[]).length,width:out.width,height:out.height,segments:(out.lines||[]).slice(0,60).map(l=>({text:l.text.slice(0,1000)}))},
      extraLimitations:['Only text found by OCR was analyzed. The image itself was not checked for manipulation, authenticity, or origin.'],
      noTextMessage:'OCR found no usable text in this image, so there was nothing to classify. No other image analysis is supported.'});
  });}catch(err){next(err);}
});

router.post('/video',uploadLimiter,uploader('video'),requireValidFile('video'),(req,res,next)=>{
  try{startJob(req,res,'video',async job=>{
    jobs.setStage(job,1);
    const out=await extract('video',req.file,mediaTimeoutMs);
    const frames=out.frames||[];
    const tr=out.transcript||{status:'unavailable',text:'',segments:[]};
    const seenText=new Set();const frameSegments=frames.flatMap(f=>f.lines.map(l=>({timestampSeconds:f.timestampSeconds,text:l.text.slice(0,1000)}))).filter(s=>{const k=s.text.trim().toLowerCase();if(seenText.has(k))return false;seenText.add(k);return true;});
    const speechSegments=(tr.segments||[]).map(s=>({timestampSeconds:s.start,text:('Speech: '+s.text).slice(0,1000)}));
    const text=String(out.text||'').trim().slice(0,MAX_TEXT);
    const coverage='Analyzed '+out.framesAnalyzed+' of '+out.totalFrames+' frames (sampled evenly across '+out.durationSeconds+'s).';
    return buildAndSave(req,{inputType:'video',headline:'Video upload',text,stageBase:2,onStage:i=>jobs.setStage(job,i),
      media:{kind:'video',mimeType:req.file.mimetype,sizeBytes:req.file.size,ocrEngine:'RapidOCR (ONNX, local)',ocrLineCount:frameSegments.length,durationSeconds:out.durationSeconds,framesAnalyzed:out.framesAnalyzed,framesRequested:out.framesRequested,timedOut:!!out.timedOut,audioTranscribed:tr.status==='completed',
        transcript:{status:tr.status,model:tr.model,language:tr.language||undefined,reason:tr.reason||undefined,text:String(tr.text||'').slice(0,10000)},segments:[...frameSegments,...speechSegments].slice(0,150)},
      extraLimitations:[coverage+' The rest of the video was not examined.',tr.status==='completed'?'Speech was transcribed automatically and may contain errors.':'Speech was not transcribed: '+(tr.reason||'unavailable')+'.','Visual authenticity, deepfake and lip-sync detection are not implemented.',...(out.timedOut?['Processing hit its time limit, so fewer frames were analyzed than planned.']:[])],
      noTextMessage:'No usable on-screen text or speech was found. '+coverage+' Nothing was classified.'});
  });}catch(err){next(err);}
});

router.get('/jobs/:id',(req,res)=>{const job=jobs.get(req.params.id,req.user._id);if(!job)return res.status(404).json({message:'Analysis job not found or expired.'});res.json(jobs.view(job));});
router.get('/history',asyncHandler(async(req,res)=>{const page=Math.max(1,Number.parseInt(req.query.page,10)||1),limit=Math.min(50,Math.max(1,Number.parseInt(req.query.limit,10)||10));const filter={userId:req.user._id};if(['LIKELY_REAL','POTENTIALLY_FAKE','PARTIALLY_TRUE','INCONCLUSIVE'].includes(req.query.prediction))filter.prediction=req.query.prediction;if(['text','url','image','video'].includes(req.query.inputType))filter.inputType=req.query.inputType;if(req.query.search)filter.$or=[{headline:{$regex:String(req.query.search).slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'}},{submittedText:{$regex:String(req.query.search).slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'}}];const [items,total]=await Promise.all([Verification.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit).select('-submittedText'),Verification.countDocuments(filter)]);res.json({items,total,page,limit});}));
router.get('/:id',asyncHandler(async(req,res)=>{const verification=await Verification.findOne({_id:req.params.id,userId:req.user._id});if(!verification)return res.status(404).json({message:'Report not found.'});res.json({verification});}));
router.delete('/:id',asyncHandler(async(req,res)=>{const verification=await Verification.findOneAndDelete({_id:req.params.id,userId:req.user._id});if(!verification)return res.status(404).json({message:'Report not found.'});await audit(req.user._id,'verification.deleted','Verification',req.params.id);res.json({message:'Verification deleted.'});}));
module.exports=router;
