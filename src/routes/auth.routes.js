const express=require("express");
const {sessionCookie,clearSessionCookie,createRateLimiter}=require("../middleware/security");
const {AppError,asyncRoute}=require("../utils/errors");

function authRoutes({auth,audit,requireAuth,requireCsrf}){
  const router=express.Router();
  router.post("/login",createRateLimiter({windowMs:15*60000,max:8,keyPrefix:"login"}),asyncRoute(async(req,res)=>{
    const result=auth.login(String(req.body.username||""),String(req.body.password||""));
    if(!result){await audit.record({actor:String(req.body.username||"unknown"),action:"LOGIN_FAILED",ip:req.ip,requestId:req.id});throw new AppError("Kullanıcı adı veya parola hatalı",401,"INVALID_CREDENTIALS");}
    res.setHeader("Set-Cookie",sessionCookie(result.token));await audit.record({actor:result.user.username,action:"LOGIN_SUCCESS",ip:req.ip,requestId:req.id});res.json({status:"ok",user:result.user,csrfToken:result.csrf});
  }));
  router.post("/logout",requireAuth,requireCsrf,(req,res)=>{res.setHeader("Set-Cookie",clearSessionCookie());res.json({status:"ok"});});
  router.get("/me",requireAuth,(req,res)=>res.json({status:"ok",user:req.user,csrfToken:req.session.csrf}));
  return router;
}
module.exports={authRoutes};
