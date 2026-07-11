const {pool,withTransaction}=require("./config/database");
const {env}=require("./config/env");
const {AuthService}=require("./services/auth.service");
const {GoogleSheetsService}=require("./services/google-sheets.service");
const {TrendyolService}=require("./services/trendyol.service");
const {CostEngineService}=require("./services/cost-engine.service");
const {SyncService}=require("./services/sync.service");
const {SheetsSyncService}=require("./services/sheets-sync.service");
const {RepricerService}=require("./services/repricer.service");
const {ActionService}=require("./services/action.service");
const {LearningService}=require("./services/learning.service");
const {JobService}=require("./services/job.service");
const {MaintenanceService}=require("./services/maintenance.service");
const {ProductRepository}=require("./repositories/product.repository");
const {CostRepository}=require("./repositories/cost.repository");
const {DashboardRepository}=require("./repositories/dashboard.repository");
const {SettingsRepository}=require("./repositories/settings.repository");
const {AuditRepository}=require("./repositories/audit.repository");
const {ActionRepository}=require("./repositories/action.repository");
const {JobRepository}=require("./repositories/job.repository");

function transactionFor(db){
  if(db===pool)return withTransaction;
  return async work=>{const client=await db.connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}};
}

function createContainer(overrides={}){
  const db=overrides.db||pool;const transaction=overrides.withTransaction||transactionFor(db);
  const auth=overrides.auth||new AuthService();const sheets=overrides.sheets||new GoogleSheetsService();const trendyol=overrides.trendyol||new TrendyolService();
  const audit=overrides.audit||new AuditRepository(db);const settings=overrides.settings||new SettingsRepository(db);
  const products=overrides.products||new ProductRepository(db);const costs=overrides.costs||new CostRepository(db,transaction);
  const dashboard=overrides.dashboard||new DashboardRepository(db);const actions=overrides.actions||new ActionRepository(db);
  const jobs=overrides.jobs||new JobRepository(db);const costEngine=overrides.costEngine||new CostEngineService(db);
  const sync=overrides.sync||new SyncService({db,trendyol,audit});const sheetsSync=overrides.sheetsSync||new SheetsSyncService({db,withTransaction:transaction,sheets,costEngine,audit});
  const repricer=overrides.repricer||new RepricerService({db,actions,settings});
  const actionService=overrides.actionService||new ActionService({db,withTransaction:transaction,actions,products,settings,trendyol,audit,repricer});
  const learning=overrides.learning||new LearningService({actions});const maintenance=new MaintenanceService(db,env.logRetentionDays);
  const jobService=overrides.jobService||new JobService({db,repository:jobs});
  jobService.register("sync-products",()=>sync.products());jobService.register("sync-buybox",()=>sync.buybox());
  jobService.register("calculate-costs",()=>costEngine.recalculate());jobService.register("validate-data",()=>costEngine.recalculate());
  jobService.register("generate-repricer-actions",()=>repricer.generate({source:"JOB"}));
  jobService.register("run-auto-repricer",async()=>{
    const global=await repricer.globalSettings();const generated=await repricer.generate({source:"AUTO"});
    if(global.dryRun||!global.repricerEnabled)return {processed:generated.processed,successful:0,failed:0,metadata:{dryRun:global.dryRun,repricerEnabled:global.repricerEnabled,created:generated.created}};
    let successful=0,failed=0;for(const action of generated.items){try{const product=await products.get(action.barcode);if(product?.settings?.mode!=="AUTOMATIC"||!product?.settings?.auto_update)continue;await actionService.approve(action.id,"system");await actionService.apply(action.id,"system");successful++;}catch{failed++;}}
    return {processed:generated.created,successful,failed};
  });
  jobService.register("check-action-outcomes-5m",()=>learning.checkOutcomes(5));jobService.register("check-action-outcomes-15m",()=>learning.checkOutcomes(15));jobService.register("check-action-outcomes-60m",()=>learning.checkOutcomes(60));
  jobService.register("sheets-import",()=>sheetsSync.importAll());jobService.register("sheets-export",()=>sheetsSync.exportProducts());
  jobService.register("cleanup-old-logs",()=>maintenance.cleanup());
  return {db,auth,sheets,trendyol,audit,settings,products,costs,dashboard,actions,jobs,costEngine,sync,sheetsSync,repricer,actionService,learning,jobService};
}
module.exports={createContainer};
