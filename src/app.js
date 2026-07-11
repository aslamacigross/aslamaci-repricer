const express=require("express");const path=require("path");const fs=require("fs");
const {env}=require("./config/env");const {createContainer}=require("./container");
const {securityHeaders,requestContext,cors,createRateLimiter,authRequired,csrfRequired}=require("./middleware/security");
const {notFound,errorHandler}=require("./middleware/error-handler");const{asyncRoute}=require("./utils/errors");
const{authRoutes}=require("./routes/auth.routes");const{dashboardRoutes}=require("./routes/dashboard.routes");const{productsRoutes}=require("./routes/products.routes");
const{costsRoutes}=require("./routes/costs.routes");const{repricerRoutes}=require("./routes/repricer.routes");const{systemRoutes}=require("./routes/system.routes");const{legacyRoutes}=require("./routes/legacy.routes");

const APP_VERSION="2.0.0";
function createApp(container=createContainer()){
  const app=express();app.set("trust proxy",1);app.disable("x-powered-by");
  app.use(requestContext,securityHeaders,cors,express.json({limit:"2mb"}),createRateLimiter({max:180}));
  app.get("/version",(req,res)=>res.json({status:"ok",app:"aslamaci-erp",version:APP_VERSION,dryRun:env.dryRun}));
  app.get(["/health","/api/health"],asyncRoute(async(req,res)=>{const started=Date.now();await container.db.query("SELECT 1");res.json({status:"ok",app:"aslamaci-erp",version:APP_VERSION,database:"connected",responseMs:Date.now()-started,integrations:{google:container.sheets.health(),trendyol:{configured:container.trendyol.configured()}}});}));
  const requireAuth=authRequired(container.auth);app.use("/api/auth",authRoutes({auth:container.auth,audit:container.audit,requireAuth,requireCsrf:csrfRequired}));
  app.use("/api",requireAuth,csrfRequired);
  app.use("/api/dashboard",dashboardRoutes(container));app.use("/api/products",productsRoutes(container));app.use("/api",costsRoutes(container));app.use("/api",repricerRoutes(container));app.use("/api",systemRoutes(container));
  const legacyPaths=new Set(["/products-summary","/products","/sync-products","/sync-buybox","/calculate-costs","/run-full-refresh","/export-products-to-sheet","/apply-approved-prices"]);
  app.use((req,res,next)=>legacyPaths.has(req.path)?requireAuth(req,res,next):next);
  app.use((req,res,next)=>legacyPaths.has(req.path)?csrfRequired(req,res,next):next);
  app.use(legacyRoutes(container));
  const dist=path.resolve(__dirname,"../dist");if(fs.existsSync(dist)){app.use(express.static(dist,{maxAge:env.nodeEnv==="production"?"1h":0}));app.get("*",(req,res,next)=>req.path.startsWith("/api/")?next():res.sendFile(path.join(dist,"index.html")));}
  else app.get("/",(req,res)=>res.json({status:"ok",app:"Aşlamacı ERP V2",message:"Frontend build bulunamadı. npm run build çalıştırın."}));
  app.use(notFound,errorHandler);return app;
}
module.exports={createApp,APP_VERSION};
